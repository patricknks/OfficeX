// Fake orchestrator. Emits the same ServerEvents the real backend will push,
// so the UI can be built and judged before the backend exists.
// Each team runs its own loop; nothing runs while Claude is disconnected or the team is paused.
import { agentKey, nextId, useStore } from '../store';
import { tr } from '../i18n';
import { OFFICE_ID, type AgentStatus, type Attachment, type Message, type Schedule, type ServerEvent, type ToolName, type ToolStep } from '../types';
import { MOCK_IMAGES } from './data';
import { planFolders } from '../projects/plan';

type Step = { wait: number; run: () => void; once?: boolean };
const S = (wait: number, run: () => void): Step => ({ wait, run });
/** A step that only runs on the first pass of a looping storyline (reports to the owner, projector shows). */
const ONCE = (wait: number, run: () => void): Step => ({ wait, run, once: true });
const emit = (e: ServerEvent) => useStore.getState().applyEvent(e);
const lang = () => useStore.getState().lang ?? 'en';
const L = (en: string, id: string) => (lang() === 'id' ? id : en);

function agentOf(teamId: string, id: string) {
  return useStore.getState().agents[agentKey(teamId, id)];
}
const canAct = (teamId: string, id: string) => {
  const a = agentOf(teamId, id);
  return !!a && a.status !== 'paused';
};

function status(teamId: string, agentId: string, s: AgentStatus, activity: string, tool?: ToolName) {
  if (!canAct(teamId, agentId)) return;
  emit({ type: 'agent.status', teamId, agentId, status: s, activity, tool });
  if (s === 'tool' || s === 'thinking')
    emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId, agentId, kind: s === 'tool' ? 'tool' : 'status', text: activity } });
  const a = agentOf(teamId, agentId)!;
  emit({
    type: 'agent.usage',
    teamId,
    agentId,
    tokensToday: a.tokensToday + Math.round((s === 'thinking' ? 2400 : 900) * (0.6 + Math.random())),
    turnsThisHour: a.turnsThisHour + (Math.random() < 0.3 ? 1 : 0),
  });
}

function say(teamId: string, roomSuffix: string, from: string, text: string, extra: { steps?: ToolStep[]; projectorId?: string } = {}) {
  const roomId = `${teamId}__${roomSuffix}`;
  const room = useStore.getState().rooms.find((r) => r.id === roomId);
  if (!room || !canAct(teamId, from)) return;
  emit({ type: 'agent.status', teamId, agentId: from, status: 'messaging', activity: '' });
  emit({ type: 'message', message: { id: nextId('msg'), ts: Date.now(), roomId, from, text, ...extra } });
  const label = room.kind === 'team' ? tr(lang(), 'chat.team') : room.kind === 'ceo' ? tr(lang(), 'chat.you').toLowerCase() : 'DM';
  emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId, agentId: from, kind: 'message', text: tr(lang(), 'activity.posted', { room: label }) } });
}

/** Post into any room by full id (consult rooms, front office). fromKey is "teamId/agentId". */
function post(roomId: string, fromKey: string, text: string, extra: Partial<Pick<Message, 'steps' | 'projectorId' | 'telegram'>> = {}) {
  const room = useStore.getState().rooms.find((r) => r.id === roomId);
  const [teamId, agentId] = fromKey.split('/');
  if (!room || !canAct(teamId, agentId)) return;
  const from = room.kind === 'consult' || room.kind === 'reports' ? fromKey : agentId;
  emit({ type: 'agent.status', teamId, agentId, status: 'messaging', activity: '' });
  emit({ type: 'message', message: { id: nextId('msg'), ts: Date.now(), roomId, from, text, ...extra } });
  const label = room.kind === 'consult' ? tr(lang(), 'chat.consult') : room.kind === 'reports' ? tr(lang(), 'chat.reports') : tr(lang(), 'chat.you').toLowerCase();
  emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId, agentId, kind: 'message', text: tr(lang(), 'activity.posted', { room: label }) } });
}

/** A live chart on the projector: the agent keeps a small script running that streams values. */
const liveFeeds: Record<string, { teamId: string; next: () => number[] }> = {};
function showLive(teamId: string, agentId: string, title: string, path: string, series: { name: string; color: string; axis?: 'left' | 'right' }[], next: () => number[]): string {
  const id = nextId('pj');
  if (!canAct(teamId, agentId)) return id;
  emit({ type: 'agent.status', teamId, agentId, status: 'tool', activity: `ShowOnProjector (live): ${title}` });
  emit({ type: 'projector.show', item: { id, ts: Date.now(), teamId, agentId, title, path, src: '', kind: 'live', series } });
  // backfill a minute of history so the chart is not empty
  const now = Date.now();
  for (let i = 60; i > 0; i--) emit({ type: 'projector.data', id, t: now - i * 1000, values: next() });
  liveFeeds[id] = { teamId, next };
  emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId, agentId, kind: 'tool', text: `ShowOnProjector (live): ${title}` } });
  return id;
}

/** show_on_projector: the agent puts an image on the projector next to the building. */
function show(teamId: string, agentId: string, title: string, path: string, src: string): string {
  const id = nextId('pj');
  if (!canAct(teamId, agentId)) return id;
  emit({ type: 'agent.status', teamId, agentId, status: 'tool', activity: `ShowOnProjector: ${path.split('/').pop()}`, tool: undefined });
  emit({ type: 'projector.show', item: { id, ts: Date.now(), teamId, agentId, title, path, src, kind: 'image' } });
  emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId, agentId, kind: 'tool', text: `ShowOnProjector: ${title}` } });
  return id;
}

function meeting(teamId: string, active: boolean) {
  emit({ type: 'team.meeting', teamId, active });
  emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId, agentId: 'manager', kind: 'meeting', text: tr(lang(), active ? 'activity.meetingStart' : 'activity.meetingEnd') } });
}

