// ---------------------------------------------------------------------------
// Local persistence (better-sqlite3, main process only).
//
// Conversations and messages are keyed by agent + conversation. Each
// conversation carries a deterministic `session_key` that maps it to a backend
// session so context continues across turns:
//   - OpenClaw     -> passed as chat({ sessionKey })
//   - Claude Code  -> used as the SDK sessionId (first turn) / resume (later)
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentId, Conversation, ContextWindow, StoredMessage, Project } from '../shared/types'

export type ConversationRow = Conversation
export type MessageRow = StoredMessage

let db: Database.Database

export function initDb(): void {
  const path = join(app.getPath('userData'), 'wrapper.db')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      session_key TEXT NOT NULL,
      session_started INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      effort TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tools TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
  `)

  // Migrations for databases created before these columns existed.
  addColumnIfMissing('conversations', 'model', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing('conversations', 'effort', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing('conversations', 'project_id', 'TEXT')
  addColumnIfMissing('conversations', 'context_window', "TEXT NOT NULL DEFAULT '200k'")
  addColumnIfMissing('conversations', 'head_sha_at_start', 'TEXT')
  addColumnIfMissing('messages', 'attachments', "TEXT NOT NULL DEFAULT '[]'")

  // Index on project_id only after the column is guaranteed to exist.
  db.exec('CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_id)')
}

function addColumnIfMissing(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
  }
}

function mapConversation(r: any): ConversationRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    sessionKey: r.session_key,
    sessionStarted: r.session_started,
    projectId: r.project_id ?? null,
    model: r.model ?? '',
    effort: r.effort ?? '',
    contextWindow: (r.context_window ?? '200k') as ContextWindow,
    headShaAtStart: r.head_sha_at_start ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// --- Projects --------------------------------------------------------------

function mapProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    cwd: r.cwd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listProjects(): Project[] {
  return db
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all()
    .map(mapProject)
}

export function getProject(id: string): Project | undefined {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  return r ? mapProject(r) : undefined
}

export function createProject(name: string, cwd: string): Project {
  const now = Date.now()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, name, cwd, now, now)
  return getProject(id)!
}

export function deleteProject(id: string): void {
  // Cascade: drop the project's sessions and their messages.
  const convs = db
    .prepare('SELECT id FROM conversations WHERE project_id = ?')
    .all(id) as Array<{ id: string }>
  const delMsgs = db.prepare('DELETE FROM messages WHERE conversation_id = ?')
  for (const c of convs) delMsgs.run(c.id)
  db.prepare('DELETE FROM conversations WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function listConversationsByProject(projectId: string): ConversationRow[] {
  return db
    .prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId)
    .map(mapConversation)
}

export function listConversations(agentId: AgentId): ConversationRow[] {
  return db
    .prepare('SELECT * FROM conversations WHERE agent_id = ? ORDER BY updated_at DESC')
    .all(agentId)
    .map(mapConversation)
}

export function getConversation(id: string): ConversationRow | undefined {
  const r = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  return r ? mapConversation(r) : undefined
}

export function createConversation(
  agentId: AgentId,
  title: string,
  projectId: string | null = null,
  headShaAtStart: string | null = null,
): ConversationRow {
  const now = Date.now()
  const id = randomUUID()
  // Deterministic backend session key tied to this conversation.
  const sessionKey = agentId === 'claude-code' ? randomUUID() : `wrapper:${id}`
  db.prepare(
    `INSERT INTO conversations (id, agent_id, title, session_key, session_started, project_id, model, effort, head_sha_at_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, '', '', ?, ?, ?)`,
  ).run(id, agentId, title, sessionKey, projectId, headShaAtStart, now, now)
  return getConversation(id)!
}

export function setConversationSettings(
  id: string,
  model: string,
  effort: string,
  contextWindow: string,
): void {
  db.prepare(
    'UPDATE conversations SET model = ?, effort = ?, context_window = ? WHERE id = ?',
  ).run(model, effort, contextWindow, id)
}

export function renameConversation(id: string, title: string): void {
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    Date.now(),
    id,
  )
}

export function deleteConversation(id: string): void {
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function markSessionStarted(id: string): void {
  db.prepare('UPDATE conversations SET session_started = 1 WHERE id = ?').run(id)
}

export function touchConversation(id: string): void {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function getMessages(conversationId: string): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId)
    .map((r: any) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      tools: safeParse(r.tools),
      attachments: safeParse(r.attachments),
      error: r.error ?? undefined,
      createdAt: r.created_at,
    }))
}

export function addMessage(msg: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  tools?: { name: string; detail?: unknown }[]
  attachments?: MessageRow['attachments']
  error?: string
}): MessageRow {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, tools, attachments, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    msg.conversationId,
    msg.role,
    msg.content,
    JSON.stringify(msg.tools ?? []),
    JSON.stringify(msg.attachments ?? []),
    msg.error ?? null,
    now,
  )
  touchConversation(msg.conversationId)
  return {
    id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    tools: msg.tools ?? [],
    attachments: msg.attachments ?? [],
    error: msg.error,
    createdAt: now,
  }
}

function safeParse<T = any>(s: string): T {
  try {
    return JSON.parse(s)
  } catch {
    return [] as unknown as T
  }
}
