// TEMPORARY diagnostic — gated behind WRAPPER_DIAG=1. Connects exactly like the
// app (token from safeStorage, url from settings) and logs the hello-ok snapshot
// shape + every raw chat chunk, WITH and WITHOUT agentId, to compare against the
// known smoke-test fix. Remove once the empty-bubble bug is understood.
import { OpenClawClient } from 'openclaw-node'
import { getSettings } from './settings'
import { getSecret } from './secrets'

export async function runDiag(): Promise<void> {
  const url = getSettings().openclaw.url
  const token = getSecret('gatewayToken')
  console.error(`[diag] url=${url} tokenPresent=${!!token} tokenLen=${token?.length ?? 0}`)

  const client = new OpenClawClient({ url, token, autoReconnect: false })
  let helloOk: any
  try {
    helloOk = await client.connect()
  } catch (e) {
    console.error('[diag] connect FAILED:', e instanceof Error ? e.message : e)
    return
  }
  console.error('[diag] helloOk keys:', Object.keys(helloOk))
  console.error('[diag] snapshot keys:', helloOk.snapshot ? Object.keys(helloOk.snapshot) : '(no snapshot)')
  console.error('[diag] snapshot.sessionDefaults:', JSON.stringify(helloOk.snapshot?.sessionDefaults))
  console.error('[diag] snapshot.defaultAgentId(direct):', helloOk.snapshot?.defaultAgentId)
  const defaultAgentId = helloOk.snapshot?.sessionDefaults?.defaultAgentId
  console.error('[diag] resolved defaultAgentId =', JSON.stringify(defaultAgentId))

  const prompt = 'Dis juste OK en un mot.'

  // (A) WITH agentId (the app's path)
  console.error(`\n[diag] === chat WITH agentId=${JSON.stringify(defaultAgentId)} ===`)
  let n = 0
  try {
    for await (const chunk of client.chat(prompt, { agentId: defaultAgentId })) {
      console.error(`[diag][withId #${n++}]`, JSON.stringify(chunk).slice(0, 200))
    }
  } catch (e) {
    console.error('[diag] chat WITH agentId threw:', e instanceof Error ? e.message : e)
  }
  console.error(`[diag] withId total chunks = ${n}`)

  await client.disconnect()
  console.error('[diag] done.')
}
