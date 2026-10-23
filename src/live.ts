// Live mode: load the company from the OfficeX engine and follow its event stream.
// Without a server (the preview file, or companyRoot not set) the GUI falls back to the demo simulator.
import { useStore } from './store';
import { bridge } from './api';
import type { LiveState, ServerEvent } from './types';

let source: EventSource | null = null;

async function loadState(): Promise<LiveState | null> {
  try {
    const res = await fetch('api/state', { cache: 'no-store' });
    if (!res.ok) return null;
    const s = await res.json();
    return s.engine === 'live' ? (s as LiveState) : null;
  } catch {
    return null;
  }
}

/** Resolves true when the GUI runs against a live engine. */
export async function connectLive(): Promise<boolean> {
  if (location.protocol === 'file:') return false;
  const st = await loadState();
  if (!st) return false;
  bridge.on = true;
  useStore.getState().hydrate(st);
  follow();
  return true;
}

function follow() {
  source?.close();
  source = new EventSource('api/events');
  let dropped = false;
  source.onmessage = (ev) => {
    try {
      useStore.getState().applyEvent(JSON.parse(ev.data) as ServerEvent);
    } catch {
      /* ignore a bad event */
    }
  };
  source.onerror = () => {
    dropped = true;
  };
  // after the server restarts (or the laptop wakes up) reload everything, events may have been missed
  source.onopen = async () => {
    if (!dropped) return;
    dropped = false;
    const st = await loadState();
    if (st) useStore.getState().hydrate(st);
  };
}
