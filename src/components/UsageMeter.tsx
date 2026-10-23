import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { agoText, useT } from '../i18n';
import { api, bridge } from '../api';
import type { Lang, UsageWindow } from '../types';

const ORDER: UsageWindow[] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

/** "Resets at 4:50 AM" for today, "Resets Sun 5:00 PM" later in the week, like claude.ai. */
function resetText(lang: Lang, at: number) {
  const d = new Date(at);
  const loc = lang === 'id' ? 'id-ID' : 'en-US';
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) return time;
  const left = at - Date.now();
  if (left < 6 * 86400_000) return `${d.toLocaleDateString(loc, { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })} ${time}`;
}
const level = (pct: number) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');

/** Plan usage in the top bar: current session and this week, with details on click. */
export function UsageMeter() {
  const t = useT();
  const lang = useStore((s) => s.lang) ?? 'en';
  const claude = useStore((s) => s.claude);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const iv = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(iv);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!bridge.on || !claude.account || claude.account.mode === 'none') return null;
  const u = claude.usage;
  const now = Date.now();
  // a window that has reset since the last reading starts again at 0
  const win = (k: UsageWindow) => {
    const w = u?.windows?.[k];
    if (!w) return null;
    return w.resetsAt && w.resetsAt < now ? { pct: 0, resetsAt: undefined } : w;
  };
  const shown = ORDER.filter((k) => win(k));
  const refresh = async () => {
    setBusy(true);
    try {
      await api('POST', 'api/usage');
    } catch {
      /* the error shows in the panel */
    }
    setBusy(false);
  };

  return (
    <div className="usage" ref={box}>
      <button className="usage__chip" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title={t('usage.title')}>
        {(['five_hour', 'seven_day'] as UsageWindow[]).map((k) => {
          const w = win(k);
          return (
            <span key={k} className="usage__mini">
              <span className="usage__label">{t(k === 'five_hour' ? 'usage.short5h' : 'usage.short7d')}</span>
              <span className="usage__track">
                <span className={`usage__fill usage__fill--${w ? level(w.pct) : 'ok'}`} style={{ width: `${Math.min(100, w?.pct ?? 0)}%` }} />
              </span>
              <span className="usage__pct">{w ? `${Math.round(w.pct)}%` : '–'}</span>
            </span>
          );
        })}
      </button>
      {open && (
        <div className="usage__panel" role="dialog" aria-label={t('usage.title')}>
          <h3>{t('usage.title')}</h3>
          {claude.account.mode === 'officex' && claude.account.label && <p className="muted small">{claude.account.label}</p>}
          {shown.length === 0 && <p className="muted small">{u?.probe ? t('usage.oldClaude') : t('usage.empty')}</p>}
          {shown.map((k) => {
            const w = win(k)!;
            return (
              <div key={k} className="usage__row">
                <div>
                  <strong>{t(`usage.${k}` as 'usage.five_hour')}</strong>
                  <span className="muted small">{w.resetsAt ? t('usage.resets', { at: resetText(lang, w.resetsAt) }) : t('usage.fresh')}</span>
                </div>
                <span className="usage__track usage__track--lg">
                  <span className={`usage__fill usage__fill--${level(w.pct)}`} style={{ width: `${Math.min(100, w.pct)}%` }} />
                </span>
                <span className="usage__used">{t('usage.used', { n: Math.round(w.pct) })}</span>
              </div>
            );
          })}
          <div className="usage__foot">
            <span className="muted small">
              {u?.updated ? t('usage.updated', { ago: agoText(lang, u.updated) }) : ''}
              {u?.source === 'turns' ? ` · ${t('usage.fromTurns')}` : ''}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={refresh} disabled={busy}>
              {busy ? '…' : t('usage.refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
