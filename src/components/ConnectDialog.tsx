import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { api, bridge } from '../api';

/**
 * Choose the Claude account the agents use. Nothing is used until the owner chooses:
 * sign in on claude.ai (paste the code back, or it finishes by itself in a browser on the OfficeX computer),
 * or explicitly use the Claude Code login of the OfficeX computer.
 */
function AccountSection() {
  const t = useT();
  const claude = useStore((s) => s.claude);
  const [step, setStep] = useState<'idle' | 'starting' | 'code' | 'finishing'>('idle');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const startedAt = useRef(0);
  const acc = claude.account ?? { mode: 'none' as const };

  // finished without a code (browser on the OfficeX computer): the new account arrives as a state update
  useEffect(() => {
    if ((step === 'code' || step === 'finishing') && acc.mode === 'officex' && (acc.since ?? 0) >= startedAt.current) {
      setStep('idle');
      setMsg({ kind: 'ok', text: t('acct.done', { name: acc.label ?? '' }) });
    }
  }, [acc.mode, acc.since, acc.label, step, t]);

  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
      setStep('idle');
    }
  };
  const start = () =>
    run(async () => {
      setStep('starting');
      startedAt.current = Date.now();
      const r = await api<{ url: string }>('POST', 'api/claude/login', { action: 'start', label });
      setUrl(r.url);
      setCode('');
      setStep('code');
    });
  const finish = () =>
    run(async () => {
      setStep('finishing');
      const r = await api<{ label?: string }>('POST', 'api/claude/login', { action: 'code', code });
      setMsg({ kind: 'ok', text: t('acct.done', { name: r.label ?? '' }) });
      setStep('idle');
    });
  const cancel = () => {
    api('POST', 'api/claude/login', { action: 'cancel' }).catch(() => {});
    setStep('idle');
  };
  const useComputer = () =>
    run(async () => {
      await api('POST', 'api/claude/login', { action: 'computer' });
      setMsg({ kind: 'ok', text: t('acct.computerChosen') });
    });
  const signOut = () =>
    run(async () => {
      await api('POST', 'api/claude/login', { action: 'logout' });
      setMsg({ kind: 'ok', text: t('acct.signedOut') });
    });

  return (
    <section className="acct">
      <h3>{t('acct.title')}</h3>
      <p className="acct__now">{acc.mode === 'officex' ? t('acct.officex', { name: acc.label ?? '' }) : acc.mode === 'computer' ? t('acct.computer') : t('acct.none')}</p>
      {step === 'idle' && (
        <>
          <div className="acct__row">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('acct.labelPh')} aria-label={t('acct.labelPh')} />
            <button className={`btn btn--sm ${acc.mode === 'none' ? 'btn--primary' : 'btn--ghost'}`} onClick={start}>
              {acc.mode === 'none' ? t('acct.signIn') : t('acct.switch')}
            </button>
          </div>
          <div className="acct__row acct__row--wrap">
            {acc.mode !== 'computer' && (
              <button className="btn btn--ghost btn--sm" onClick={useComputer}>
                {t('acct.useComputer')}
              </button>
            )}
            {acc.mode !== 'none' && (
              <button className="btn btn--ghost btn--sm" onClick={signOut}>
                {t('acct.signOut')}
              </button>
            )}
          </div>
          {acc.mode !== 'computer' && <p className="muted small">{t('acct.computerHint')}</p>}
        </>
      )}
      {step === 'starting' && <p className="muted small">{t('acct.starting')}</p>}
      {(step === 'code' || step === 'finishing') && (
        <ol className="steps acct__steps">
          <li>
            <a className="btn btn--primary btn--sm" href={url} target="_blank" rel="noopener noreferrer">
              {t('acct.open')}
            </a>
            <span className="muted small"> {t('acct.openHint')}</span>
          </li>
          <li>
            {t('acct.paste')}
            <div className="acct__row">
              <input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc123…#…" autoComplete="off" spellCheck={false} />
              <button className="btn btn--primary btn--sm" onClick={finish} disabled={!code.trim() || step === 'finishing'}>
                {step === 'finishing' ? '…' : t('acct.finish')}
              </button>
            </div>
            <p className="muted small">{t('acct.autoHint')}</p>
          </li>
          <li>
            <button className="btn btn--ghost btn--sm" onClick={cancel}>
              {t('common.cancel')}
            </button>
          </li>
        </ol>
      )}
      {msg && <p className={msg.kind === 'ok' ? 'np__note' : 'np__error'}>{msg.text}</p>}
      <p className="muted small">{t('acct.note')}</p>
    </section>
  );
}

export function ConnectDialog() {
  const t = useT();
  const open = useStore((s) => s.connectOpen);
  const claude = useStore((s) => s.claude);
  const setOpen = useStore((s) => s.setConnectOpen);
  const connect = useStore((s) => s.connectClaude);
  const disconnect = useStore((s) => s.disconnectClaude);
  const dlg = useRef<HTMLDialogElement>(null);
  const was = useRef(claude.state);

  useEffect(() => {
    if (open && !dlg.current?.open) dlg.current?.showModal();
    if (!open && dlg.current?.open) dlg.current.close();
  }, [open]);

  // close shortly after a successful connection so the owner sees the office wake up
  useEffect(() => {
    if (was.current === 'connecting' && claude.state === 'connected') window.setTimeout(() => setOpen(false), 900);
    was.current = claude.state;
  }, [claude.state, setOpen]);

  const connected = claude.state === 'connected';
  const account = claude.account?.mode ?? 'none';
  // live mode: without a chosen account "Connect" cannot work, the account section is the way in
  const canConnect = !bridge.on || account !== 'none' || claude.error === 'missing';
  return (
    <dialog ref={dlg} className="dialog dialog--narrow" onClose={() => setOpen(false)} aria-labelledby="conn-h">
      <div className="dialog__head">
        <h2 id="conn-h">{connected ? t('connect.doneTitle') : t('connect.title')}</h2>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label={t('common.close')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="dialog__body">
        {bridge.on ? (
          <>
            {claude.error === 'missing' && <p className="np__error">{t('connect.missing')}</p>}
            {claude.error === 'login' && <p className="np__error">{account === 'officex' ? t('acct.rejected', { name: claude.account?.label ?? '' }) : t('connect.login')}</p>}
            {claude.error === 'stopped' && account !== 'none' && <p className="np__note">{t('connect.stopped')}</p>}
            <p>{connected ? t('connect.doneBody') : t('connect.bodyLive')}</p>
            {claude.version && <p className="muted small mono">{t('connect.version', { v: claude.version })}</p>}
            {claude.error !== 'missing' && <AccountSection />}
          </>
        ) : connected ? (
          <p>{t('connect.doneBody')}</p>
        ) : (
          <>
            <p>{t('connect.body')}</p>
            <ol className="steps">
              <li>{t('connect.step1')}</li>
              <li>{t('connect.step2')}</li>
              <li>{t('connect.step3')}</li>
            </ol>
            <p className="muted small">{t('connect.note')}</p>
          </>
        )}
      </div>
      <div className="dialog__foot">
        {connected ? (
          <>
            <button className="btn btn--ghost" onClick={() => { disconnect(); setOpen(false); }}>
              {t('connect.disconnect')}
            </button>
            <button className="btn btn--primary" onClick={() => setOpen(false)}>
              {t('common.close')}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn--ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            {canConnect && (
              <button className="btn btn--primary" onClick={connect} disabled={claude.state === 'connecting'}>
                {claude.state === 'connecting' ? t('claude.connecting') : t('connect.submit')}
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