// ---------- storylines ----------
const Q = 'team_quant';
const quantStory = (): Step[] => [
  S(1300, () => status(Q, 'manager', 'thinking', L('Planning next steps from the owner’s brief', 'Menyusun langkah dari brief owner'))),
  S(1500, () => status(Q, 'researcher-1', 'tool', 'WebFetch: Binance docs /fapi/v1/fundingRate', 'WebFetch')),
  S(1400, () => status(Q, 'researcher-2', 'tool', 'WebSearch: funding rate predictive power crypto', 'WebSearch')),
  S(1500, () => status(Q, 'analyst-1', 'waiting', L('Waiting for cleaned data from Sena', 'Menunggu data bersih dari Sena'))),
  S(1700, () => status(Q, 'researcher-1', 'tool', 'Bash: node fetch_funding.js --symbol ETHUSDT', 'Bash')),
  S(1500, () => status(Q, 'manager', 'tool', 'Read: goals/2026-Q4.md', 'Read')),
  S(1600, () => status(Q, 'researcher-1', 'tool', 'Chrome: binance.com/en/futures/funding-history', 'Browser')),
  S(1900, () => say(Q, 'general', 'researcher-2', L('The third paper finds the effect is strongest when open interest is rising too. Should we add it as a filter?', 'Paper ketiga menemukan efeknya paling kuat saat open interest juga naik. Perlu kita tambahkan sebagai filter?'))),
  S(1500, () => status(Q, 'researcher-2', 'waiting', L('Waiting for replies in the team room', 'Menunggu balasan di ruang tim'))),
  S(1700, () => say(Q, 'general', 'analyst-1', L('Yes. I will add 24h OI change as a second variable in the backtest.', 'Bisa. Saya tambahkan perubahan OI 24 jam sebagai variabel kedua di backtest.'))),
  S(1500, () => status(Q, 'analyst-1', 'tool', 'Write: workspace/backtest/config.yaml', 'Write')),
  S(1800, () => status(Q, 'researcher-1', 'tool', 'Write: workspace/raw/funding_ethusdt_8h.csv', 'Write')),
  S(1700, () => say(Q, 'dm__manager__researcher-1', 'researcher-1', L('Two years of funding data are complete, 2,190 rows with no gaps. Shall I compute the 30-day z-score?', 'Data funding 2 tahun sudah lengkap, 2.190 baris tanpa gap. Lanjut hitung z-score 30 hari?'))),
  S(1500, () => status(Q, 'manager', 'thinking', L('Reviewing Sena’s data summary', 'Meninjau ringkasan data Sena'))),
  S(1700, () => say(Q, 'dm__manager__researcher-1', 'manager', L('Yes, go ahead. Also save a 1H resample so Bima can use it directly.', 'Ya, lanjut. Simpan juga versi resample 1H supaya Bima bisa langsung pakai.'))),
  S(1500, () => status(Q, 'researcher-1', 'tool', 'Bash: python3 zscore.py --window 90', 'Bash')),
  // team meeting: everyone walks to the meeting room
  S(1200, () => say(Q, 'general', 'manager', L('Quick sync in the meeting room, everyone. Five minutes.', 'Semua, sync singkat di ruang rapat. Lima menit.'))),
  S(4200, () => meeting(Q, true)),
  S(2200, () => say(Q, 'general', 'researcher-1', L('Data is clean. The 1H file is in workspace/clean/.', 'Data sudah bersih. File 1H ada di workspace/clean/.'))),
  S(2200, () => say(Q, 'general', 'researcher-2', L('The literature supports a threshold around |z| > 2.', 'Literatur mendukung threshold di sekitar |z| > 2.'))),
  S(2200, () => say(Q, 'general', 'analyst-1', L('Then I will start with |z| > 2 and test 1.5 and 2.5 as well.', 'Kalau begitu saya mulai dengan |z| > 2, dan uji juga 1.5 serta 2.5.'))),
  S(2000, () => say(Q, 'general', 'manager', L('Agreed. Back to your desks.', 'Sepakat. Kembali ke meja masing-masing.'))),
  S(3600, () => meeting(Q, false)),
  S(1600, () => status(Q, 'analyst-1', 'tool', 'Bash: npm run backtest -- --signal funding_z', 'Bash')),
  S(1800, () => status(Q, 'researcher-2', 'tool', 'Edit: knowledge/funding-rate-literature.md', 'Edit')),
  ONCE(1800, () => status(Q, 'analyst-1', 'tool', 'Bash: python "04 System/plot_equity.py" --folds 5', 'Bash')),
  ONCE(2400, () => {
    const pj = show(Q, 'manager', L('Walk-forward equity curve', 'Kurva ekuitas walk-forward'), 'projects/ETH Funding Signal/03 Outputs/equity_curve.png', MOCK_IMAGES.equity);
    say(
      Q,
      'ceo__manager',
      'manager',
      L(
        `**Update 2: walk-forward backtest done. Chart is on the projector.**

| Metric | Funding signal | Buy & hold |
|---|---|---|
| Sharpe | **1.42** | 0.31 |
| Max drawdown | **-18.6%** | -61.2% |
| Win rate | 57% | – |
| Trades | 412 | – |

**What this means**
- The edge holds in all 5 out-of-sample folds, not just one lucky period.
- Most of the return comes after *positive* extreme funding (shorts after crowded longs).
- Adding the open-interest filter from Dira's paper cuts trades by 40% and keeps Sharpe at 1.38.

**Recommendation:** move to paper trading on 1H with |z| > 2, hold 48 hours, 0.5% risk per trade.

**Risks I am not sure about yet**
1. Fees and slippage are modelled at 0.06% per side; in fast markets it can be worse.
2. Two years includes only one real bear phase.

Do you want me to start paper trading, or run a stress test on fees first?`,
        `**Update 2: backtest walk-forward selesai. Chart ada di proyektor.**

| Metrik | Sinyal funding | Buy & hold |
|---|---|---|
| Sharpe | **1,42** | 0,31 |
| Max drawdown | **-18,6%** | -61,2% |
| Win rate | 57% | – |
| Jumlah trade | 412 | – |

**Artinya**
- Edge-nya bertahan di kelima lipatan out-of-sample, bukan hanya satu periode yang kebetulan bagus.
- Sebagian besar return datang setelah funding *positif* ekstrem (short setelah posisi long terlalu ramai).
- Menambahkan filter open interest dari paper Dira mengurangi jumlah trade 40% dan Sharpe tetap 1,38.

**Rekomendasi:** lanjut ke paper trading di 1H dengan |z| > 2, hold 48 jam, risiko 0,5% per trade.

**Risiko yang belum saya yakini**
1. Fee dan slippage dimodelkan 0,06% per sisi; saat pasar cepat bisa lebih buruk.
2. Dua tahun data hanya mencakup satu fase bear yang sesungguhnya.

Mau saya mulai paper trading, atau stress test fee dulu?`,
      ),
      {
        steps: [
          { tool: 'Read', detail: 'projects/ETH Funding Signal/03 Outputs/backtest_summary.json' },
          { tool: 'Read', detail: 'knowledge/funding-rate-literature.md' },
          { tool: 'Bash', detail: 'python "04 System/compare_filters.py" --filter oi_change_24h' },
          { tool: 'ShowOnProjector', detail: 'projects/ETH Funding Signal/03 Outputs/equity_curve.png' },
          { tool: 'Edit', detail: 'projects/ETH Funding Signal/08 Journal/DECISIONS.md' },
        ],
        projectorId: pj,
      },
    );
  }),
  ONCE(2600, () => {
    let z = 0.4;
    let px = 2480;
    const pj = showLive(
      Q,
      'manager',
      L('ETH funding z-score, live', 'Z-score funding ETH, live'),
      'projects/ETH Funding Signal/03 Outputs/live/funding_z.jsonl',
      [
        { name: 'Funding z', color: '#E0A21B' },
        { name: 'ETH', color: '#2F8FD8', axis: 'right' },
      ],
      () => {
        z = Math.max(-3.5, Math.min(3.5, z * 0.97 + (Math.random() - 0.5) * 0.35));
        px = px * (1 + (Math.random() - 0.5) * 0.002 - z * 0.0002);
        return [z, px];
      },
    );
    say(
      Q,
      'ceo__manager',
      'manager',
      L(
        `I put a **live chart** on the projector: the funding z-score with ETH price, updated every second from the paper-trading feed. A trade fires when the yellow line crosses ±2. Click the projector to open it full screen.`,
        `Saya tampilkan **chart live** di proyektor: z-score funding bersama harga ETH, diperbarui tiap detik dari feed paper trading. Trade terpicu saat garis kuning menembus ±2. Klik proyektor untuk membukanya layar penuh.`,
      ),
      {
        steps: [
          { tool: 'Bash', detail: 'python "04 System/live_feed.py" --symbol ETHUSDT --out "03 Outputs/live/funding_z.jsonl"' },
          { tool: 'ShowOnProjector', detail: 'live: 03 Outputs/live/funding_z.jsonl (1s)' },
        ],
        projectorId: pj,
      },
    );
  }),
  S(1500, () => status(Q, 'manager', 'waiting', L('Waiting for backtest results', 'Menunggu hasil backtest'))),
  S(2400, () => ['researcher-1', 'researcher-2'].forEach((id) => status(Q, id, 'idle', ''))),
  S(3000, () => status(Q, 'analyst-1', 'idle', '')),
];

