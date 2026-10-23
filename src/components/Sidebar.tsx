import { useEffect, useMemo, useRef, useState } from 'react';
import { agentKey, placeOf, shownStatus, useStore } from '../store';
import { agoText, useT, type TKey } from '../i18n';
import { MODELS, OFFICE_ID, type Schedule, type Team } from '../types';
import { clock, tokens } from '../util';
import { ROOMS_PER_FLOOR } from '../office/floorplan';
import { ConfirmDialog, archive } from './ConfirmDialog';
import { call } from '../api';

function PauseIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M4 2.5v9l7.5-4.5z" fill="currentColor" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="3" y="2.5" width="2.6" height="9" rx=".6" fill="currentColor" />
      <rect x="8.4" y="2.5" width="2.6" height="9" rx=".6" fill="currentColor" />
    </svg>
  );
}

/** Front office: the secretary (not part of any team), with Telegram status. */
function OfficeSection() {
  const t = useT();
  const agents = useStore((s) => s.agents);
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const selectedAgentKey = useStore((s) => s.selectedAgentKey);
  const st = useStore.getState();
  const sec = Object.values(agents).find((a) => a.teamId === OFFICE_ID && a.role === 'secretary');
  const folded = useStore((s) => s.folded);
  const open = selectedTeamId === OFFICE_ID && !folded[OFFICE_ID];
  const reminders = useStore((s) => s.reminders);
  const lang = useStore((s) => s.lang) ?? 'en';
  const when = (ts: number) => {
    const d = new Date(ts);
    const today = new Date().toDateString() === d.toDateString();
    return (today ? '' : d.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short' }) + ' ') + clock(ts);
  };

  if (!sec)
    return (
      <div className="office-row office-row--empty">
        <span className="office-row__icon" aria-hidden />
        <span className="office-row__text">
          <span className="team__name">{t('office.title')}</span>
          <span className="team__meta">{t('sec.intro').split('.')[0]}.</span>
        </span>
        <button className="btn btn--ghost btn--sm" onClick={() => st.setSecretaryOpen(true)}>
          {t('office.add')}
        </button>
      </div>
    );

  const k = agentKey(OFFICE_ID, sec.id);
  const tg = sec.telegram?.configured;
  return (
    <>
    <div className={`office-row${open ? ' is-open' : ''}`}>
      <button
        className="office-row__main"
        onClick={() => {
          if (open) return st.toggleTeam(OFFICE_ID);
          st.toggleTeam(OFFICE_ID);
          st.selectAgent(k);
          st.focusOn({ kind: 'agent', key: k });
        }}
        aria-pressed={open && selectedAgentKey === k}
      >
        <span className="office-row__icon" aria-hidden />
        <span className="office-row__text">
          <span className="team__name">
            {t('office.title')}
            <span className="agent-row__role">
              {sec.name}, {sec.roleTitle}
            </span>
          </span>
          <span className={`team__meta tg-state${tg ? ' is-on' : ''}`}>{tg ? t('office.telegramOn') : t('office.telegramOff')}</span>
        </span>
      </button>
      <button className="icon-btn" onClick={() => st.setSecretaryOpen(true)} aria-label={t('sec.configure')} title={t('sec.configure')}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path d="M14.5 1.5 1.5 7l5 2 2 5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="m6.5 9 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
    {reminders.length > 0 && (
      <div className="reminders">
        <h3>{t('office.reminders')}</h3>
        <ul>
          {reminders.slice(0, 5).map((r) => (
            <li key={r.id}>
              <time>{when(r.at)}</time>
              <span>{r.text}</span>
              <button
                className="icon-btn"
                onClick={() => {
                  useStore.setState({ reminders: useStore.getState().reminders.filter((x) => x.id !== r.id) });
                  call('DELETE', `api/reminders?id=${encodeURIComponent(r.id)}`);
                }}
                aria-label={t('office.cancelReminder')}
                title={t('office.cancelReminder')}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}
    </>
  );
}

/** Repetitive jobs of one team. Script mode runs without waking an agent, so it costs no tokens. */
function ScheduleList({ teamId }: { teamId: string }) {
  const t = useT();
  const lang = useStore((s) => s.lang) ?? 'en';
  const schedules = useStore((s) => s.schedules);
  const agents = useStore((s) => s.agents);
  const st = useStore.getState();
  const list = schedules.filter((x) => x.teamId === teamId);
  return (
    <div className="team__schedules">
      <h3>{t('sched.title')}</h3>
      {list.length === 0 && <p className="muted small">{t('sched.none')}</p>}
      <ul>
        {list.map((x: Schedule) => {
          const who = agents[agentKey(x.teamId, x.agentId)];
          return (
            <li key={x.id} className={`sched${x.enabled ? '' : ' is-off'}`}>
              <div className="sched__top">
                <span className={`sched__mode sched__mode--${x.mode}`}>{x.mode === 'script' ? t('sched.script') : t('sched.agent')}</span>
                <button
                  className={`switch${x.enabled ? ' is-on' : ''}`}
                  role="switch"
                  aria-checked={x.enabled}
                  onClick={() => st.setScheduleEnabled(x.id, !x.enabled)}
                  aria-label={x.enabled ? t('sched.pause') : t('sched.resume')}
                  title={x.enabled ? t('sched.pause') : t('sched.resume')}
                >
                  <span />
                </button>
              </div>
              <p className="sched__title">{x.title}</p>
              <p className="sched__when">
                {x.human}
                {who && <>, {who.name}</>} <code className="mono">{x.cron}</code>
              </p>
              <p className="sched__last">{x.lastRun ? t('sched.last', { ago: agoText(lang, x.lastRun), result: x.lastResult ?? '' }) : t('sched.never')}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const lang = useStore((s) => s.lang) ?? 'en';
  const company = useStore((s) => s.company);
  const teams = useStore((s) => s.teams);
  const agents = useStore((s) => s.agents);
  const claude = useStore((s) => s.claude);
  const activity = useStore((s) => s.activity);
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const selectedAgentKey = useStore((s) => s.selectedAgentKey);
  const projects = useStore((s) => s.projects);
  const projectOpen = useStore((s) => s.projectOpen);
  const mode = useStore((s) => s.mode);
  const st = useStore.getState();

  const [editingPath, setEditingPath] = useState(false);
  const [path, setPath] = useState(company.rootPath);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const schedules = useStore((s) => s.schedules);

  async function deleteTeam(team: Team) {
    // projects first (each goes to projects\_archive), then the team folder
    for (const p of useStore.getState().projects.filter((x) => x.teamId === team.id)) {
      const err = await archive(`api/projects?name=${encodeURIComponent(p.name)}`);
      if (err) return err;
    }
    const err = await archive(`api/teams?id=${encodeURIComponent(team.id)}`);
    if (err) return err;
    st.deleteTeam(team.id);
  }

  useEffect(() => {
    const open = () => {
      setCreating(true);
      setTimeout(() => nameRef.current?.focus(), 30);
    };
    window.addEventListener('ct:new-team', open);
    return () => window.removeEventListener('ct:new-team', open);
  }, []);

  const byTeam = useMemo(() => {
    const m = new Map<string, typeof agents[string][]>();
    Object.values(agents).forEach((a) => m.set(a.teamId, [...(m.get(a.teamId) ?? []), a]));
    m.forEach((l) => l.sort((a, b) => (a.role === 'manager' ? -1 : b.role === 'manager' ? 1 : 0)));
    return m;
  }, [agents]);

  const nextFloor = Math.floor(teams.length / ROOMS_PER_FLOOR) + 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const side = useStore((s) => s.side);
  const folded = useStore((s) => s.folded);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => st.setSide({ width: Math.round(Math.max(240, Math.min(Math.min(640, window.innerWidth - 520), ev.clientX))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (side.collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" aria-label={t('teams.title')}>
        <button className="chat__rail" onClick={() => st.setSide({ collapsed: false })} aria-label={t('side.expand')} title={t('side.expand')}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="chat__rail-title">{t('teams.title')}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar" aria-label={t('teams.title')}>
      <div className="sidebar__resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label={t('side.resize')} title={t('side.resize')} />
      <button className="icon-btn sidebar__min" onClick={() => st.setSide({ collapsed: true })} aria-label={t('side.minimize')} title={t('side.minimize')}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <section className="side-company">
        {editingPath ? (
          <form
            className="path-edit"
            onSubmit={(e) => {
              e.preventDefault();
              st.setRootPath(path.trim());
              setEditingPath(false);
            }}
          >
            <label htmlFor="root" className="sr-only">
              {t('folder.label')}
            </label>
            <input id="root" className="input mono" value={path} onChange={(e) => setPath(e.target.value)} autoFocus />
            <button className="btn btn--primary" type="submit">
              {t('folder.use')}
            </button>
          </form>
        ) : (
          <div className="path-row">
            <code className="mono" title={company.rootPath}>
              {company.rootPath}
            </code>
            {mode !== 'live' && (
              <button className="btn btn--ghost btn--sm" onClick={() => setEditingPath(true)}>
                {t('folder.change')}
              </button>
            )}
          </div>
        )}
        <p className="muted small">
          {t('folder.help')} {mode === 'live' && t('folder.live')}
        </p>
      </section>

      <section className="side-teams">
        <div className="side-head">
          <h2>{t('teams.title')}</h2>
          {!creating && (
            <button className="btn btn--ghost btn--sm" onClick={() => setCreating(true)}>
              {t('teams.new')}
            </button>
          )}
        </div>

        {creating && (
          <form
            className="new-team"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              st.createTeam(name.trim(), mission.trim() || t('newteam.noMission'));
              setName('');
              setMission('');
              setCreating(false);
            }}
          >
            <label>
              <span>{t('newteam.name')}</span>
              <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newteam.namePh')} />
            </label>
            <label>
              <span>{t('newteam.mission')}</span>
              <textarea className="input" rows={2} value={mission} onChange={(e) => setMission(e.target.value)} placeholder={t('newteam.missionPh')} />
            </label>
            <p className="small muted">{t('newteam.room', { f: nextFloor })}</p>
            <p className="mono small muted path">employees\team_{slug || '…'}</p>
            <div className="new-team__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn--primary btn--sm" disabled={!name.trim()}>
                {t('newteam.create')}
              </button>
            </div>
          </form>
        )}

        <OfficeSection />

        <ul className="team-list">
          {teams.map((team) => {
            const members = byTeam.get(team.id) ?? [];
            const working = members.filter((a) => placeOf(a, team, claude) !== 'lounge').length;
            const open = team.id === selectedTeamId && !folded[team.id];
            return (
              <li key={team.id} className={`team${open ? ' is-open' : ''}${team.paused ? ' is-paused' : ''}`} style={{ ['--tc' as string]: team.color }}>
                <div className="team__row">
                  <button className="team__main" onClick={() => st.toggleTeam(team.id)} aria-expanded={open}>
                    <span className="team__swatch" aria-hidden />
                    <span className="team__text">
                      <span className="team__name">{team.name}</span>
                      <span className="team__meta">
                        {members.length === 0
                          ? t('teams.none')
                          : team.paused
                            ? `${t('teams.paused')}, ${t('teams.active', { ago: agoText(lang, team.lastActive) })}`
                            : team.meeting
                              ? t('teams.meeting')
                              : t('teams.summary', { w: working, r: members.length - working })}
                      </span>
                    </span>
                  </button>
                  <button
                    className={`icon-btn pause-btn${team.paused ? ' is-paused' : ''}`}
                    onClick={() => st.setTeamPaused(team.id, !team.paused)}
                    aria-label={team.paused ? t('teams.resume') : t('teams.pause')}
                    title={team.paused ? t('teams.resume') : t('teams.pause')}
                  >
                    <PauseIcon paused={team.paused} />
                  </button>
                </div>

                {open && (
                  <div className="team__agents">
                    <ul>
                      {members.map((a) => {
                        const k = agentKey(a.teamId, a.id);
                        const s = shownStatus(a, team, claude);
                        const selfPaused = a.status === 'paused';
                        return (
                          <li key={k} className={`agent-row${selectedAgentKey === k ? ' is-selected' : ''}`} style={{ ['--c' as string]: a.color }}>
                            <button
                              className="agent-row__main"
                              onClick={() => {
                                st.selectAgent(selectedAgentKey === k ? null : k);
                                if (selectedAgentKey !== k) st.focusOn({ kind: 'agent', key: k });
                              }}
                            >
                              <span className={`agent-row__lamp lamp--${s}`} aria-hidden />
                              <span className="agent-row__text">
                                <span className="agent-row__name">
                                  {a.name}
                                  <span className="agent-row__role">{a.roleTitle}</span>
                                </span>
                                <span className="agent-row__activity">
                                  <strong>{team.meeting && s === 'idle' ? t('status.meeting') : t(`status.${s}` as never)}</strong>
                                  {!['idle', 'paused', 'team_paused', 'offline'].includes(s) && a.activity && <> {a.activity}</>}
                                </span>
                                <span className="agent-row__meta">
                                  {MODELS.find((m) => m.id === a.model)?.label}, {tokens(a.tokensToday)}
                                </span>
                              </span>
                            </button>
                            <button
                              className={`icon-btn pause-btn${selfPaused ? ' is-paused' : ''}`}
                              onClick={() => st.setAgentPaused(a.teamId, a.id, !selfPaused)}
                              aria-label={selfPaused ? t('drawer.resume', { name: a.name }) : t('drawer.pause', { name: a.name })}
                              title={selfPaused ? t('drawer.resume', { name: a.name }) : t('drawer.pause', { name: a.name })}
                            >
                              <PauseIcon paused={selfPaused} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <button className="btn btn--ghost btn--sm add-agent" onClick={() => st.setAddAgentOpen(true)}>
                      {t('teams.addAgent')}
                    </button>
                    <div className="team__projects">
                      <h3>{t('projects.title')}</h3>
                      <ul>
                        {projects
                          .filter((p) => p.teamId === team.id || p.collaborators.some((c) => c.id === team.id || c.id.startsWith(team.id + '/')))
                          .map((p) => (
                            <li key={p.id}>
                              <button className={`project-row${projectOpen === p.id ? ' is-selected' : ''}`} onClick={() => st.openProject(projectOpen === p.id ? null : p.id)}>
                                <span className="project-row__icon" aria-hidden />
                                <span className="project-row__name">{p.name}</span>
                                {p.teamId !== team.id ? (
                                  <span className="ro-badge" title={t('pd.advisor')}>
                                    {t('badge.advisor')}
                                  </span>
                                ) : (
                                  <span className="project-row__phase">{t(`phase.${p.phase}` as TKey)}</span>
                                )}
                              </button>
                            </li>
                          ))}
                        {!projects.some((p) => p.teamId === team.id) && <li className="muted small">{t('projects.none')}</li>}
                      </ul>
                      <button className="btn btn--ghost btn--sm add-agent" onClick={() => st.setNewProjectOpen(true)}>
                        {t('projects.new')}
                      </button>
                    </div>
                    <ScheduleList teamId={team.id} />
                    <button className="btn btn--ghost btn--sm btn--danger-text team__delete" onClick={() => setDeleting(team)}>
                      {t('teams.delete')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <ConfirmDialog
        open={!!deleting}
        title={deleting ? t('confirm.deleteTeamTitle', { name: deleting.name }) : ''}
        body={
          deleting
            ? t('confirm.deleteTeamBody', {
                agents: Object.values(agents).filter((a) => a.teamId === deleting.id).length,
                projects: projects.filter((p) => p.teamId === deleting.id).length,
                schedules: schedules.filter((x) => x.teamId === deleting.id).length,
              })
            : ''
        }
        typeToConfirm={deleting?.name}
        onConfirm={() => (deleting ? deleteTeam(deleting) : undefined)}
        onClose={() => setDeleting(null)}
      />

      <section className="side-activity">
        <h2 className="side-head">{t('activity.title')}</h2>
        <ol className="feed">
          {activity.slice(0, 30).map((e) => {
            const a = agents[agentKey(e.teamId, e.agentId)];
            const text = e.kind === 'hire' ? t('activity.joined', { title: e.text.toLowerCase() }) : e.text.startsWith('project:') ? t('activity.projectCreated', { name: e.text.slice(8) }) : e.text;
            return (
              <li key={e.id} style={{ ['--c' as string]: a?.color ?? '#fff' }}>
                <time>{clock(e.ts)}</time>
                <span>
                  <b>{a?.name ?? e.agentId}</b> {text}
                </span>
              </li>
            );
          })}
          {activity.length === 0 && <li className="muted feed__empty">{t('activity.empty')}</li>}
        </ol>
      </section>
    </aside>
  );
}
