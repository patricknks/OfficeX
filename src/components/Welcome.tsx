import { useStore } from '../store';
import { tr } from '../i18n';
import type { Lang } from '../types';

const OPTIONS: { id: Lang; label: string; sample: string }[] = [
  { id: 'en', label: 'English', sample: 'Your agents will report to you in English.' },
  { id: 'id', label: 'Bahasa Indonesia', sample: 'Agent kamu akan melapor dalam Bahasa Indonesia.' },
];

export function Welcome() {
  const choose = useStore((s) => s.chooseLanguage);
  return (
    <main className="welcome">
      <div className="welcome__card">
        <div className="brand brand--lg">
          <span className="brand__mark" aria-hidden />
          OfficeX
        </div>
        <h1>
          {tr('en', 'lang.title')}
          <span lang="id">{tr('id', 'lang.title')}</span>
        </h1>
        <div className="welcome__options">
          {OPTIONS.map((o) => (
            <button key={o.id} className="lang-opt" onClick={() => choose(o.id)} lang={o.id}>
              <span className="lang-opt__label">{o.label}</span>
              <span className="lang-opt__sample">{o.sample}</span>
            </button>
          ))}
        </div>
        <p className="welcome__note">
          {tr('en', 'lang.note')}
          <br />
          <span lang="id">{tr('id', 'lang.note')}</span>
        </p>
      </div>
    </main>
  );
}
