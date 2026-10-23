import { useState } from 'react';
import { agentKey, shownStatus, useStore } from '../store';
import { agoText, useT } from '../i18n';
import { api, bridge } from '../api';
import { MODELS, OFFICE_ID, type ModelId } from '../types';
import { Permissions } from './Permissions';
import { EffortStyle } from './EffortStyle';
import { tokens } from '../util';

const TURN_LIMIT = 30;

export function AgentDrawer() {
  const t = useT();
  const key = useStore((s) => s.selectedAgentKey);
  const agent = useStore((s) => (key ? s.agents[key] : undefined));
  const team = useStore((s) => s.teams.find((x) => x.id === agent?.teamId));
  const boss = useStore((s) => (agent?.reportsTo ? s.agents[agentKey(agent.teamId, agent.reportsTo)] : undefined));
  const company = useStore((s) => s.company);
  const claude = useStore((s) => s.claude);
  const st = useStore.getState();
  const lang = useStore((s) => s.lang) ?? 'en';
  const [showCmd, setShowCmd] = useState(false);

  if (!agent || (!team && agent.teamId !== OFFICE_ID)) return null;
  const folder = agent.teamId === OFFICE_ID ? `${company.rootPath}\\office\\${agent.id}` : `${company.rootPath}\\employees\\${agent.teamId}\\${agent.id}`;
  const shown = shownStatus(agent, team, claude);
  const selfPaused = agent.status === 'paused';
  const turnPct = Math.min(100, (agent.turnsThisHour / TURN_LIMIT) * 100);
  const now =
    shown === 'offline'
      ? t('drawer.offlineText')
      : shown === 'paused'
        ? t('drawer.pausedText')
        : shown === 'team_paused'
          ? t('drawer.teamPausedText')
          : team?.meeting && shown === 'idle'
            ? t('status.meeting')
            : agent.activity || t(`status.${shown}` as never);

  return (
    <aside className="drawer" style={{ ['--c' as string]: agent.color }} aria-label={agent.name}>
      <header className="drawer__head">
        <span className="drawer__chip" aria-hidden />
        <div>
          <h2>{agent.name}</h2>
          <p>
            {agent.roleTitle}
            {boss && <>, {t('drawer.reportsTo', { name: boss.name })}</>}
            {agent.role === 'advisor' && <span className="ro-badge">{t('badge.readOnly')}</span>}
          </p>
        </div>
        <button className="icon-btn" onClick={() => st.selectAgent(null)} aria-label={t('common.close')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="drawer__body">
        <section>
          <h3>{t('drawer.now')}</h3>
          <p className="drawer__now">{now}</p>
          {agent.currentTask && (
            <p className="muted">
              {t('drawer.task')}: <span className="fg">{agent.currentTask}</span>
            </p>
          )}
        </section>

        <section>
          <h3>
            <label htmlFor="model">{t('drawer.model')}</label>
          </h3>
          <select id="model" className="input" value={agent.model} onChange={(e) => st.updateAgent(agent.teamId, agent.id, { model: e.target.value as ModelId })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}, {t(`model.${m.id}` as never).toLowerCase()}
              </option>
            ))}
          </select>
          <EffortStyle
            idPrefix={`d-${agent.teamId}-${agent.id}`}
            effort={agent.effort}
            style={agent.outputStyle}
            onChange={(effort, outputStyle) => st.updateAgent(agent.teamId, agent.id, { effort, outputStyle })}
          />
          <p className="muted small">{t('drawer.modelNote')}</p>
        </section>

        <section>
          <h3>{t('drawer.usage')}</h3>
          <dl className="stats">
            <div>
              <dt>{t('drawer.tokens')}</dt>
              <dd>{tokens(agent.tokensToday)}</dd>
            </div>
            <div>
              <dt>{t('drawer.turns')}</dt>
              <dd>{t('drawer.of', { a: agent.turnsThisHour, b: TURN_LIMIT })}</dd>
            </div>
          </dl>
          <div className="meter" aria-hidden>
            <span style={{ width: `${turnPct}%` }} />
          </div>
        </section>

        {bridge.on && agent.role !== 'advisor' && (
          <section>
            <h3>{t('drawer.context')}</h3>
            <dl className="stats">
              <div>
                <dt>{t('drawer.contextNow')}</dt>
                <dd>{agent.compacting ? t('drawer.compacting') : agent.context ? tokens(agent.context) : '–'}</dd>
              </div>
              <div>
                <dt>{t('drawer.compactedAt')}</dt>
                <dd>{agent.compactedAt ? agoText(lang, agent.compactedAt) : t('drawer.never')}</dd>
              </div>
            </dl>
            {!!agent.compactAt && (
              <div className="meter" aria-hidden>
                <span style={{ width: `${Math.min(100, ((agent.context ?? 0) / agent.compactAt) * 100)}%` }} />
              </div>
            )}
            <p className="muted small">{agent.compactAt ? t('drawer.compactNote', { n: tokens(agent.compactAt) }) : t('drawer.compactOff')}</p>
            <button
              className="btn btn--ghost btn--sm"
              disabled={agent.compacting || !agent.context}
              onClick={() => api('POST', 'api/agents/compact', { teamId: agent.teamId, id: agent.id }).catch(() => {})}
            >
              {t('drawer.compactNow')}
            </button>
          </section>
        )}

        {bridge.on && agent.role === 'manager' && (
          <section>
            <h3>{t('drawer.autoModel')}</h3>
            <label className="check">
              <input type="checkbox" checked={agent.autoModel !== false} onChange={(e) => st.updateAgent(agent.teamId, agent.id, { autoModel: e.target.checked })} />
              <span>{t('drawer.autoModelLabel')}</span>
            </label>
            <p className="muted small">{t('drawer.autoModelNote')}</p>
          </section>
        )}

        <section>
          <h3>{t('drawer.cando')}</h3>
          <Permissions
            readOnly={agent.role === 'advisor'}
            perms={agent.permissions}
            mode={agent.browserMode ?? 'separate'}
            selfKey={key ?? undefined}
            onChange={(permissions, browserMode) => st.updateAgent(agent.teamId, agent.id, { permissions, browserMode })}
          />
        </section>

        <section>
          <h3>{t('drawer.memory')}</h3>
          {agent.memoryExcerpt.length ? (
            <ul className="memory">
              {agent.memoryExcerpt.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('drawer.memoryEmpty')}</p>
          )}
          <p className="mono small muted">memory.md</p>
        </section>

        {agent.advisorSession && (
          <section>
            <h3>{t('drawer.advisorSession')}</h3>
            <p className="mono small path">{agent.advisorSession.sessionId}</p>
            <p className="muted small">{t('drawer.runsAs')}:</p>
            <code className="mono small cmd-line">
              claude -p --resume {agent.advisorSession.sessionId}
              {agent.advisorSession.fork ? ' --fork-session' : ''} --disallowedTools "Write Edit Bash NotebookEdit"
            </code>
            <p className="advisor-box__ro">{t('add.readOnly')}</p>
          </section>
        )}
        {agent.role === 'secretary' && (
          <section>
            <h3>Telegram</h3>
            <p>{agent.telegram?.configured ? t('office.telegramOn') : t('office.telegramOff')}</p>
            <button className="btn btn--ghost btn--sm" onClick={() => st.setSecretaryOpen(true)}>
              {t('sec.configure')}
            </button>
          </section>
        )}
        <section>
          <h3>{t('drawer.files')}</h3>
          <p className="mono small path">{folder}</p>
          <p className="mono small muted">{t('drawer.session', { id: agent.sessionId })}</p>
        </section>
      </div>

      <footer className="drawer__foot">
        {showCmd && (
          <div className="cmd">
            <p className="small">{t('drawer.terminalNote')}</p>
            <code className="mono">
              cd "{folder}"
              <br />
              claude --resume {agent.sessionId}
            </code>
          </div>
        )}
        <div className="drawer__actions">
          <button className="btn btn--ghost" onClick={() => setShowCmd((v) => !v)}>
            {t('drawer.terminal')}
          </button>
          <button className={`btn ${selfPaused ? 'btn--primary' : 'btn--ghost'}`} onClick={() => st.setAgentPaused(agent.teamId, agent.id, !selfPaused)}>
            {selfPaused ? t('drawer.resume', { name: agent.name }) : t('drawer.pause', { name: agent.name })}
          </button>
        </div>
      </footer>
    </aside>
  );
}