const R = 'team_resto';
const restoStory = (): Step[] => [
  S(2600, () => status(R, 'researcher-1', 'tool', L('WebSearch: chicken breast price per kg Jakarta', 'WebSearch: harga dada ayam per kg Jakarta'), 'WebSearch')),
  S(2600, () => status(R, 'analyst-1', 'tool', 'Read: projects/menu/costing.xlsx', 'Read')),
  S(2800, () => status(R, 'researcher-1', 'tool', 'Write: workspace/supplier_prices.md', 'Write')),
  S(2600, () => say(R, 'dm__manager__researcher-1', 'researcher-1', L('Supplier B is 6% cheaper for chicken this week, rice prices are flat.', 'Supplier B 6% lebih murah untuk ayam minggu ini, harga beras stabil.'))),
  S(2600, () => status(R, 'manager', 'thinking', L('Comparing suppliers', 'Membandingkan supplier'))),
  S(2800, () => status(R, 'analyst-1', 'tool', 'Edit: projects/menu/food_cost.md', 'Edit')),
  ONCE(2600, () => {
    const pj = show(R, 'analyst-1', L('Food cost per menu, week 42', 'Food cost per menu, minggu 42'), 'projects/Menu Costing/02 Outputs/food_cost_w42.png', MOCK_IMAGES.foodCost);
    say(R, 'dm__manager__analyst-1', 'analyst-1', L('Food cost chart is on the projector. Rawon (41%) and ayam bakar (38%) are above the 35% target.', 'Chart food cost ada di proyektor. Rawon (41%) dan ayam bakar (38%) di atas target 35%.'), { steps: [{ tool: 'Bash', detail: 'python plot_food_cost.py --week 42' }, { tool: 'ShowOnProjector', detail: 'food_cost_w42.png' }], projectorId: pj });
  }),
  S(3000, () => ['manager', 'researcher-1', 'analyst-1'].forEach((id) => status(R, id, 'idle', ''))),
  S(5000, () => undefined),
];

const N = 'team_news';
const newsStory = (): Step[] => [
  S(2200, () => status(N, 'researcher-1', 'tool', 'WebSearch: ETH ETF flows today', 'WebSearch')),
  S(2400, () => status(N, 'researcher-1', 'tool', L('Chrome: scraping announcements on idx.co.id', 'Chrome: scraping pengumuman di idx.co.id'), 'Browser')),
  S(2400, () => say(N, 'general', 'researcher-1', L('Three candidates for tomorrow’s brief: ETF inflows, a BI rate decision preview, and a large IDX block trade.', 'Tiga kandidat untuk brief besok: arus masuk ETF, preview keputusan suku bunga BI, dan block trade besar di IDX.'))),
  S(2600, () => status(N, 'manager', 'thinking', L('Choosing the top five stories', 'Memilih lima berita teratas'))),
  S(2600, () => status(N, 'manager', 'tool', 'Write: projects/briefs/2026-10-20.md', 'Write')),
  S(3000, () => ['manager', 'researcher-1'].forEach((id) => status(N, id, 'idle', ''))),
  S(6000, () => undefined),
];

const STORIES: Record<string, () => Step[]> = { [Q]: quantStory, [R]: restoStory, [N]: newsStory };

const ambientList = (): [AgentStatus, string, ToolName?][] => [
  ['thinking', L('Reading the latest messages', 'Membaca pesan terbaru')],
  ['tool', 'Read: CLAUDE.md', 'Read'],
  ['tool', 'WebSearch: ' + L('background research', 'riset latar belakang'), 'WebSearch'],
  ['tool', 'Write: workspace/notes.md', 'Write'],
  ['idle', ''],
];

// ---------- runner ----------
interface Runner {
  timer?: number;
  idx: number;
  pending: Step[];
}
const runners: Record<string, Runner> = {};
let ambientTimer: number | undefined;
let running = false;

function active(teamId: string) {
  const st = useStore.getState();
  if (teamId === OFFICE_ID) return st.claude.state === 'connected';
  const t = st.teams.find((x) => x.id === teamId);
  return st.claude.state === 'connected' && !!t && !t.paused;
}

function tickTeam(teamId: string) {
  const r = runners[teamId];
  if (!r || !running) return;
  let wait = 1200;
  if (active(teamId)) {
    const story = STORIES[teamId]?.();
    let step: Step | null = r.pending.length ? r.pending.shift()! : null;
    if (!step && story) {
      // skip one-time steps once the storyline has looped
      for (let guard = 0; guard < story.length; guard++) {
        const loop = Math.floor(r.idx / story.length);
        const cand = story[r.idx++ % story.length];
        if (!cand.once || loop === 0) {
          step = cand;
          break;
        }
      }
    }
    if (step) {
      step.run();
      wait = step.wait;
    }
  }
  r.timer = window.setTimeout(() => tickTeam(teamId), wait);
}

function ensureRunners() {
  [...useStore.getState().teams.map((t) => t.id), OFFICE_ID].forEach((id) => {
    if (!runners[id]) {
      runners[id] = { idx: 0, pending: [] };
      runners[id].timer = window.setTimeout(() => tickTeam(id), 500 + Math.random() * 1500);
    }
  });
}

