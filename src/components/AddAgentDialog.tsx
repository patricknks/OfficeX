import { useEffect, useMemo, useRef, useState } from 'react';
import { agentKey, useStore } from '../store';
import { useT, type TKey } from '../i18n';
import { AGENT_COLORS, newSessionId } from '../mock/data';
import { MODELS, READ_ONLY_PERMISSIONS, type BrowserMode, type EffortLevel, type ModelId, type OutputStyle, type Permission, type RoleKind } from '../types';
import { EffortStyle } from './EffortStyle';
import { Permissions } from './Permissions';
import { slugify } from '../util';

const TEMPLATES: Record<RoleKind, { model: ModelId; effort: EffortLevel; perms: Permission[] }> = {
  manager: { effort: 'high', model: 'claude-opus-5-5', perms: ['web', 'read_company', 'write_workspace', 'write_projects'] },
  researcher: { effort: 'medium', model: 'claude-sonnet-5-5', perms: ['web', 'browser', 'read_company', 'write_workspace'] },
  analyst: { effort: 'medium', model: 'claude-sonnet-5-5', perms: ['read_company', 'write_workspace', 'run_commands'] },
  reviewer: { effort: 'high', model: 'claude-opus-5-5', perms: ['read_company', 'write_workspace'] },
  custom: { effort: 'medium', model: 'claude-sonnet-5-5', perms: ['read_company', 'write_workspace'] },
  advisor: { effort: 'high', model: 'claude-opus-5-5', perms: ['web', 'read_company'] },
  secretary: { effort: 'low', model: 'claude-haiku-5-5', perms: ['read_company', 'run_commands'] },
};
// the secretary has its own dialog in the front office
const ROLES = (Object.keys(TEMPLATES) as RoleKind[]).filter((r) => r !== 'secretary');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AddAgentDialog() {
  const t = useT();
  const open = useStore((s) => s.addAgentOpen);
  const teamId = useStore((s) => s.selectedTeamId);
  const teamObj = useStore((s) => s.teams.find((x) => x.id === s.selectedTeamId));
  const agentsRec = useStore((s) => s.agents);
  const company = useStore((s) => s.company);
  const st = useStore.getState();

  const team = useMemo(() => Object.values(agentsRec).filter((a) => a.teamId === teamId), [agentsRec, teamId]);
  const hasManager = team.some((a) => a.role === 'manager');

  const [role, setRole] = useState<RoleKind>('researcher');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState<ModelId>('claude-sonnet-5-5');
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [outputStyle, setOutputStyle] = useState<OutputStyle>('default');
  const [perms, setPerms] = useState<Permission[]>([]);
  const [browserMode, setBrowserMode] = useState<BrowserMode>('separate');
  const [brief, setBrief] = useState('');
  const [session, setSession] = useState('');
  const [fork, setFork] = useState(true);
  const dlg = useRef<HTMLDialogElement>(null);

  function pick(r: RoleKind) {
    setRole(r);
    setTitle(t(`tpl.${r}.title` as TKey));
    setBrief(t(`tpl.${r}.brief` as TKey));
    setModel(TEMPLATES[r].model);
    setEffort(TEMPLATES[r].effort);
    setOutputStyle('default');
    setPerms(TEMPLATES[r].perms);
    setBrowserMode('separate');
    setSession('');
    setFork(true);
  }

  useEffect(() => {
    if (open) {
      pick(hasManager ? 'researcher' : 'manager');
      setName('');
      if (!dlg.current?.open) dlg.current?.showModal();
    } else if (dlg.current?.open) dlg.current.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const id = useMemo(() => {
    if (role === 'manager') return 'manager';
    const base = role === 'custom' ? slugify(title) || 'agent' : role;
    let i = 1;
    while (team.some((a) => a.id === `${base}-${i}`)) i++;
    return `${base}-${i}`;
  }, [role, title, team]);

  const isAdvisor = role === 'advisor';
  const sessionOk = !isAdvisor || UUID.test(session.trim());
  const canHire = !!name.trim() && !!title.trim() && !(role === 'manager' && hasManager) && sessionOk;

  return (
    <dialog ref={dlg} className="dialog" onClose={() => st.setAddAgentOpen(false)} aria-labelledby="add-h">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canHire) return;
          const mgr = team.find((a) => a.role === 'manager');
          st.hireAgent({
            id,
            teamId,
            name: name.trim(),
            role,
            roleTitle: title.trim(),
            model,
            effort,
            outputStyle,
            color: AGENT_COLORS[Object.keys(agentsRec).length % AGENT_COLORS.length],
            sessionId: isAdvisor ? session.trim() : newSessionId(),
            ...(isAdvisor ? { advisorSession: { sessionId: session.trim(), fork } } : {}),
            status: 'idle',
            activity: '',
            reportsTo: role === 'manager' ? undefined : mgr?.id,
            permissions: isAdvisor ? perms.filter((p) => READ_ONLY_PERMISSIONS.includes(p)) : perms,
            browserMode,
            tokensToday: 0,
            turnsThisHour: 0,
            currentTask: brief.trim() || undefined,
            memoryExcerpt: [],
          });
          st.setAddAgentOpen(false);
          st.selectAgent(agentKey(teamId, id));
        }}
      >
        <header className="dialog__head">
          <h2 id="add-h">{t('add.title', { team: teamObj?.name ?? '' })}</h2>
          <button type="button" className="icon-btn" onClick={() => st.setAddAgentOpen(false)} aria-label={t('common.close')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="dialog__grid">
          <div className="dialog__fields">
            <fieldset className="roles">
              <legend>{t('add.role')}</legend>
              {ROLES.map((r) => (
                <label key={r} className={`role-opt${role === r ? ' is-on' : ''}${r === 'manager' && hasManager ? ' is-off' : ''}`}>
                  <input type="radio" name="role" value={r} checked={role === r} disabled={r === 'manager' && hasManager} onChange={() => pick(r)} />
                  {t(`role.${r}` as TKey)}
                </label>
              ))}
            </fieldset>
            {hasManager && <p className="muted small">{t('add.hasManager')}</p>}

            <div className="two">
              <label>
                <span>{t('add.name')}</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('add.namePh')} required />
              </label>
              <label>
                <span>{t('add.jobTitle')}</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('add.jobTitlePh')} required />
              </label>
            </div>

            <fieldset className="models">
              <legend>{t('add.model')}</legend>
              {MODELS.map((m) => (
                <label key={m.id} className={`model-opt${model === m.id ? ' is-on' : ''}`}>
                  <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
                  <span className="model-opt__name">{m.label}</span>
                  <span className="model-opt__note">{t(`model.${m.id}` as TKey)}</span>
                </label>
              ))}
            </fieldset>

            {isAdvisor && (
              <div className="advisor-box">
                <label>
                  <span>{t('add.session')}</span>
                  <input className="input mono" value={session} onChange={(e) => setSession(e.target.value)} placeholder={t('add.sessionPh')} />
                </label>
                <small className="muted">{t('add.sessionHint')}</small>
                <label className="check">
                  <input type="checkbox" checked={fork} onChange={(e) => setFork(e.target.checked)} />
                  <span>
                    {t('add.fork')}
                    <small>{t('add.forkHint')}</small>
                  </span>
                </label>
                <p className="advisor-box__ro">{t('add.readOnly')}</p>
              </div>
            )}

            <EffortStyle idPrefix="add" effort={effort} style={outputStyle} onChange={(e, o) => { setEffort(e); setOutputStyle(o); }} />

            <label>
              <span>{t('add.brief')}</span>
              <textarea className="input" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t('add.briefPh')} />
            </label>

            <Permissions grid readOnly={isAdvisor} legend={t('drawer.cando')} perms={perms} mode={browserMode} onChange={(p, m) => { setPerms(p); setBrowserMode(m); }} />
          </div>

          <aside className="dialog__preview">
            <h3>{t('add.files')}</h3>
            <p className="mono small muted path">{company.rootPath}\</p>
            <pre className="tree mono">
{`employees\\${teamId}\\${id}\\
├─ CLAUDE.md
├─ agent.json
├─ memory.md
├─ .claude\\
│  └─ settings.json
└─ workspace\\`}
            </pre>
            <p className="small muted">{t('add.filesNote')}</p>
          </aside>
        </div>

        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={() => st.setAddAgentOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canHire}>
            {t('add.submit', { name: name.trim() || t('add.agent') })}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
