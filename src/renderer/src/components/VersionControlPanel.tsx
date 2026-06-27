// Settings > "Version control" — read-only git + gh status for the active
// project. Git is the source of truth; gh is detected, never authenticated
// by this app (auth belongs to the gh CLI).
import { GitBranch, GithubLogo, WarningCircle, ArrowsClockwise } from '@phosphor-icons/react'
import type { Project } from '@shared/types'
import { useGitStatus } from '../useGitStatus'

export function VersionControlPanel({ project }: { project?: Project }) {
  const { status, error, refresh } = useGitStatus(project?.id)

  return (
    <section>
      <div className="vc-head">
        <h3>Version control</h3>
        <button className="icon-btn" title="Rafraîchir" onClick={refresh} disabled={!project}>
          <ArrowsClockwise size={15} />
        </button>
      </div>

      {!project && <p className="vc-muted">Aucun projet actif.</p>}
      {project && <p className="vc-project mono" title={project.cwd}>{project.cwd}</p>}
      {error && <div className="vc-error">{error}</div>}

      {project && !error && status && (
        <div className="vc-rows">
          <div className="vc-row">
            <span className="vc-label">Dépôt</span>
            <span className={`vc-value ${status.isRepo ? 'ok' : 'warn'}`}>
              {status.isRepo ? 'dépôt git' : 'pas un dépôt git'}
            </span>
          </div>

          {status.isRepo && (
            <>
              <div className="vc-row">
                <span className="vc-label">
                  <GitBranch size={14} /> Branche
                </span>
                <span className="vc-value mono">{status.branch ?? '(détachée)'}</span>
              </div>
              <div className="vc-row">
                <span className="vc-label">Changements</span>
                <span className={`vc-value ${status.hasUncommittedChanges ? 'warn' : 'ok'}`}>
                  {status.hasUncommittedChanges ? 'non commités' : 'aucun'}
                </span>
              </div>
              <div className="vc-row">
                <span className="vc-label">Remote</span>
                <span className={`vc-value ${status.hasRemote ? 'ok' : 'warn'}`}>
                  {status.hasRemote ? 'configuré' : 'aucun'}
                </span>
              </div>
              <div className="vc-row">
                <span className="vc-label">Suivi distant</span>
                <span className="vc-value mono">
                  {status.hasUpstream ? `${status.ahead} ahead / ${status.behind} behind` : 'aucune upstream'}
                </span>
              </div>
            </>
          )}

          <div className="vc-row">
            <span className="vc-label">
              <GithubLogo size={14} /> gh CLI
            </span>
            <span className={`vc-value ${status.gh.installed ? 'ok' : 'warn'}`}>
              {status.gh.installed ? 'installé' : 'introuvable'}
            </span>
          </div>

          {status.gh.installed && (
            <div className="vc-row">
              <span className="vc-label">Authentification</span>
              <span className={`vc-value ${status.gh.authenticated ? 'ok' : 'warn'}`}>
                {status.gh.authenticated
                  ? `connecté${status.gh.account ? ` · ${status.gh.account}` : ''}`
                  : 'non connecté'}
              </span>
            </div>
          )}

          {!status.gh.installed && (
            <div className="vc-help">
              <WarningCircle className="ico" size={15} />
              <span>
                gh CLI introuvable sur le PATH.{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => window.api.shell.openExternal('https://cli.github.com/')}
                >
                  Installer GitHub CLI
                </button>
              </span>
            </div>
          )}

          {status.gh.installed && !status.gh.authenticated && (
            <div className="vc-help">
              <WarningCircle className="ico" size={15} />
              <span>
                Non authentifié. Lance <code className="mono">gh auth login</code> dans un terminal,
                puis rafraîchis.{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    window.api.shell.openExternal('https://cli.github.com/manual/gh_auth_login')
                  }
                >
                  Voir les instructions
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