function ambient() {
  const st = useStore.getState();
  const pool = Object.values(st.agents).filter((a) => !STORIES[a.teamId] && a.teamId !== OFFICE_ID && a.role !== 'advisor' && active(a.teamId) && a.status !== 'paused');
  if (pool.length) {
    const a = pool[Math.floor(Math.random() * pool.length)];
    const [s, text, tool] = ambientList()[Math.floor(Math.random() * 5)];
    status(a.teamId, a.id, s, text, tool);
  }
  ambientTimer = window.setTimeout(ambient, 2400 + Math.random() * 1600);
}

// ---------- owner requests ----------
const DAYS: [RegExp, number, string, string][] = [
  [/\b(senin|monday|mon)\b/, 1, 'Monday', 'Senin'],
  [/\b(selasa|tuesday|tue)\b/, 2, 'Tuesday', 'Selasa'],
  [/\b(rabu|wednesday|wed)\b/, 3, 'Wednesday', 'Rabu'],
  [/\b(kamis|thursday|thu)\b/, 4, 'Thursday', 'Kamis'],
  [/\b(jumat|jum'at|friday|fri)\b/, 5, 'Friday', 'Jumat'],
  [/\b(sabtu|saturday|sat)\b/, 6, 'Saturday', 'Sabtu'],
  [/\b(hari minggu|sunday|sun)\b/, 0, 'Sunday', 'Minggu'],
];
const SCHEDULE_WORDS = /\b(setiap|tiap|every|daily|harian|hourly|mingguan|weekly)\b/i;
const SCRIPT_WORDS = /\b(cek|check|pantau|monitor|tarik|pull|fetch|download|unduh|ambil|scrape|scraping|backup|harga|price|sync|simpan)\b/i;
const THINK_WORDS = /\b(analisa|analisis|analy[sz]e|tulis|write|ringkas|rangkum|summar\w*|laporan|report|research|riset|review|evaluasi|evaluate|brief)\b/i;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Turn "setiap hari jam 7" / "every 4 hours" / "tiap Senin jam 08:30" into cron + a readable line. */
export function parseSchedule(text: string): { cron: string; human: string } {
  const low = text.toLowerCase();
  const time = low.match(/(?:\b(?:jam|pukul|at)|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|pagi|siang|sore|malam)?/);
  const weekly = /\b(setiap minggu|tiap minggu|mingguan|weekly|every week)\b/.test(low);
  const day = DAYS.find(([re]) => re.test(low)) ?? (weekly ? DAYS[0] : undefined);
  if (time) {
    let h = Number(time[1]) % 24;
    const m = Math.min(59, Number(time[2] ?? 0));
    const ampm = time[3];
    if ((ampm === 'pm' || ampm === 'sore' || ampm === 'malam') && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    const hm = `${pad2(h)}:${pad2(m)}`;
    if (day) return { cron: `${m} ${h} * * ${day[1]}`, human: L(`Every ${day[2]} at ${hm}`, `Setiap ${day[3]} jam ${hm}`) };
    return { cron: `${m} ${h} * * *`, human: L(`Every day at ${hm}`, `Setiap hari jam ${hm}`) };
  }
  const everyN = low.match(/(?:setiap|tiap|every)\s*(\d+)\s*(?:jam|hours?|hrs?|h)\b/);
  if (everyN) {
    const n = Math.max(1, Math.min(23, Number(everyN[1])));
    return { cron: `0 */${n} * * *`, human: L(`Every ${n} hours`, `Setiap ${n} jam`) };
  }
  const everyMin = low.match(/(?:setiap|tiap|every)\s*(\d+)\s*(?:menit|minutes?|mins?|m)\b/);
  if (everyMin) {
    const n = Math.max(5, Math.min(59, Number(everyMin[1])));
    return { cron: `*/${n} * * * *`, human: L(`Every ${n} minutes`, `Setiap ${n} menit`) };
  }
  if (/(setiap jam|tiap jam|every hour|hourly)/.test(low)) return { cron: '0 * * * *', human: L('Every hour', 'Setiap jam') };
  if (day) return { cron: `0 8 * * ${day[1]}`, human: L(`Every ${day[2]} at 08:00`, `Setiap ${day[3]} jam 08:00`) };
  return { cron: '0 7 * * *', human: L('Every day at 07:00', 'Setiap hari jam 07:00') };
}

/** The task itself, without "...then send it to the secretary" or "when done, report to...". */
function cleanBrief(text: string) {
  return text
    .replace(/,?\s*(?:(?:lalu|kemudian|dan|then|and)\s+)?(?:(?:kalau|jika|if|when)\s+[^,.]*?,?\s*)?(?:kirim|kirimkan|send|beri|berikan|kasih|forward|laporkan|report)\b[^.]*?\b(?:sekretaris|secretary|sekar)\b[^.]*/gi, '')
    .replace(/,?\s*(?:kalau|jika|if|when)\s+(?:sudah|selesai|done)[^.]*$/i, '')
    .replace(/\s+,/g, ',')
    .replace(/[\s,.;:-]+$/g, '')
    .trim();
}

/** What the schedule actually does, without the timing words. */
function scheduleTitle(text: string) {
  const t = cleanBrief(text)
    .replace(/\b(?:jam|pukul|at)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|pagi|siang|sore|malam)?/gi, '')
    .replace(/\b(?:setiap|tiap|every)\s+(?:\d+\s*(?:jam|hours?|menit|minutes?)|hari|day|minggu|week|jam|hour)\b/gi, '')
    .replace(/\b(?:setiap|tiap|every)\b/gi, '')
    .replace(/\b(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(?:tolong|please|lakukan|do)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  const s = t || text;
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 70);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** The manager reads the owner's message and decides what to do: plan, schedule, file uploads, ask another team, report to the secretary. */
let lastSeen = 0;
function onCeoMessages() {
  const st = useStore.getState();
  const fresh = st.messages.filter((m) => m.ts > lastSeen && m.from === 'ceo');
  if (!fresh.length) return;
  lastSeen = Math.max(...fresh.map((m) => m.ts));
  fresh.forEach((msg) => {
    const room = st.rooms.find((r) => r.id === msg.roomId);
    if (!room) return;
    if (room.teamId === OFFICE_ID) return onSecretaryMessage(msg);
    const teamId = room.teamId;
    const team = Object.values(st.agents).filter((a) => a.teamId === teamId);
    const mgr = team.find((a) => a.role === 'manager');
    const r = runners[teamId];
    if (!mgr || !r) return;
    const worker = team.find((a) => a.id !== mgr.id && a.role !== 'advisor' && a.status !== 'paused');
    const text = msg.text;
    const core = cleanBrief(text) || text;
    const brief = core.length > 90 ? core.slice(0, 90) + '…' : core;
    const wantsSchedule = SCHEDULE_WORDS.test(text);
    const wantsSecretary = /\b(sekretaris|secretary|sekar)\b/i.test(text);
    const other = st.teams.find((x) => {
      if (x.id === teamId) return false;
      const om = Object.values(st.agents).find((a) => a.teamId === x.id && a.role === 'manager');
      const low = text.toLowerCase();
      return low.includes(x.name.toLowerCase()) || (!!om && new RegExp(`\\b${om.name.toLowerCase()}\\b`).test(low));
    });

    r.pending.push(S(1400, () => status(teamId, mgr.id, 'thinking', L('Reading your message', 'Membaca pesanmu'))));
    if (msg.attachments?.length) fileAttachments(teamId, mgr.id, msg.attachments);
    // "here are the files, please store them" needs no plan on top of the filing reply
    const onlyFiling = !!msg.attachments?.length && (!text.trim() || (/\b(simpan|save|store|taruh|referensi|reference|arsip)\b/i.test(text) && !wantsSchedule && !wantsSecretary && !other));
    if (onlyFiling) return;
    if (wantsSchedule) addSchedule(teamId, mgr.id, worker?.id, text, wantsSecretary);
    else {
      planReply(teamId, mgr.id, worker?.id, brief, !!other, wantsSecretary);
      if (other) consult(teamId, mgr.id, other.id, brief);
      if (wantsSecretary) reportToSecretary(teamId, mgr.id, worker?.id, brief);
    }
  });
}

function planReply(teamId: string, mgrId: string, workerId: string | undefined, brief: string, asksOther: boolean, toSecretary: boolean) {
  const worker = workerId ? agentOf(teamId, workerId) : undefined;
  const r = runners[teamId];
  r.pending.push(
    S(2200, () =>
      say(
        teamId,
        `ceo__${mgrId}`,
        mgrId,
        L(
          `Got it. I checked the team goals and what is already in \`knowledge/\` so we do not redo work.

**Plan**
1. ${worker ? `${worker.name} starts with initial research and writes findings to \`knowledge/\`.` : 'I start with initial research.'}${asksOther ? '\n2. I ask the other team’s manager for input in the *Other teams* room.' : ''}
${asksOther ? 3 : 2}. I review the findings and log any direction change in \`DECISIONS.md\`.
${asksOther ? 4 : 3}. ${toSecretary ? 'The report goes to the secretary, who forwards it to your Telegram.' : 'You get a summary with a clear recommendation; charts go on the projector.'}

**Assumption:** same priority as the current work. Tell me if that is wrong.`,
          `Diterima. Saya cek dulu goals tim dan isi \`knowledge/\` supaya tidak mengulang pekerjaan.

**Rencana**
1. ${worker ? `${worker.name} mulai riset awal dan menulis temuan ke \`knowledge/\`.` : 'Saya mulai riset awal.'}${asksOther ? '\n2. Saya minta masukan manajer tim lain di ruang *Antar tim*.' : ''}
${asksOther ? 3 : 2}. Saya review temuannya dan mencatat perubahan arah di \`DECISIONS.md\`.
${asksOther ? 4 : 3}. ${toSecretary ? 'Laporannya saya kirim ke sekretaris, lalu diteruskan ke Telegram-mu.' : 'Kamu dapat ringkasan dengan rekomendasi yang jelas; chart ditampilkan di proyektor.'}

**Asumsi:** prioritasnya sama dengan pekerjaan yang sedang berjalan. Koreksi kalau salah.`,
        ),
        { steps: [{ tool: 'Read', detail: 'CLAUDE.md' }, { tool: 'Read', detail: 'goals/2026-Q4.md' }, { tool: 'Grep', detail: 'knowledge/ for related notes' }, { tool: 'Write', detail: 'workspace/briefs/owner-brief.md' }] },
      ),
    ),
  );
  if (worker)
    r.pending.push(
      S(1800, () => say(teamId, `dm__${mgrId}__${worker.id}`, mgrId, L(`${worker.name}, new brief from the owner: "${brief}" Please start with initial research.`, `${worker.name}, brief baru dari owner: "${brief}" Tolong mulai riset awal.`))),
      S(1500, () => status(teamId, worker.id, 'thinking', L('Reading the new brief', 'Membaca brief baru'))),
      S(1500, () => say(teamId, `dm__${mgrId}__${worker.id}`, worker.id, L('On it.', 'Siap, mulai sekarang.'))),
    );
}

/** Uploaded files land in inbox/<date>/; the manager moves them into the right project folder. */
function fileAttachments(teamId: string, mgrId: string, files: Attachment[]) {
  const st = useStore.getState();
  const project = st.projects.find((p) => p.teamId === teamId);
  const base = project ? `projects/${project.name}/${planFolders(project.process).attach}` : `employees/${teamId}/workspace/references`;
  const dest = (f: Attachment) => (project ? `${base}/${f.mime.startsWith('image/') ? 'Project References' : 'Knowledge References'}/` : `${base}/`);
  const src = (f: Attachment) => f.savedPath ?? `inbox/${today()}/${f.name}`;
  const lines = files.map((f) => `- \`${f.name}\` → \`${dest(f)}\``).join('\n');
  runners[teamId].pending.push(
    S(1500, () => status(teamId, mgrId, 'tool', `Bash: mv inbox/${today()}/* → ${project ? project.name : 'workspace/references'}`, 'Bash')),
    S(1800, () =>
      say(
        teamId,
        `ceo__${mgrId}`,
        mgrId,
        L(
          `Received ${files.length} file${files.length > 1 ? 's' : ''}. I filed ${files.length > 1 ? 'them' : 'it'}${project ? ` in **${project.name}**` : ''}:\n${lines}\n\n${project ? 'I ran `/index-reference` so every agent on the project can find the content.' : 'There is no project yet, so they are in the team workspace for now.'}`,
          `${files.length} file diterima. Sudah saya simpan${project ? ` di **${project.name}**` : ''}:\n${lines}\n\n${project ? 'Saya jalankan `/index-reference` supaya semua agent di proyek ini bisa menemukan isinya.' : 'Belum ada proyek, jadi untuk sementara saya taruh di workspace tim.'}`,
        ),
        {
          steps: [
            ...files.map((f) => ({ tool: 'Bash', detail: `mv "${src(f)}" "${dest(f)}"` })),
            ...(project ? [{ tool: 'Skill', detail: `/index-reference ${dest(files[0])}` }] : []),
          ],
        },
      ),
    ),
  );
}

/** "Do X every day at 07:00": the manager writes a schedule for the team with the schedule skill. */
function addSchedule(teamId: string, mgrId: string, workerId: string | undefined, text: string, toSecretary: boolean) {
  const { cron, human } = parseSchedule(text);
  const title = scheduleTitle(text);
  const mode: Schedule['mode'] = SCRIPT_WORDS.test(text) && !THINK_WORDS.test(text) ? 'script' : 'agent';
  const runner = mode === 'script' ? workerId ?? mgrId : mgrId;
  const who = agentOf(teamId, runner);
  const job = slug(title);
  const id = nextId('sch');
  const command =
    mode === 'script'
      ? `python jobs/${job}.py${toSecretary ? ' --notify secretary' : ''}`
      : `${title}${toSecretary ? L('. Send the result to the secretary.', '. Kirim hasilnya ke sekretaris.') : ''}`;
  const sched: Schedule = { id, teamId, agentId: runner, title, cron, human, mode, command, enabled: true, createdBy: 'owner', runs: 0 };
  runners[teamId].pending.push(
    S(1500, () => status(teamId, mgrId, 'tool', 'Skill: /schedule add', 'Read')),
    ...(mode === 'script' ? [S(1600, () => status(teamId, runner, 'tool', `Write: jobs/${job}.py`, 'Write'))] : []),
    S(1500, () => emit({ type: 'schedule.upsert', schedule: sched })),
    S(800, () =>
      say(
        teamId,
        `ceo__${mgrId}`,
        mgrId,
        L(
          `Scheduled. **${title}**\n\n| | |\n|---|---|\n| When | ${human} (\`${cron}\`) |\n| Who | ${who?.name ?? runner} |\n| Mode | ${mode === 'script' ? '**Script, no tokens.** A small Python job does the work; the agent only wakes up if the script finds something unusual.' : '**Agent.** It needs judgement, so the agent runs a short turn each time.'} |${toSecretary ? '\n| Result | Sent to the secretary, then to your Telegram |' : ''}\n\nYou can pause it under *Schedules* in the left panel. I ran it once now as a test.`,
          `Sudah dijadwalkan. **${title}**\n\n| | |\n|---|---|\n| Kapan | ${human} (\`${cron}\`) |\n| Siapa | ${who?.name ?? runner} |\n| Mode | ${mode === 'script' ? '**Script, tanpa token.** Job Python kecil yang mengerjakan; agent baru dibangunkan kalau script menemukan hal yang tidak biasa.' : '**Agent.** Butuh penilaian, jadi agent menjalankan satu giliran singkat setiap kali.'} |${toSecretary ? '\n| Hasil | Dikirim ke sekretaris, lalu ke Telegram-mu |' : ''}\n\nBisa dijeda di bagian *Jadwal* di panel kiri. Sudah saya jalankan sekali sebagai uji.`,
        ),
        {
          steps: [
            { tool: 'Skill', detail: `/schedule add --cron "${cron}" --agent ${runner} --mode ${mode}` },
            ...(mode === 'script' ? [{ tool: 'Write', detail: `employees/${teamId}/${runner}/jobs/${job}.py` }] : []),
            { tool: 'Write', detail: `employees/${teamId}/schedules.json` },
            { tool: 'Bash', detail: mode === 'script' ? `python jobs/${job}.py --dry-run` : `claude -p --resume <${runner}> "${title.slice(0, 40)}…" --max-turns 3` },
          ],
        },
      ),
    ),
    S(2500, () => emit({ type: 'schedule.run', id, ts: Date.now(), result: L('Test run OK', 'Uji coba OK') })),
  );
}

/** Manager-to-manager: ask another team for input in the shared "other teams" room. */
function consult(teamId: string, mgrId: string, otherTeam: string, brief: string) {
  const st = useStore.getState();
  const roomId = st.ensureConsult(teamId, otherTeam);
  const om = Object.values(st.agents).find((a) => a.teamId === otherTeam && a.role === 'manager');
  const otherName = st.teams.find((t) => t.id === otherTeam)?.name ?? otherTeam;
  if (!om) return;
  const me = agentOf(teamId, mgrId);
  const wrapUp = S(1800, () =>
    say(
      teamId,
      `ceo__${mgrId}`,
      mgrId,
      L(
        `I asked **${om.name}** (${otherName}). Their input: use the official source, aggregators lag by a day. I added that to our brief. The conversation is in the *Other teams* tab.`,
        `Saya sudah tanya **${om.name}** (${otherName}). Masukan mereka: pakai sumber resmi, agregator telat sehari. Sudah saya masukkan ke brief kita. Percakapannya ada di tab *Antar tim*.`,
      ),
    ),
  );
  const answer = [
    S(1500, () => status(otherTeam, om.id, 'tool', L('Grep: knowledge/ for the question from another team', 'Grep: knowledge/ untuk pertanyaan tim lain'), 'Grep')),
    S(2200, () => {
      post(
        roomId,
        `${otherTeam}/${om.id}`,
        L(
          `@${me?.name ?? 'manager'} we have two notes on this in \`knowledge/\`. Short version: the data source we trust most is the official one; the aggregator sites lag by a day. Happy to review your draft before it goes to the owner.`,
          `@${me?.name ?? 'manager'} kami punya dua catatan soal ini di \`knowledge/\`. Singkatnya: sumber data yang paling kami percaya adalah sumber resmi; situs agregator telat sehari. Boleh kirim draf kalian untuk kami review sebelum ke owner.`,
        ),
        { steps: [{ tool: 'Grep', detail: 'knowledge/ "source" "lag"' }, { tool: 'Read', detail: 'knowledge/data-sources.md' }] },
      );
      runners[teamId]?.pending.unshift(wrapUp);
    }),
  ];
  runners[teamId].pending.push(
    S(1600, () => {
      post(roomId, `${teamId}/${mgrId}`, L(`@${om.name} the owner asked us: "${brief}" What does your team already know about this? Anything we should avoid?`, `@${om.name} owner minta ke kami: "${brief}" Apa yang tim kamu sudah tahu soal ini? Ada yang perlu kami hindari?`));
      if (active(otherTeam)) runners[otherTeam]?.pending.unshift(...answer);
      else
        runners[teamId]?.pending.unshift(
          S(1400, () => say(teamId, `ceo__${mgrId}`, mgrId, L(`${otherName} is paused, so I left the question in the *Other teams* room. ${om.name} will answer when you resume the team.`, `${otherName} sedang dijeda, jadi pertanyaannya saya tinggalkan di ruang *Antar tim*. ${om.name} akan menjawab begitu timnya dilanjutkan.`))),
        );
    }),
  );
}

/** "...send the report to the secretary": the manager posts in the reports room, the secretary sends it to Telegram. */
function reportToSecretary(teamId: string, mgrId: string, workerId: string | undefined, brief: string) {
  const st = useStore.getState();
  const sec = Object.values(st.agents).find((a) => a.teamId === OFFICE_ID && a.role === 'secretary');
  const r = runners[teamId];
  const teamName = st.teams.find((t) => t.id === teamId)?.name ?? teamId;
  if (workerId)
    r.pending.push(
      S(2000, () => status(teamId, workerId, 'tool', 'WebSearch: ' + brief.slice(0, 50), 'WebSearch')),
      S(2200, () => status(teamId, workerId, 'tool', 'Write: knowledge/findings.md', 'Write')),
    );
  const file = `employees/${teamId}/reports/${today()}-${slug(brief)}.md`;
  r.pending.push(S(1800, () => status(teamId, mgrId, 'tool', `Write: ${file}`, 'Write')));
  if (!sec) {
    r.pending.push(
      S(1400, () => say(teamId, `ceo__${mgrId}`, mgrId, L(`The report is ready at \`${file}\`. There is no secretary yet, so I could not send it to Telegram. Add one under *Front office* in the left panel.`, `Laporannya siap di \`${file}\`. Belum ada sekretaris, jadi belum bisa dikirim ke Telegram. Tambahkan di *Kantor depan* di panel kiri.`))),
    );
    return;
  }
  const reports = `${OFFICE_ID}__reports`;
  const summary = L(
    `**Report from ${teamName}:** ${brief}\n\n- Main finding: the signal is real but small; worth watching, not acting on yet.\n- Confidence: medium. Two sources agree, one is older than a month.\n- Next: we keep monitoring and report again on Friday.\n\nFull report: \`${file}\``,
    `**Laporan dari ${teamName}:** ${brief}\n\n- Temuan utama: sinyalnya nyata tapi kecil; layak dipantau, belum perlu ditindaklanjuti.\n- Keyakinan: sedang. Dua sumber sepakat, satu sudah lebih dari sebulan.\n- Berikutnya: kami terus pantau dan lapor lagi hari Jumat.\n\nLaporan lengkap: \`${file}\``,
  );
  r.pending.push(
    S(1800, () => post(reports, `${teamId}/${mgrId}`, summary, { steps: [{ tool: 'Read', detail: file }, { tool: 'SendToSecretary', detail: 'office/reports' }] })),
    S(1200, () => say(teamId, `ceo__${mgrId}`, mgrId, L(`Done. The report went to ${sec.name}, who forwards it to your Telegram.`, `Selesai. Laporannya sudah ke ${sec.name}, yang meneruskannya ke Telegram-mu.`))),
  );
  // the secretary relays it a moment later
  const relay = () => {
    const s2 = useStore.getState().agents[agentKey(OFFICE_ID, sec.id)];
    const ok = !!s2?.telegram?.configured;
    runners[OFFICE_ID]?.pending.push(
      S(1200, () => status(OFFICE_ID, sec.id, 'tool', 'Bash: python scripts/telegram_send.py --config office/secretary/telegram.json --markdown', 'Bash')),
      S(1600, () => {
        post(
          `${OFFICE_ID}__ceo__${sec.id}`,
          `${OFFICE_ID}/${sec.id}`,
          ok
            ? L(`Forwarded to your Telegram:\n\n${summary}`, `Sudah diteruskan ke Telegram-mu:\n\n${summary}`)
            : L(`New report (Telegram is not set up yet, so I am keeping it here):\n\n${summary}`, `Laporan baru (Telegram belum diatur, jadi saya simpan di sini):\n\n${summary}`),
          ok ? { telegram: 'sent' } : {},
        );
        emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId: OFFICE_ID, agentId: sec.id, kind: 'tool', text: ok ? L('Telegram: report sent to the owner', 'Telegram: laporan terkirim ke owner') : L('Report kept in the front office', 'Laporan disimpan di kantor depan') } });
      }),
      S(1500, () => status(OFFICE_ID, sec.id, 'idle', '')),
    );
  };
  r.pending.push(S(200, relay));
}

