import type { LiveSeries, ProjectorItem } from '../types';

/**
 * Draws a live projector chart onto a 2D canvas. Used for the 3D screen (as a texture)
 * and for the full-screen viewer, so both always look the same.
 * Series with axis "right" get their own scale on the right.
 */
export function drawLiveChart(ctx: CanvasRenderingContext2D, w: number, h: number, item: ProjectorItem, data: LiveSeries | undefined) {
  const s = w / 1024; // scale everything from a 1024-wide design
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const pad = { l: 70 * s, r: 70 * s, t: 70 * s, b: 46 * s };
  ctx.fillStyle = '#1f2a33';
  ctx.font = `700 ${26 * s}px "Bricolage Grotesque", "Segoe UI", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(item.title, pad.l, 40 * s);

  // live badge
  const blink = Math.floor(Date.now() / 600) % 2 === 0;
  ctx.fillStyle = blink ? '#e0473a' : '#f3a39b';
  ctx.beginPath();
  ctx.arc(w - pad.r - 52 * s, 32 * s, 7 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e0473a';
  ctx.font = `700 ${18 * s}px "Instrument Sans", "Segoe UI", sans-serif`;
  ctx.fillText('LIVE', w - pad.r - 40 * s, 38 * s);

  const series = item.series ?? [];
  const n = data?.t.length ?? 0;
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  // grid
  ctx.strokeStyle = '#e6e9ec';
  ctx.lineWidth = 1 * s;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ph * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + pw, y);
    ctx.stroke();
  }

  if (!data || n < 2) {
    ctx.fillStyle = '#8a96a0';
    ctx.font = `500 ${20 * s}px "Instrument Sans", sans-serif`;
    ctx.fillText('…', pad.l, pad.t + ph / 2);
    ctx.restore();
    return;
  }

  const sides: ('left' | 'right')[] = ['left', 'right'];
  sides.forEach((side) => {
    const idx = series.map((se, i) => ((se.axis ?? 'left') === side ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    const vals = idx.flatMap((i) => data.values[i] ?? []);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const m = (hi - lo) * 0.08;
    lo -= m;
    hi += m;
    const y = (v: number) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;

    // axis labels
    ctx.fillStyle = '#6b7782';
    ctx.font = `500 ${15 * s}px "Instrument Sans", sans-serif`;
    ctx.textAlign = side === 'left' ? 'right' : 'left';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * (4 - i)) / 4;
      const label = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
      ctx.fillText(label, side === 'left' ? pad.l - 8 * s : pad.l + pw + 8 * s, pad.t + (ph * i) / 4 + 5 * s);
    }
    ctx.textAlign = 'left';

    idx.forEach((i) => {
      const v = data.values[i] ?? [];
      ctx.strokeStyle = series[i].color;
      ctx.lineWidth = 2.5 * s;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      v.forEach((val, k) => {
        const x = pad.l + (pw * k) / (n - 1);
        if (k === 0) ctx.moveTo(x, y(val));
        else ctx.lineTo(x, y(val));
      });
      ctx.stroke();
      // last value marker
      const last = v[v.length - 1];
      ctx.fillStyle = series[i].color;
      ctx.beginPath();
      ctx.arc(pad.l + pw, y(last), 5 * s, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // legend
  let lx = pad.l;
  ctx.font = `600 ${16 * s}px "Instrument Sans", sans-serif`;
  series.forEach((se, i) => {
    const v = data.values[i] ?? [];
    const last = v[v.length - 1];
    const text = `${se.name}: ${last === undefined ? '–' : Math.abs(last) >= 100 ? last.toFixed(1) : last.toFixed(4)}`;
    ctx.fillStyle = se.color;
    ctx.fillRect(lx, h - 26 * s, 14 * s, 4 * s);
    ctx.fillStyle = '#33404b';
    ctx.fillText(text, lx + 20 * s, h - 19 * s);
    lx += ctx.measureText(text).width + 50 * s;
  });
  ctx.restore();
}
