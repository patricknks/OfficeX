import { useCallback, useEffect, useRef, useState } from 'react';
import { agentKey, useStore } from '../store';
import { useT } from '../i18n';
import { clock } from '../util';
import { drawLiveChart } from '../office/liveChart';

type View = { s: number; x: number; y: number };
const MIN = 0.05;
const MAX = 12;

/** Full-screen image viewer for the projector: zoom with the wheel or buttons, drag to pan. */
export function ProjectorViewer() {
  const t = useT();
  const viewer = useStore((s) => s.viewer);
  const items = useStore((s) => s.projector);
  const agents = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const close = useStore((s) => s.closeViewer);
  const open = useStore((s) => s.openViewer);

  const idx = Math.max(0, items.findIndex((i) => i.id === viewer.id));
  const item = items[idx];
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const fitScale = useCallback(() => {
    const el = stage.current;
    const im = img.current;
    const cv = canvas.current;
    const w = cv ? cv.width : im?.naturalWidth ?? 0;
    const h = cv ? cv.height : im?.naturalHeight ?? 0;
    if (!el || !w) return 1;
    return Math.min(el.clientWidth / w, el.clientHeight / h) * 0.96;
  }, []);
  const fit = useCallback(() => setView({ s: fitScale(), x: 0, y: 0 }), [fitScale]);
  const actual = () => setView({ s: 1, x: 0, y: 0 });

  /** Zoom by factor k keeping the point (px, py), relative to the stage centre, still. */
  const zoomAt = (k: number, px = 0, py = 0) =>
    setView((v) => {
      const s = Math.min(MAX, Math.max(MIN, v.s * k));
      const r = s / v.s;
      return { s, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
    });

  const go = (d: number) => {
    const next = items[idx + d];
    if (next) open(next.id);
  };

  useEffect(() => {
    if (viewer.open) closeBtn.current?.focus();
  }, [viewer.open]);

  useEffect(() => {
    if (!viewer.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === '+' || e.key === '=') zoomAt(1.25);
      else if (e.key === '-') zoomAt(1 / 1.25);
      else if (e.key === '0') fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // wheel needs a non-passive listener to stop the page from scrolling
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0015), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewer.open]);

  // live chart: redraw from the store while the viewer is open
  const isLive = item?.kind === 'live';
  useEffect(() => {
    if (!viewer.open || !isLive || !item) return;
    const draw = () => {
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (cv && ctx) drawLiveChart(ctx, cv.width, cv.height, item, useStore.getState().live[item.id]);
    };
    draw();
    fit();
    const h = window.setInterval(draw, 300);
    return () => window.clearInterval(h);
  }, [viewer.open, isLive, item?.id, fit]);

  if (!viewer.open || !item) return null;
  const who = agents[agentKey(item.teamId, item.agentId)];
  const team = teams.find((x) => x.id === item.teamId);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={t('projector.title')}>
      <header className="viewer__bar">
        <div className="viewer__title">
          <h2>{item.title}</h2>
          <p>
            <span className="viewer__dot" style={{ background: who?.color }} aria-hidden />
            {t('projector.by', { name: who?.name ?? item.agentId, time: clock(item.ts) })}
            {team && <>, {team.name}</>}
          </p>
          <p className="mono small muted" title={t('projector.openFile')}>
            {item.path}
          </p>
        </div>
        <div className="viewer__tools" role="toolbar">
          <button className="tool" onClick={() => go(-1)} disabled={idx === 0} aria-label={t('projector.prev')} title={t('projector.prev')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <span className="viewer__count">
            {idx + 1} / {items.length}
          </span>
          <button className="tool" onClick={() => go(1)} disabled={idx === items.length - 1} aria-label={t('projector.next')} title={t('projector.next')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <span className="viewer__sep" />
          <button className="tool" onClick={() => zoomAt(1 / 1.25)} aria-label={t('stage.zoomOut')} title={t('stage.zoomOut')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <span className="viewer__count">{Math.round(view.s * 100)}%</span>
          <button className="tool" onClick={() => zoomAt(1.25)} aria-label={t('stage.zoomIn')} title={t('stage.zoomIn')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <button className="tool" onClick={fit}>
            {t('projector.fit')}
          </button>
          <button className="tool" onClick={actual}>
            {t('projector.actual')}
          </button>
          <span className="viewer__sep" />
          <button ref={closeBtn} className="tool" onClick={close} aria-label={t('common.close')} title={t('common.close')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div
        ref={stage}
        className={`viewer__stage${drag.current ? ' is-dragging' : ''}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={fit}
      >
        {isLive ? (
          <canvas
            ref={canvas}
            key={item.id}
            width={1600}
            height={900}
            aria-label={item.title}
            style={{ transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.s})` }}
          />
        ) : (
        <img
          ref={img}
          key={item.id}
          src={item.src}
          alt={item.title}
          draggable={false}
          onLoad={fit}
          style={{ transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.s})` }}
        />
        )}
        <p className="viewer__hint">{t('projector.hint')}</p>
      </div>

      {items.length > 1 && (
        <nav className="viewer__strip" aria-label={t('projector.history')}>
          {items.map((it, i) => (
            <button key={it.id} className={i === idx ? 'is-on' : ''} onClick={() => open(it.id)} title={it.title}>
              {it.kind === 'live' ? <span className="viewer__live">LIVE</span> : <img src={it.src} alt="" />}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