/** The owner talks to the secretary directly. */
function onSecretaryMessage(msg: Message) {
  const st = useStore.getState();
  const sec = Object.values(st.agents).find((a) => a.teamId === OFFICE_ID && a.role === 'secretary');
  const r = runners[OFFICE_ID];
  if (!sec || !r) return;
  const pending = st.schedules.filter((x) => x.enabled).length;
  r.pending.push(
    S(1200, () => status(OFFICE_ID, sec.id, 'thinking', L('Reading your message', 'Membaca pesanmu'))),
    S(1800, () =>
      post(
        `${OFFICE_ID}__ceo__${sec.id}`,
        `${OFFICE_ID}/${sec.id}`,
        L(
          `Noted: "${msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text}". I will pass it on to the managers who need it and send you one message when there is an answer. Right now ${pending} schedules are active; the next digest goes out at ${sec.telegram?.notify?.digest ?? '07:00'}.`,
          `Dicatat: "${msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text}". Saya teruskan ke manajer yang perlu dan kirim satu pesan begitu ada jawaban. Saat ini ${pending} jadwal aktif; ringkasan berikutnya terkirim jam ${sec.telegram?.notify?.digest ?? '07:00'}.`,
        ),
        { steps: [{ tool: 'Read', detail: 'office/reports/' }, { tool: 'Read', detail: 'employees/*/schedules.json' }] },
      ),
    ),
    S(1200, () => status(OFFICE_ID, sec.id, 'idle', '')),
  );
}

