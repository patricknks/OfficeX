import { useStore } from '../store';
import { useT } from '../i18n';
import { floorCount } from '../office/floorplan';
import { zoomBy } from '../office/Office';

export function StageOverlay() {
  const t = useT();
  const teams = useStore((s) => s.teams);
  const claude = useStore((s) => s.claude);
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const floorView = useStore((s) => s.floorView);
  const labels = useStore((s) => s.labels);
  const st = useStore.getState();
  const floors = floorCount(teams.length);

  return (
    <>
      <div className="stage-top">
        {claude.state !== 'connected' ? (
          <div className="offline-banner" role="status">
            <span>{t('claude.offlineBanner')}</span>
            <button className="btn btn--primary btn--sm" onClick={() => st.setConnectOpen(true)} disabled={claude.state === 'connecting'}>
              {claude.state === 'connecting' ? t('claude.connecting') : t('claude.connect')}
            </button>
          </div>
        ) : (
          <nav className="room-chips" aria-label={t('teams.title')}>
            {teams.map((team) => (
              <button
                key={team.id}
                className={`room-chip${team.id === selectedTeamId ? ' is-on' : ''}${team.paused ? ' is-paused' : ''}`}
                style={{ ['--tc' as string]: team.color }}
                onClick={() => st.selectTeam(team.id)}
              >
                <span className="room-chip__dot" aria-hidden />
                {team.name}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="toolbar" role="toolbar" aria-label="View">
        {floors > 1 && (
          <div className="seg" role="group">
            <button className={floorView === 'all' ? 'is-on' : ''} onClick={() => { st.setFloorView('all'); st.focusOn({ kind: 'building' }); }}>
              {t('stage.allFloors')}
            </button>
            {Array.from({ length: floors }).map((_, f) => (
              <button key={f} className={floorView === f ? 'is-on' : ''} onClick={() => { st.setFloorView(f); st.focusOn({ kind: 'building' }); }}>
                {t('stage.floor', { n: f + 1 })}
              </button>
            ))}
          </div>
        )}
        <button className="tool" onClick={() => st.focusOn({ kind: 'building' })} title={t('stage.fit')} aria-label={t('stage.fit')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tool" onClick={() => zoomBy(1 / 1.3)} title={t('stage.zoomOut')} aria-label={t('stage.zoomOut')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tool" onClick={() => zoomBy(1.3)} title={t('stage.zoomIn')} aria-label={t('stage.zoomIn')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="tool tool--text"
          onClick={() => st.cycleLabels()}
          title={labels === 'full' ? t('stage.labelsFull') : labels === 'names' ? t('stage.labelsNames') : t('stage.labelsOff')}
        >
          Aa
          <span className="tool__sub">{labels === 'full' ? t('stage.labelsFull') : labels === 'names' ? t('stage.labelsNames') : t('stage.labelsOff')}</span>
        </button>
      </div>
      <p className="stage__hint">{t('stage.hint')}</p>
    </>
  );
}
