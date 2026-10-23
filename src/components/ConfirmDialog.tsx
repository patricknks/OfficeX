import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';

interface Props {
  open: boolean;
  title: string;
  body: string;
  /** when set, the owner has to type this exactly before the button unlocks */
  typeToConfirm?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<string | void> | string | void;
  onClose: () => void;
}

/** Small destructive-action dialog: delete team, delete project. Returns an error text to keep it open. */
export function ConfirmDialog({ open, title, body, typeToConfirm, confirmLabel, onConfirm, onClose }: Props) {
  const t = useT();
  const dlg = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTyped('');
      setError('');
      setBusy(false);
      if (!dlg.current?.open) dlg.current?.showModal();
      setTimeout(() => input.current?.focus(), 30);
    } else if (dlg.current?.open) dlg.current.close();
  }, [open]);

  const ok = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <dialog ref={dlg} className="dialog dialog--confirm" onClose={onClose} aria-labelledby="confirm-h">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok || busy) return;
          setBusy(true);
          const err = await onConfirm();
          setBusy(false);
          if (err) setError(err);
          else onClose();
        }}
      >
        <header className="dialog__head">
          <h2 id="confirm-h">{title}</h2>
        </header>
        <div className="dialog__fields">
          <p>{body}</p>
          {typeToConfirm && (
            <label>
              <span>{t('confirm.type', { name: typeToConfirm })}</span>
              <input ref={input} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
          {error && (
            <p className="np__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--danger" disabled={!ok || busy}>
            {busy ? '…' : confirmLabel ?? t('confirm.delete')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/** Ask the local server to archive a team or project. A missing server (static preview) is fine. */
export async function archive(url: string): Promise<string | void> {
  try {
    const r = await fetch(url, { method: 'DELETE' });
    if (r.ok || r.status === 404 || r.status === 409) return; // 404 = never had a folder, 409 = no companyRoot
    const b = await r.json().catch(() => ({}));
    return b.error ?? `HTTP ${r.status}`;
  } catch {
    /* static preview without the server */
  }
}