// Scheduled jobs fire now and then (compressed time), so the list shows real "last run" values.
let schedTimer: number | undefined;
function scheduleTick() {
  const st = useStore.getState();
  const due = st.schedules.filter((x) => x.enabled && active(x.teamId));
  if (due.length) {
    const x = due[Math.floor(Math.random() * due.length)];
    const anomaly = x.mode === 'script' && Math.random() < 0.2;
    const result =
      x.mode === 'script'
        ? anomaly
          ? L('Anomaly found, agent woken up', 'Ada anomali, agent dibangunkan')
          : L('OK, nothing unusual', 'OK, tidak ada yang aneh')
        : L('Done, result posted', 'Selesai, hasil dikirim');
    if (x.mode === 'agent' || anomaly) status(x.teamId, x.agentId, 'tool', `Schedule: ${x.title}`, 'Bash');
    emit({ type: 'schedule.run', id: x.id, ts: Date.now(), result });
    emit({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId: x.teamId, agentId: x.agentId, kind: 'tool', text: `${tr(lang(), 'sched.title')}: ${x.title} (${result})` } });
  }
  schedTimer = window.setTimeout(scheduleTick, 22_000 + Math.random() * 14_000);
}

// Live projector charts: one value per second while the presenting team is active.
let liveTimer: number | undefined;
function liveTick() {
  Object.entries(liveFeeds).forEach(([id, f]) => {
    if (!useStore.getState().projector.some((p) => p.id === id)) return void delete liveFeeds[id];
    if (active(f.teamId)) emit({ type: 'projector.data', id, t: Date.now(), values: f.next() });
  });
}

