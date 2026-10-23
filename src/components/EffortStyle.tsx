import { useT, type TKey } from '../i18n';
import { EFFORTS, OUTPUT_STYLES, type EffortLevel, type OutputStyle } from '../types';

interface Props {
  effort: EffortLevel;
  style: OutputStyle;
  onChange: (effort: EffortLevel, style: OutputStyle) => void;
  idPrefix: string;
}

/** Effort (claude --effort) and reply style (outputStyle) for one agent. */
export function EffortStyle({ effort, style, onChange, idPrefix }: Props) {
  const t = useT();
  return (
    <div className="effort-style">
      <fieldset className="effort">
        <legend>{t('drawer.effort')}</legend>
        <div className="seg seg--block" role="radiogroup">
          {EFFORTS.map((e) => (
            <label key={e} className={effort === e ? 'is-on' : ''}>
              <input type="radio" name={`${idPrefix}-effort`} checked={effort === e} onChange={() => onChange(e, style)} />
              {t(`effort.${e}` as TKey)}
            </label>
          ))}
        </div>
        <small className="muted">{t('drawer.effortNote')}</small>
      </fieldset>
      <label className="style-select">
        <span>{t('drawer.style')}</span>
        <select className="input" value={style} onChange={(e) => onChange(effort, e.target.value as OutputStyle)}>
          {OUTPUT_STYLES.map((s) => (
            <option key={s} value={s}>
              {t(`style.${s}` as TKey)}: {t(`style.${s}.note` as TKey).toLowerCase()}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
