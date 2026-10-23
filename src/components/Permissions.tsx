import { useStore } from '../store';
import { useT, type TKey } from '../i18n';
import { PERMISSION_IDS, READ_ONLY_PERMISSIONS, type BrowserMode, type Permission } from '../types';

interface Props {
  perms: Permission[];
  mode: BrowserMode;
  onChange: (perms: Permission[], mode: BrowserMode) => void;
  /** agent key being edited, so it does not block itself from using "my Chrome" */
  selfKey?: string;
  grid?: boolean;
  legend?: string;
  /** advisors: only reading permissions can be switched on */
  readOnly?: boolean;
}

/** "Can do" checklist, including the Chrome option and which Chrome to use. */
export function Permissions({ perms, mode, onChange, selfKey, grid, legend, readOnly }: Props) {
  const t = useT();
  const agents = useStore((s) => s.agents);
  const holder = Object.entries(agents).find(([k, a]) => k !== selfKey && a.permissions.includes('browser') && a.browserMode === 'my_chrome')?.[1];
  const hasBrowser = perms.includes('browser');

  const toggle = (p: Permission, on: boolean) => {
    const next = on ? [...perms, p] : perms.filter((x) => x !== p);
    onChange(next, p === 'browser' && on && holder && mode === 'my_chrome' ? 'separate' : mode);
  };

  return (
    <fieldset className={`perms${grid ? ' perms--grid' : ''}`}>
      {legend && <legend>{legend}</legend>}
      {PERMISSION_IDS.map((p) => (
        <div key={p} className={`perm${p === 'browser' ? ' perm--browser' : ''}`}>
          <label>
            <input
              type="checkbox"
              checked={perms.includes(p) && (!readOnly || READ_ONLY_PERMISSIONS.includes(p))}
              disabled={readOnly && !READ_ONLY_PERMISSIONS.includes(p)}
              onChange={(e) => toggle(p, e.target.checked)}
            />
            <span>
              {t(`perm.${p}` as TKey)}
              <small>{t(`perm.${p}.hint` as TKey)}</small>
            </span>
          </label>
          {p === 'browser' && hasBrowser && !readOnly && (
            <div className="browser-mode" role="radiogroup" aria-label={t('browser.label')}>
              {(['separate', 'my_chrome'] as BrowserMode[]).map((m) => {
                const taken = m === 'my_chrome' && !!holder;
                return (
                  <label key={m} className={`browser-opt${mode === m ? ' is-on' : ''}${taken ? ' is-off' : ''}`}>
                    <input type="radio" name={`browser-${selfKey ?? 'new'}`} checked={mode === m} disabled={taken} onChange={() => onChange(perms, m)} />
                    <span className="browser-opt__name">{t(m === 'separate' ? 'browser.separate' : 'browser.mine')}</span>
                    <small>{taken ? t('browser.taken', { name: holder!.name }) : t(m === 'separate' ? 'browser.separateNote' : 'browser.mineNote')}</small>
                  </label>
                );
              })}
              <p className="browser-warn">{t('browser.warn')}</p>
            </div>
          )}
        </div>
      ))}
    </fieldset>
  );
}