// Invited as advisor: the invited team's manager says hello in the shared room.
function onInvites(before: { id: string; collaborators: { id: string }[] }[]) {
  const st = useStore.getState();
  st.projects.forEach((p) => {
    const old = before.find((b) => b.id === p.id)?.collaborators.map((c) => c.id) ?? [];
    p.collaborators
      .filter((c) => !old.includes(c.id))
      .forEach((c) => {
        const otherTeam = c.kind === 'team' ? c.id : c.id.split('/')[0];
        if (otherTeam === p.teamId) return;
        const om = Object.values(st.agents).find((a) => a.teamId === otherTeam && a.role === 'manager');
        const advisor = c.kind === 'agent' ? st.agents[c.id] : undefined;
        if (!om || !runners[otherTeam]) return;
        const roomId = st.ensureConsult(p.teamId, otherTeam);
        runners[otherTeam].pending.unshift(
          S(1800, () => status(otherTeam, om.id, 'tool', `Read: projects/${p.name}/CLAUDE.md`, 'Read')),
          S(1800, () =>
            post(
              roomId,
              `${otherTeam}/${om.id}`,
              L(
                `Thanks for the invite to **${p.name}**. ${advisor ? `${advisor.name} joins as advisor` : 'Our team joins as advisors'}, read-only: we can read the project folder but will not write to it. Ask here whenever you want a second opinion.`,
                `Terima kasih undangannya ke **${p.name}**. ${advisor ? `${advisor.name} bergabung sebagai penasihat` : 'Tim kami bergabung sebagai penasihat'}, hanya baca: kami bisa membaca folder proyek tapi tidak menulis ke dalamnya. Tanya di sini kapan pun butuh pendapat kedua.`,
              ),
              { steps: [{ tool: 'Read', detail: `projects/${p.name}/CLAUDE.md` }, { tool: 'Read', detail: `projects/${p.name}/MAP.md` }] },
            ),
          ),
        );
      });
  });
}

