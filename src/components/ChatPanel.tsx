import { useEffect, useMemo, useRef, useState } from 'react';
import { memberKey, nextId, useStore } from '../store';
import { useT } from '../i18n';
import { MODELS, OFFICE_ID, type Attachment, type Message, type Room } from '../types';
import { clock } from '../util';
import { Markdown } from './Markdown';

const STEP_ICON: Record<string, string> = { Read: 'R', Write: 'W', Edit: 'E', Bash: '$', Grep: '?', WebSearch: 'S', WebFetch: 'F', Browser: 'C', ShowOnProjector: 'P', SendMessage: '@', Telegram: 'T', Schedule: '⏱' };

function Steps({ steps }: { steps: NonNullable<Message['steps']> }) {
  const t = useT();
  return (
    <details className="steps-trail">
      <summary>{t('chat.steps', { n: steps.length })}</summary>
      <ol>
        {steps.map((st, i) => (
          <li key={i}>
            <span className="steps-trail__icon" aria-hidden>
              {STEP_ICON[st.tool] ?? '•'}
            </span>
            <span className="steps-trail__tool">{st.tool}</span>
            <span className="steps-trail__detail">{st.detail}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);

function Attachments({ items }: { items: Attachment[] }) {
  return (
    <div className="atts">
      {items.map((a) =>
        a.mime.startsWith('image/') ? (
          <a key={a.id} className="att-img" href={a.url} target="_blank" rel="noopener noreferrer" title={a.savedPath ?? a.name}>
            <img src={a.url} alt={a.name} />
          </a>
        ) : (
          <a key={a.id} className="att-file" href={a.url} target="_blank" rel="noopener noreferrer" title={a.savedPath ?? a.name}>
            <span className="att-file__ext">{(a.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>
            <span className="att-file__name">{a.name}</span>
            <span className="att-file__size">{fmtSize(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

/** Upload one file to the company inbox; falls back to a local preview when there is no server. */
async function upload(file: File): Promise<Attachment> {
  const base = { id: nextId('att'), name: file.name || 'pasted.png', size: file.size, mime: file.type || 'application/octet-stream' };
  try {
    const res = await fetch('api/uploads', {
      method: 'POST',
      headers: { 'content-type': base.mime, 'x-file-name': encodeURIComponent(base.name) },
      body: file,
    });
    if (res.ok) {
      const body = await res.json();
      return { ...base, url: body.url, savedPath: body.path };
    }
  } catch {
    /* no server: keep it in this browser only */
  }
  return { ...base, url: URL.createObjectURL(file) };
}

export function ChatPanel() {
  const t = useT();
  const teamId = useStore((s) => s.selectedTeamId);
  const team = useStore((s) => s.teams.find((x) => x.id === s.selectedTeamId));
  const teams = useStore((s) => s.teams);
  const claude = useStore((s) => s.claude);
  const rooms = useStore((s) => s.rooms);
  const messages = useStore((s) => s.messages);
  const agents = useStore((s) => s.agents);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const chat = useStore((s) => s.chat);
  const st = useStore.getState();
  const isOffice = teamId === OFFICE_ID;

  const teamRooms = useMemo(() => rooms.filter((r) => r.teamId === teamId && r.kind !== 'consult'), [rooms, teamId]);
  const consults = useMemo(() => rooms.filter((r) => r.kind === 'consult' && r.teams?.includes(teamId)), [rooms, teamId]);
  const ceoRoom = teamRooms.find((r) => r.kind === 'ceo');
  const teamRoom = teamRooms.find((r) => r.kind === 'team' || r.kind === 'reports');
  const dms = teamRooms.filter((r) => r.kind === 'dm');
  const all = [...teamRooms, ...consults];
  const active: Room | undefined = all.find((r) => r.id === activeRoomId) ?? ceoRoom ?? teamRoom;
  const tab = active?.kind ?? 'ceo';

  const mgr = ceoRoom ? agents[memberKey(ceoRoom, ceoRoom.members[1])] : undefined;
  const list = useMemo(() => messages.filter((m) => m.roomId === active?.id).sort((a, b) => a.ts - b.ts), [messages, active?.id]);

  // unread markers: messages that arrived since a room was last opened
  const seen = useRef<Record<string, number>>({});
  const mountTs = useRef(Date.now());
  if (active && !chat.collapsed) seen.current[active.id] = Date.now();
  const unread = (id: string) => messages.filter((m) => m.roomId === id && m.ts > (seen.current[id] ?? mountTs.current) && m.from !== 'ceo').length;
  const dmUnread = dms.reduce((n, r) => n + unread(r.id), 0);
  const consultUnread = consults.reduce((n, r) => n + unread(r.id), 0);
  const totalUnread = all.reduce((n, r) => n + unread(r.id), 0);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [list.length, active?.id]);

  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => pending.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [pending]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const who = (room: Room, id: string) => {
    if (id === 'ceo') return { name: t('chat.you'), color: '#ffffff' };
    if (id === 'system') return { name: t('chat.system'), color: '#93a4b3' };
    const a = agents[memberKey(room, id)];
    return a ?? { name: id, color: '#93a4b3' };
  };
  const teamName = (id: string) => teams.find((x) => x.id === id)?.name ?? id;

  // ---- resize & minimize ----
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const max = Math.min(980, window.innerWidth - 520);
      st.setChat({ width: Math.round(Math.max(320, Math.min(max, window.innerWidth - ev.clientX))) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const title = isOffice ? t('office.title') : team?.name;

  if (chat.collapsed) {
    return (
      <aside className="chat chat--collapsed" aria-label={title}>
        <button className="chat__rail" onClick={() => st.setChat({ collapsed: false })} aria-label={t('chat.expand')} title={t('chat.expand')}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {totalUnread > 0 && <span className="badge">{totalUnread}</span>}
          <span className="chat__rail-title">{title}</span>
        </button>
      </aside>
    );
  }

  const Tab = ({ room, kind, label, count }: { room?: Room; kind: Room['kind']; label: string; count: number }) => (
    <button role="tab" aria-selected={tab === kind} className="tab" disabled={!room} onClick={() => room && st.setActiveRoom(room.id)}>
      {label}
      {count > 0 && <span className="badge">{count}</span>}
    </button>
  );

  const queued = claude.state !== 'connected' ? t('chat.queuedOffline') : team?.paused ? t('chat.queuedPaused') : null;
  const addFiles = (files: FileList | File[]) => setPending((p) => [...p, ...Array.from(files)].slice(0, 10));

  async function send() {
    if (!draft.trim() && !pending.length) return;
    setBusy(true);
    const atts = await Promise.all(pending.map(upload));
    st.sendAsCeo(draft.trim(), atts);
    setDraft('');
    setPending([]);
    setBusy(false);
  }

  const context =
    tab === 'ceo'
      ? isOffice
        ? t('chat.ctxOffice')
        : t('chat.ctxCeo')
      : tab === 'team'
        ? t('chat.ctxTeam')
        : tab === 'reports'
          ? t('chat.ctxReports')
          : tab === 'consult'
            ? t('chat.ctxConsult')
            : t('chat.ctxDm');

  return (
    <section className="chat" aria-label={title}>
      <div className="chat__resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label={t('chat.resize')} title={t('chat.resize')} />
      <header className="chat__head" style={{ ['--tc' as string]: team?.color ?? '#e8e4da' }}>
        <span className="chat__swatch" aria-hidden />
        <h2>{title}</h2>
        <button className="icon-btn" onClick={() => st.setChat({ collapsed: true })} aria-label={t('chat.minimize')} title={t('chat.minimize')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="tabs" role="tablist">
        <Tab room={ceoRoom} kind="ceo" label={mgr ? t('chat.ceo', { name: mgr.name }) : t('role.manager')} count={ceoRoom ? unread(ceoRoom.id) : 0} />
        {isOffice ? (
          <Tab room={teamRoom} kind="reports" label={t('chat.reports')} count={teamRoom ? unread(teamRoom.id) : 0} />
        ) : (
          <>
            <Tab room={teamRoom} kind="team" label={t('chat.team')} count={teamRoom ? unread(teamRoom.id) : 0} />
            <Tab room={tab === 'dm' ? active : dms[0]} kind="dm" label={t('chat.dm')} count={dmUnread} />
            <button role="tab" aria-selected={tab === 'consult'} className="tab" onClick={() => consults[0] && st.setActiveRoom(consults[0].id)} disabled={!consults.length}>
              {t('chat.consult')}
              {consultUnread > 0 && <span className="badge">{consultUnread}</span>}
            </button>
          </>
        )}
      </div>

      {tab === 'dm' && (
        <div className="dm-picker" role="group">
          {dms.map((r) => {
            const a = agents[memberKey(r, r.members[1])];
            const n = unread(r.id);
            return (
              <button key={r.id} className={`chip${r.id === active?.id ? ' is-on' : ''}`} style={{ ['--c' as string]: a?.color }} onClick={() => st.setActiveRoom(r.id)}>
                <span className="swatch" />
                {t('chat.dmPair', { a: mgr?.name ?? '', b: a?.name ?? '' })}
                {n > 0 && <span className="badge">{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      {tab === 'consult' && (
        <div className="dm-picker" role="group">
          {consults.map((r) => {
            const other = (r.teams ?? []).find((x) => x !== teamId) ?? '';
            const n = unread(r.id);
            return (
              <button key={r.id} className={`chip${r.id === active?.id ? ' is-on' : ''}`} style={{ ['--c' as string]: teams.find((x) => x.id === other)?.color }} onClick={() => st.setActiveRoom(r.id)}>
                <span className="swatch" />
                {t('chat.dmPair', { a: team?.name ?? '', b: teamName(other) })}
                {n > 0 && <span className="badge">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      <p className="chat__context">
        {!ceoRoom && !isOffice ? t('chat.noManager') : context}
        {active && <span className="mono chat__file">chat/{active.id}.jsonl</span>}
      </p>

      <div className="chat__scroll" ref={scroller}>
        {list.length === 0 && (
          <p className="chat__empty">
            {tab === 'consult' ? t('chat.noConsult') : t('chat.empty')}
            {tab === 'ceo' && ceoRoom && ` ${t('chat.emptyCeo')}`}
          </p>
        )}
        {active &&
          list.map((m, i) => {
            const w = who(active, m.from);
            const prev = list[i - 1];
            const grouped = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60_000;
            const mine = m.from === 'ceo';
            const fromTeam = m.from.includes('/') ? m.from.split('/')[0] : null;
            return (
              <article key={m.id} className={`msg${mine ? ' msg--mine' : ''}${grouped ? ' msg--grouped' : ''}`} style={{ ['--c' as string]: w.color }}>
                {!grouped && (
                  <header>
                    <span className="msg__name">{w.name}</span>
                    {fromTeam && fromTeam !== OFFICE_ID && (active.kind === 'reports' || active.kind === 'consult') && <span className="msg__team">{teamName(fromTeam)}</span>}
                    <time>{clock(m.ts)}</time>
                    {m.run && (m.run.model || m.run.effort) && (
                      <span className="msg__run" title={t('chat.runTitle')}>
                        {[m.run.model && (MODELS.find((x) => x.id === m.run?.model)?.label ?? m.run.model), m.run.effort && t(`effort.${m.run.effort}` as 'effort.low')].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </header>
                )}
                {m.steps && m.steps.length > 0 && <Steps steps={m.steps} />}
                {m.text && (mine ? <p>{m.text}</p> : <Markdown text={m.text} />)}
                {m.attachments && m.attachments.length > 0 && <Attachments items={m.attachments} />}
                {m.projectorId && (
                  <button className="projector-chip" onClick={() => st.openViewer(m.projectorId)}>
                    <span aria-hidden className="projector-chip__icon" />
                    {t('projector.openFromChat')}
                  </button>
                )}
                {m.telegram && <p className={`tg-badge tg-badge--${m.telegram}`}>{m.telegram === 'sent' ? t('chat.telegramSent') : t('chat.telegramFailed')}</p>}
              </article>
            );
          })}
      </div>

      {tab === 'ceo' && ceoRoom ? (
        <form
          className={`composer${dragging ? ' is-dragging' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          {queued && <p className="composer__note">{queued}</p>}
          {pending.length > 0 && (
            <ul className="pending">
              {pending.map((f, i) => (
                <li key={i}>
                  {previews[i] ? <img src={previews[i]} alt="" /> : <span className="att-file__ext">{(f.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>}
                  <span className="pending__name">{f.name || 'image.png'}</span>
                  <button type="button" className="icon-btn" onClick={() => setPending(pending.filter((_, j) => j !== i))} aria-label={t('chat.removeAttachment', { name: f.name })}>
                    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="composer__row">
            <button type="button" className="icon-btn composer__attach" onClick={() => fileInput.current?.click()} aria-label={t('chat.attach')} title={t('chat.attach')}>
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
                <path d="M10.5 4.5 5.8 9.2a1.3 1.3 0 0 0 1.8 1.8l5-5a2.6 2.6 0 0 0-3.7-3.7l-5 5a3.9 3.9 0 0 0 5.5 5.5L13 9.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <label htmlFor="composer" className="sr-only">
              {t('chat.placeholder', { name: mgr?.name ?? '' })}
            </label>
            <textarea
              id="composer"
              className="input"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`, { type: f.type }))));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
              placeholder={t('chat.placeholderAttach', { name: mgr?.name ?? '' })}
            />
            <button className="btn btn--primary" type="submit" disabled={busy || (!draft.trim() && !pending.length)}>
              {busy ? t('chat.uploading') : t('chat.send')}
            </button>
          </div>
          {dragging && <div className="composer__drop">{t('chat.drop')}</div>}
        </form>
      ) : (
        <div className="composer composer--readonly">
          <span>{t('chat.readonly', { name: mgr?.name ?? t('role.manager') })}</span>
          {ceoRoom && (
            <button className="btn btn--ghost btn--sm" onClick={() => st.setActiveRoom(ceoRoom.id)}>
              {t('chat.openCeo', { name: mgr?.name ?? '' })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
