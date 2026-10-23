import { useState } from 'react';
import { agentKey, useStore } from '../store';
import { useT, type TKey } from '../i18n';
import { OFFICE_ID, PHASES, type Collaborator } from '../types';
import { planFolders } from '../projects/plan';
import { ConfirmDialog, archive } from './ConfirmDialog';

const COMMANDS = ['/start', '/research', '/auto-research', '/index-reference', '/decision', '/build-brief', '/journal', '/commit-discussion', '/setup-journal'];

export function ProjectDrawer() {
  const t = useT();
  const id = useStore((s) => s.projectOpen);
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectOpen));
  const team = useStore((s) => s.teams.find((x) => x.id === project?.teamId));
  const mgr = useStore((s) => Object.values(s.agents).find((a) => a.teamId === project?.teamId && a.role === 'manager'));
  const company = useStore((s) => s.company);
  const teams = useStore((s) => s.teams);
  const agents = useStore((s) => s.agents);
  const st = useStore.getState();
  const [pick, setPick] = useState('');
  const [confirm, setConfirm] = useState(false);
  if (!id || !project) return null;

  const invited = new Set(project.collaborators.map((c) => c.id));
  const teamChoices = teams.filter((x) => x.id !== project.teamId && !invited.has(x.id));
  const agentChoices = Object.values(agents).filter(
    (a) => a.teamId !== project.teamId && a.teamId !== OFFICE_ID && !invited.has(agentKey(a.teamId, a.id)) && !invited.has(a.teamId),
  );
  const label = (c: Collaborator) => {
    if (c.kind === 'team') return teams.find((x) => x.id === c.id)?.name ?? c.id;
    const a = agents[c.id];
    const tm = teams.find((x) => x.id === c.id.split('/')[0]);
    return a ? `${a.name}, ${a.roleTitle} (${tm?.name ?? ''})` : c.id;
  };
  const colorOf = (c: Collaborator) => (c.kind === 'team' ? teams.find((x) => x.id === c.id)?.color : agents[c.id]?.color);

  const f = planFolders(project.process);
  const phaseIdx = PHASES.indexOf(project.phase);

  return (
    <aside className="drawer drawer--project" style={{ ['--c' as string]: team?.color }} aria-label={project.name}>
      <header className="drawer__head">
        <span className="drawer__chip drawer__chip--folder" aria-hidden />
        <div>
          <h2>{project.name}</h2>
          <p>
            {team?.name}, {project.created}
          </p>
        </div>
        <button className="icon-btn" onClick={() => st.openProject(null)} aria-label={t('common.close')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="drawer__body">
        <section>
          <h3>{t('pd.phase')}</h3>
          <ol className="phases">
            {PHASES.map((p, i) => (
              <li key={p} className={i < phaseIdx ? 'is-done' : i === phaseIdx ? 'is-now' : ''}>
                {t(`phase.${p}` as TKey)}
              </li>
            ))}
          </ol>
          <p>{project.description}</p>
        </section>
        <section>
          <h3>{t('pd.shipped')}</h3>
          <p>{project.shipped || '—'}</p>
        </section>
        <section>
          <h3>{t('pd.lastSession')}</h3>
          <p>{project.lastSession ?? t('pd.noSession')}</p>
          <p className="muted small">
            {t('pd.journal')}: {t('pd.journalCounts', { d: project.decisions, r: project.findings })}
          </p>
        </section>
        {project.rules.length > 0 && (
          <section>
            <h3>{t('pd.rules')}</h3>
            <ul className="memory">
              {project.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3>{t('pd.team')}</h3>
          <ul className="collabs">
            <li style={{ ['--c' as string]: team?.color }}>
              <span className="collabs__dot" aria-hidden />
              <span className="collabs__name">
                {team?.name}
                <small>
                  <span className="collabs__access is-write">{t('pd.owner')}</span>
                </small>
              </span>
            </li>
            {project.collaborators.map((c) => (
              <li key={c.id} style={{ ['--c' as string]: colorOf(c) }}>
                <span className="collabs__dot" aria-hidden />
                <span className="collabs__name">
                  {label(c)}
                  <small>
                    <span className="collabs__access">{t('pd.advisor')}</span> {c.kind === 'team' ? t('pd.inviteTeam') : t('pd.inviteAgent')}
                  </small>
                </span>
                <button className="icon-btn" onClick={() => st.removeCollaborator(project.id, c)} aria-label={t('pd.remove', { name: label(c) })} title={t('pd.remove', { name: label(c) })}>
                  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {(teamChoices.length > 0 || agentChoices.length > 0) && (
            <form
              className="invite"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pick) return;
                const [kind, cid] = pick.split(':') as ['team' | 'agent', string];
                st.inviteToProject(project.id, { kind, id: cid });
                setPick('');
              }}
            >
              <label className="sr-only" htmlFor="invite-pick">
                {t('pd.invite')}
              </label>
              <select id="invite-pick" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{t('pd.invitePick')}</option>
                {teamChoices.length > 0 && (
                  <optgroup label={t('pd.inviteTeam')}>
                    {teamChoices.map((x) => (
                      <option key={x.id} value={`team:${x.id}`}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {agentChoices.length > 0 && (
                  <optgroup label={t('pd.inviteAgent')}>
                    {agentChoices.map((a) => (
                      <option key={agentKey(a.teamId, a.id)} value={`agent:${agentKey(a.teamId, a.id)}`}>
                        {a.name}, {a.roleTitle} ({teams.find((x) => x.id === a.teamId)?.name})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button type="submit" className="btn btn--ghost btn--sm" disabled={!pick}>
                {t('pd.invite')}
              </button>
            </form>
          )}
          <p className="muted small">{t('pd.inviteHint')}</p>
        </section>
        <section>
          <h3>{t('pd.folders')}</h3>
          <p className="mono small muted path">
            {company.rootPath}\projects\{project.name}\
          </p>
          <ul className="folder-list mono small">
            {[...f.process, f.system, f.skills, f.attach, f.iteration, f.journal].map((d) => (
              <li key={d}>{d}\</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{t('pd.commands')}</h3>
          <p className="cmd-chips">
            {COMMANDS.map((c) => (
              <code key={c} className="mono">
                {c}
              </code>
            ))}
          </p>
        </section>
      </div>
      <footer className="drawer__foot">
        <div className="drawer__actions">
          {mgr && (
            <button
              className="btn btn--primary"
              onClick={() => {
                st.selectTeam(project.teamId, false);
                st.sendAsCeo(t('pd.askMsg', { name: project.name }));
              }}
            >
              {t('pd.ask', { name: mgr.name })}
            </button>
          )}
          <button className="btn btn--ghost btn--danger-text" onClick={() => setConfirm(true)}>
            {t('pd.delete')}
          </button>
        </div>
      </footer>
      <ConfirmDialog
        open={confirm}
        title={t('confirm.deleteProjectTitle', { name: project.name })}
        body={t('confirm.deleteProjectBody')}
        typeToConfirm={project.name}
        onConfirm={async () => {
          const err = await archive(`api/projects?name=${encodeURIComponent(project.name)}`);
          if (err) return err;
          st.deleteProject(project.id);
        }}
        onClose={() => setConfirm(false)}
      />
    </aside>
  );
}