// A new hire reads its files, says hello, and gets a first task.
const seenHires = new Set<string>();
function onHires() {
  const st = useStore.getState();
  st.activity
    .filter((e) => e.kind === 'hire' && !seenHires.has(e.id))
    .forEach((e) => {
      seenHires.add(e.id);
      const a = st.agents[agentKey(e.teamId, e.agentId)];
      const mgr = Object.values(st.agents).find((x) => x.teamId === e.teamId && x.role === 'manager');
      const r = runners[e.teamId];
      if (!a || !r) return;
      const steps = [
        S(2600, () => status(e.teamId, a.id, 'tool', L('Read: CLAUDE.md, team CLAUDE.md, goals/', 'Read: CLAUDE.md, CLAUDE.md tim, goals/'), 'Read')),
        S(1600, () => say(e.teamId, 'general', a.id, L(`Hi all, I am ${a.name}, ${a.roleTitle.toLowerCase()}. I have read the team brief and goals. Ready for tasks.`, `Halo semua, saya ${a.name}, ${a.roleTitle.toLowerCase()}. Sudah baca brief tim dan goals. Siap menerima tugas.`))),
      ];
      if (mgr && mgr.id !== a.id)
        steps.push(S(1800, () => say(e.teamId, `dm__${mgr.id}__${a.id}`, mgr.id, L(`Welcome, ${a.name}. First task: read knowledge/ and list what we still don’t know in your area.`, `Selamat datang, ${a.name}. Tugas pertama: baca knowledge/ dan daftar apa yang belum kita ketahui di bidangmu.`))));
      r.pending.unshift(...steps);
    });
}

// A new project: the manager reads the scaffold and briefs the team, like /start would.
function onNewProjects(before: string[]) {
  const st = useStore.getState();
  st.projects
    .filter((p) => !before.includes(p.id))
    .forEach((p) => {
      const mgr = Object.values(st.agents).find((a) => a.teamId === p.teamId && a.role === 'manager');
      const r = runners[p.teamId];
      if (!mgr || !r) return;
      const dir = `projects/${p.name}`;
      r.pending.unshift(
        S(1600, () => status(p.teamId, mgr.id, 'tool', `Read: ${dir}/CLAUDE.md`, 'Read')),
        S(2000, () =>
          say(
            p.teamId,
            'general',
            mgr.id,
            L(
              `**New project: ${p.name}** (\`${dir}/\`)

${p.description || ''}

**Shipped means:** ${p.shipped || 'not defined yet, I will propose one'}

**First steps (Discovery)**
1. Everyone drops reference material into \`Knowledge References/\`, then I run \`/index-reference\`.
2. I run \`/auto-research\` to find gaps.
3. Decisions go through \`/decision\`; once we have 3 or more I run \`/build-brief\`.

Every session starts with \`/start\` and ends with \`/journal\` or \`/commit-discussion\`.`,
              `**Proyek baru: ${p.name}** (\`${dir}/\`)

${p.description || ''}

**Selesai artinya:** ${p.shipped || 'belum didefinisikan, saya akan usulkan'}

**Langkah pertama (Discovery)**
1. Semua menaruh bahan referensi ke \`Knowledge References/\`, lalu saya jalankan \`/index-reference\`.
2. Saya jalankan \`/auto-research\` untuk mencari gap.
3. Keputusan dicatat lewat \`/decision\`; setelah ada 3 atau lebih, saya jalankan \`/build-brief\`.

Setiap sesi dimulai dengan \`/start\` dan ditutup dengan \`/journal\` atau \`/commit-discussion\`.`,
            ),
            { steps: [{ tool: 'Read', detail: `${dir}/CLAUDE.md` }, { tool: 'Read', detail: `${dir}/MAP.md` }, { tool: 'Read', detail: `${dir}/COMMANDS.md` }] },
          ),
        ),
      );
    });
}

export function startSimulator() {
  if (running) return () => {};
  running = true;
  lastSeen = Date.now();
  useStore.getState().activity.forEach((e) => seenHires.add(e.id));
  ensureRunners();
  const unsub = useStore.subscribe((st, prev) => {
    if (st.teams !== prev.teams) ensureRunners();
    if (st.messages !== prev.messages) onCeoMessages();
    if (st.activity !== prev.activity) onHires();
    if (st.projects !== prev.projects) {
      onNewProjects(prev.projects.map((p) => p.id));
      onInvites(prev.projects);
    }
  });
  ambientTimer = window.setTimeout(ambient, 2000);
  schedTimer = window.setTimeout(scheduleTick, 9000);
  liveTimer = window.setInterval(liveTick, 1000);
  return () => {
    running = false;
    unsub();
    window.clearTimeout(ambientTimer);
    window.clearTimeout(schedTimer);
    window.clearInterval(liveTimer);
    Object.keys(runners).forEach((k) => {
      window.clearTimeout(runners[k].timer);
      delete runners[k];
    });
  };
}
