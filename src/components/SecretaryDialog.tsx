import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { newSessionId } from '../mock/data';
import { MODELS, OFFICE_ID, type ModelId, type SecretaryNotify } from '../types';

const DEFAULT_NOTIFY: SecretaryNotify = { input: true, report: true, digest: '07:00' };

type Note = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

/**
 * Add or configure the secretary in the front office. The Telegram token goes straight to the
 * local server (office/secretary/telegram.json); the GUI only keeps "configured" and the chat ID.
 */
export function SecretaryDialog() {
  const t = useT();
  const open = useStore((s) => s.secretaryOpen);
  const agents = useStore((s) => s.agents);
  const st = useStore.getState();
  const sec = Object.values(agents).find((a) => a.teamId === OFFICE_ID && a.role === 'secretary');
  const dlg = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [model, setModel] = useState<ModelId>('claude-haiku-5-5');
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [notify, setNotify] = useState<SecretaryNotify>(DEFAULT_NOTIFY);
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState<'' | 'find' | 'save'>('');
  const [note, setNote] = useState<Note>(null);
  const [chats, setChats] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!open) {
      if (dlg.current?.open) dlg.current.close();
      return;
    }
    const cur = Object.values(useStore.getState().agents).find((a) => a.teamId === OFFICE_ID && a.role === 'secretary');
    setName(cur?.name ?? 'Sekar');
    setModel(cur?.model ?? 'claude-haiku-5-5');
    setToken('');
    setChatId(cur?.telegram?.chatId ?? '');
    setNotify(cur?.telegram?.notify ?? DEFAULT_NOTIFY);
    setStored(!!cur?.telegram?.configured);
    setNote(null);
    setChats([]);
    if (!dlg.current?.open) dlg.current?.showModal();
    // what the server already has (token itself is never returned)
    fetch('api/secretary/telegram')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!b) return;
        setStored(!!b.configured);
        if (b.chatId) setChatId(String(b.chatId));
        if (b.notify) setNotify(b.notify);
      })
      .catch(() => undefined);
  }, [open]);

  async function find() {
    setBusy('find');
    setNote(null);
    try {
      const r = await fetch('api/secretary/telegram/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      const b = await r.json();
      if (b.ok && b.chats?.length) {
        setChats(b.chats);
        setChatId(String(b.chats[0].id));
        setNote({ kind: 'ok', text: t('sec.found', { list: b.chats.map((c: { id: string; name: string }) => `${c.name || '?'} (${c.id})`).join(', ') }) });
      } else if (b.ok) setNote({ kind: 'warn', text: t('sec.notFound') });
      else setNote({ kind: 'err', text: t('sec.error', { msg: b.error ?? r.status }) });
    } catch {
      setNote({ kind: 'warn', text: t('sec.noServer') });
    }
    setBusy('');
  }

  function upsertAgent(configured: boolean) {
    const telegram = { configured, chatId: chatId.trim() || undefined, notify };
    if (sec) st.updateAgent(OFFICE_ID, sec.id, { name: name.trim() || sec.name, model, telegram });
    else
      st.hireAgent({
        id: 'secretary',
        teamId: OFFICE_ID,
        name: name.trim() || 'Sekar',
        role: 'secretary',
        roleTitle: t('role.secretary'),
        model,
        effort: 'low',
        outputStyle: 'concise',
        color: '#E8E4DA',
        sessionId: newSessionId(),
        status: 'idle',
        activity: '',
        permissions: ['read_company', 'run_commands'],
        tokensToday: 0,
        turnsThisHour: 0,
        memoryExcerpt: [],
        telegram,
      });
  }

  async function save() {
    setBusy('save');
    setNote(null);
    let configured = stored;
    if (!chatId.trim() || (!stored && !token.trim())) {
      // no Telegram yet: the secretary still works inside the app
      upsertAgent(stored);
      setNote({ kind: 'warn', text: t('sec.savedNoTelegram') });
      setBusy('');
      return;
    }
    try {
      const r = await fetch('api/secretary/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, chatId, notify, test: true, testText: `${name || 'Sekar'}: ${t('sec.testText')}` }),
      });
      const b = await r.json().catch(() => ({}));
      if (r.status === 409 || r.status === 404) setNote({ kind: 'warn', text: t('sec.noServer') });
      else if (b.ok) {
        configured = true;
        setNote({ kind: 'ok', text: t('sec.saved') });
      } else {
        configured = !!b.configured;
        setNote({ kind: 'err', text: t('sec.error', { msg: b.error ?? r.status }) });
      }
    } catch {
      setNote({ kind: 'warn', text: t('sec.noServer') });
    }
    setStored(configured);
    setToken('');
    upsertAgent(configured);
    setBusy('');
  }

  const canSave = !!name.trim() && !busy;
  const willTest = !!chatId.trim() && (stored || !!token.trim());

  return (
    <dialog ref={dlg} className="dialog dialog--narrow" onClose={() => st.setSecretaryOpen(false)} aria-labelledby="sec-h">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <header className="dialog__head">
          <div>
            <h2 id="sec-h">{sec ? t('sec.configure') : t('sec.add')}</h2>
            <p className="muted small">{t('sec.intro')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => st.setSecretaryOpen(false)} aria-label={t('common.close')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="dialog__fields sec">
          <div className="sec__row">
            <label>
              <span>{t('add.name')}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span>{t('add.model')}</span>
              <select className="input" value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>
              {t('sec.token')}
              {stored && <em className="sec__stored">{t('sec.tokenStored')}</em>}
            </span>
            <input
              className="input mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={stored ? t('sec.tokenKeep') : '123456789:AA...'}
            />
            <small className="muted">{t('sec.tokenHint')}</small>
          </label>

          <label>
            <span>{t('sec.chatId')}</span>
            <div className="sec__inline">
              <input className="input mono" value={chatId} onChange={(e) => setChatId(e.target.value)} inputMode="numeric" placeholder="123456789" list="sec-chats" />
              <datalist id="sec-chats">
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </datalist>
              <button type="button" className="btn btn--ghost btn--sm" onClick={find} disabled={!!busy || (!token.trim() && !stored)}>
                {busy === 'find' ? '…' : t('sec.find')}
              </button>
            </div>
            <small className="muted">{t('sec.findHint')}</small>
          </label>

          <fieldset className="sec__when">
            <legend>{t('sec.when')}</legend>
            <label className="check">
              <input type="checkbox" checked={notify.input} onChange={(e) => setNotify({ ...notify, input: e.target.checked })} />
              <span>{t('sec.whenInput')}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={notify.report} onChange={(e) => setNotify({ ...notify, report: e.target.checked })} />
              <span>{t('sec.whenReport')}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={notify.digest !== null} onChange={(e) => setNotify({ ...notify, digest: e.target.checked ? '07:00' : null })} />
              <span>{t('sec.whenDigest')}</span>
              <input
                className="input input--time"
                type="time"
                value={notify.digest ?? '07:00'}
                disabled={notify.digest === null}
                onChange={(e) => setNotify({ ...notify, digest: e.target.value })}
                aria-label={t('sec.whenDigest')}
              />
            </label>
          </fieldset>

          <p className="small muted mono">{t('sec.script')}</p>
          {note && (
            <p className={`sec__note sec__note--${note.kind}`} role="status">
              {note.text}
            </p>
          )}
        </div>

        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={() => st.setSecretaryOpen(false)}>
            {t('common.close')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSave}>
            {busy === 'save' ? '…' : willTest ? t('sec.test') : t('sec.saveOnly')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
