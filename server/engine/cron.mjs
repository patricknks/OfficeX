// Minimal 5-field cron (minute hour day-of-month month day-of-week), local time.
// Supports *, numbers, lists (1,15), ranges (1-5), steps (*/15, 8-18/2). Day-of-week 0 or 7 = Sunday.

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function field(spec, [lo, hi]) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`bad cron field "${spec}"`);
    let [a, b] = m[1] === '*' ? [lo, hi] : m[1].split('-').map(Number);
    if (b === undefined) b = m[2] ? hi : a;
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) throw new Error(`cron value out of range in "${spec}"`);
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set;
}

/** Parse once; throws with a readable message when the expression is wrong. */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron needs 5 fields: minute hour day month weekday');
  const [min, hour, dom, mon, dow] = parts.map((p, i) => field(p, RANGES[i]));
  if (dow.has(7)) dow.add(0);
  return { min, hour, dom, mon, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

export function cronMatches(c, d = new Date()) {
  if (!c.min.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false;
  const domOk = c.dom.has(d.getDate());
  const dowOk = c.dow.has(d.getDay());
  // classic cron: when both day fields are restricted, either one may match
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dowOk;
  if (c.dowAny) return domOk;
  return domOk || dowOk;
}

const pad = (n) => String(n).padStart(2, '0');
const DAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  id: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
};

/** Best-effort readable form for the common shapes; falls back to the expression. */
export function humanCron(expr, lang = 'en') {
  const L = (en, id) => (lang === 'id' ? id : en);
  const p = String(expr).trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [mi, h, dom, mon, dow] = p;
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mon === '*') {
    const hm = `${pad(h)}:${pad(mi)}`;
    if (dow === '*') return L(`Every day at ${hm}`, `Setiap hari jam ${hm}`);
    if (/^[0-7]$/.test(dow)) return L(`Every ${DAYS.en[dow % 7]} at ${hm}`, `Setiap ${DAYS.id[dow % 7]} jam ${hm}`);
    if (dow === '1-5') return L(`Weekdays at ${hm}`, `Hari kerja jam ${hm}`);
  }
  let m;
  if (mi === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return L('Every minute', 'Setiap menit');
  if (/^\d+$/.test(mi) && (m = h.match(/^\*\/(\d+)$/)) && dom === '*' && mon === '*' && dow === '*') return L(`Every ${m[1]} hours`, `Setiap ${m[1]} jam`);
  if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return L('Every hour', 'Setiap jam');
  if ((m = mi.match(/^\*\/(\d+)$/)) && h === '*' && dom === '*' && mon === '*' && dow === '*') return L(`Every ${m[1]} minutes`, `Setiap ${m[1]} menit`);
  return expr;
}
