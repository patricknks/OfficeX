import { useStore } from '../store';
import { useT } from '../i18n';
import type { Lang } from '../types';
import { UsageMeter } from './UsageMeter';

export function TopBar() {
  const t = useT();
  const company = useStore((s) => s.company);
  const claude = useStore((s) => s.claude);
  const teams = useStore((s) => s.teams);
  const lang = useStore((s) => s.lang) ?? 'en';
  const setAllPaused = useStore((s) => s.setAllPaused);
  const chooseLanguage = useStore((s) => s.chooseLanguage);
  const openConnect = useStore((s) => s.setConnectOpen);
  const allPaused = teams.every((x) => x.paused);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden />
        <span>
          {company.name}
          <small>{t('app.name')}</small>
        </span>
      </div>

      <button className={`conn conn--${claude.state}`} onClick={() => openConnect(true)}>
        <svg className="conn__spark" viewBox="0 0 16 16" aria-hidden>
          <path d="M8 1.5l1.6 4.3 4.3 1.6-4.3 1.6L8 13.3 6.4 9 2.1 7.4l4.3-1.6z" />
        </svg>
        {claude.state === 'connected' ? t('claude.connected') : claude.state === 'connecting' ? t('claude.connecting') : t('claude.connect')}
        <span className="conn__dot" aria-hidden />
      </button>

      <UsageMeter />

      <div className="topbar__right">
        <button className={`btn ${allPaused ? 'btn--warn' : 'btn--ghost'}`} onClick={() => setAllPaused(!allPaused)} aria-pressed={allPaused}>
          {allPaused ? t('all.resume') : t('all.pause')}
        </button>
        <label className="lang-select">
          <span className="sr-only">{t('lang.label')}</span>
          <select className="input" value={lang} onChange={(e) => chooseLanguage(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </label>
      </div>
    </header>
  );
}
