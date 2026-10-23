import { OFFICE_ID, type Agent, type Company, type Lang, type Message, type Project, type ProjectorItem, type Room, type Schedule, type Team } from '../types';
import fundingImg from './projector/funding_zscore.png';
import equityImg from './projector/equity_curve.png';
import foodCostImg from './projector/food_cost.png';

export const MOCK_IMAGES = { funding: fundingImg, equity: equityImg, foodCost: foodCostImg };

export const AGENT_COLORS = ['#F2B544', '#5EC8D8', '#EE7B8C', '#A58BEA', '#7FD6A2', '#F08A4B', '#6FA8F5', '#E58AD6'];
export const TEAM_COLORS = ['#9CC9F0', '#F5CF86', '#C9B6F2', '#A3DDBE', '#F4AFBE', '#F6BC94', '#B5D98C'];

export const newSessionId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Front office: owner <-> secretary, and the reports channel every manager can post to. */
export function officeRooms(agents: Agent[]): Room[] {
  const sec = agents.find((a) => a.teamId === OFFICE_ID && a.role === 'secretary');
  if (!sec) return [];
  const managers = agents.filter((a) => a.role === 'manager').map((a) => `${a.teamId}/${a.id}`);
  return [
    { id: `${OFFICE_ID}__ceo__${sec.id}`, teamId: OFFICE_ID, kind: 'ceo', members: ['ceo', sec.id] },
    { id: `${OFFICE_ID}__reports`, teamId: OFFICE_ID, kind: 'reports', members: [`${OFFICE_ID}/${sec.id}`, ...managers] },
  ];
}

/** Manager-to-manager room between two teams (asking for advice, project collaboration). */
export function consultRoom(a: string, b: string): Room {
  const [x, y] = [a, b].sort();
  return { id: `xteam__${x}__${y}`, teamId: x, kind: 'consult', teams: [x, y], members: [`${x}/manager`, `${y}/manager`] };
}

export function roomsForTeam(teamId: string, teamAgents: Agent[]): Room[] {
  const mgr = teamAgents.find((a) => a.role === 'manager');
  const rooms: Room[] = [];
  if (mgr) rooms.push({ id: `${teamId}__ceo__${mgr.id}`, teamId, kind: 'ceo', members: ['ceo', mgr.id] });
  rooms.push({ id: `${teamId}__general`, teamId, kind: 'team', members: teamAgents.map((a) => a.id) });
  if (mgr)
    teamAgents
      .filter((a) => a.id !== mgr.id)
      .forEach((a) => rooms.push({ id: `${teamId}__dm__${mgr.id}__${a.id}`, teamId, kind: 'dm', members: [mgr.id, a.id] }));
  return rooms;
}

export function seed(lang: Lang) {
  const L = (en: string, id: string) => (lang === 'id' ? id : en);
  const ago = (min: number) => Date.now() - min * 60_000;

  const company: Company = { id: 'MY_COMPANY', name: 'My Company', rootPath: 'D:\\Companies\\MY_COMPANY' };

  const teams: Team[] = [
    { id: 'team_quant', name: L('Quant research', 'Riset kuant'), mission: L('Find and validate trading signals for ETH perpetual futures.', 'Mencari dan memvalidasi sinyal trading untuk ETH perpetual futures.'), color: TEAM_COLORS[0], paused: false, meeting: false, lastActive: new Date(ago(4)).toISOString() },
    { id: 'team_resto', name: L('Restaurant operations', 'Operasional restoran'), mission: L('Supplier prices, menu costing and weekly sales review.', 'Harga supplier, costing menu, dan review penjualan mingguan.'), color: TEAM_COLORS[1], paused: false, meeting: false, lastActive: new Date(ago(30)).toISOString() },
    { id: 'team_print', name: L('3D print studio', 'Studio cetak 3D'), mission: L('Marketplace research and quoting for print jobs.', 'Riset marketplace dan penawaran harga untuk pesanan cetak.'), color: TEAM_COLORS[2], paused: true, meeting: false, lastActive: new Date(ago(60 * 24 * 6)).toISOString() },
    { id: 'team_news', name: L('Market news desk', 'Meja berita pasar'), mission: L('Daily brief on crypto and IDX news that matters to our positions.', 'Ringkasan harian berita kripto dan IDX yang relevan dengan posisi kita.'), color: TEAM_COLORS[3], paused: false, meeting: false, lastActive: new Date(ago(12)).toISOString() },
  ];

  const base = { effort: 'medium' as const, outputStyle: 'default' as const, status: 'idle' as const, activity: L('Idle', 'Menganggur'), tokensToday: 0, turnsThisHour: 0, memoryExcerpt: [] as string[] };
  const mk = (a: Partial<Agent> & Pick<Agent, 'id' | 'teamId' | 'name' | 'role' | 'roleTitle' | 'model' | 'color' | 'permissions'>): Agent => ({
    ...base,
    sessionId: newSessionId(),
    ...a,
  });

  const agents: Agent[] = [
    mk({ id: 'manager', teamId: 'team_quant', name: 'Arka', role: 'manager', roleTitle: L('Team manager', 'Manajer tim'), model: 'claude-opus-5-5', effort: 'high', color: AGENT_COLORS[0], permissions: ['web', 'read_company', 'write_workspace', 'write_projects'], tokensToday: 184_200, turnsThisHour: 9, currentTask: L('Evaluate ETH funding rate as a regime signal', 'Evaluasi funding rate ETH sebagai sinyal regime'), memoryExcerpt: [L('The owner wants a clear recommendation first.', 'Owner ingin rekomendasi yang jelas di awal.'), L('Sena is stronger on data pulls, Dira on literature.', 'Sena kuat di penarikan data, Dira di literatur.')] }),
    mk({ id: 'researcher-1', teamId: 'team_quant', name: 'Sena', role: 'researcher', roleTitle: L('Data researcher', 'Peneliti data'), model: 'claude-sonnet-5-5', color: AGENT_COLORS[1], reportsTo: 'manager', permissions: ['web', 'browser', 'read_company', 'write_workspace', 'run_commands'], browserMode: 'separate', tokensToday: 96_400, turnsThisHour: 14, currentTask: L('Pull 2 years of ETHUSDT funding history', 'Tarik histori funding ETHUSDT 2 tahun'), memoryExcerpt: [L('Binance funding settles every 8 hours.', 'Funding Binance diselesaikan tiap 8 jam.')] }),
    mk({ id: 'researcher-2', teamId: 'team_quant', name: 'Dira', role: 'researcher', roleTitle: L('Literature researcher', 'Peneliti literatur'), model: 'claude-sonnet-5-5', outputStyle: 'explanatory', color: AGENT_COLORS[2], reportsTo: 'manager', permissions: ['web', 'read_company', 'write_workspace'], tokensToday: 71_900, turnsThisHour: 11, currentTask: L('Survey research on funding rates', 'Survei riset tentang funding rate'), memoryExcerpt: [L('Cite sources with links in knowledge/ notes.', 'Selalu cantumkan link sumber di catatan knowledge/.')] }),
    mk({ id: 'analyst-1', teamId: 'team_quant', name: 'Bima', role: 'analyst', roleTitle: L('Backtest analyst', 'Analis backtest'), model: 'claude-haiku-5-5', effort: 'low', outputStyle: 'concise', color: AGENT_COLORS[3], reportsTo: 'manager', permissions: ['read_company', 'write_workspace', 'run_commands'], tokensToday: 12_300, turnsThisHour: 2, currentTask: L('Walk-forward backtest of the funding signal', 'Backtest walk-forward sinyal funding'), memoryExcerpt: [L('Use walk-forward splits, never one in-sample run.', 'Pakai walk-forward, jangan satu kali in-sample.')] }),

    mk({ id: 'manager', teamId: 'team_resto', name: 'Laras', role: 'manager', roleTitle: L('Operations manager', 'Manajer operasional'), model: 'claude-sonnet-5-5', color: AGENT_COLORS[4], permissions: ['read_company', 'write_workspace', 'write_projects'], tokensToday: 22_000, turnsThisHour: 3, currentTask: L('Weekly sales review', 'Review penjualan mingguan'), memoryExcerpt: [L('Report every Monday morning.', 'Laporan setiap Senin pagi.')] }),
    mk({ id: 'researcher-1', teamId: 'team_resto', name: 'Tama', role: 'researcher', roleTitle: L('Supplier researcher', 'Peneliti supplier'), model: 'claude-haiku-5-5', color: AGENT_COLORS[5], reportsTo: 'manager', permissions: ['web', 'read_company', 'write_workspace'], tokensToday: 8_100, turnsThisHour: 2, currentTask: L('Compare chicken and rice prices', 'Bandingkan harga ayam dan beras'), memoryExcerpt: [L('Prices in IDR per kg.', 'Harga dalam Rupiah per kg.')] }),
    mk({ id: 'analyst-1', teamId: 'team_resto', name: 'Wulan', role: 'analyst', roleTitle: L('Menu costing analyst', 'Analis costing menu'), model: 'claude-haiku-5-5', color: AGENT_COLORS[6], reportsTo: 'manager', permissions: ['read_company', 'write_workspace'], tokensToday: 5_400, turnsThisHour: 1, currentTask: L('Update food cost per menu', 'Perbarui food cost per menu'), memoryExcerpt: [] }),

    mk({ id: 'manager', teamId: 'team_print', name: 'Gilang', role: 'manager', roleTitle: L('Studio manager', 'Manajer studio'), model: 'claude-sonnet-5-5', color: AGENT_COLORS[7], permissions: ['read_company', 'write_workspace', 'write_projects'], currentTask: L('Paused by the owner', 'Dijeda oleh owner') }),
    mk({ id: 'researcher-1', teamId: 'team_print', name: 'Nadia', role: 'researcher', roleTitle: L('Marketplace researcher', 'Peneliti marketplace'), model: 'claude-haiku-5-5', color: AGENT_COLORS[1], reportsTo: 'manager', permissions: ['web', 'read_company', 'write_workspace'] }),

    mk({ id: 'manager', teamId: 'team_news', name: 'Rani', role: 'manager', roleTitle: L('News editor', 'Editor berita'), model: 'claude-sonnet-5-5', color: AGENT_COLORS[2], permissions: ['web', 'read_company', 'write_workspace', 'write_projects'], tokensToday: 31_000, turnsThisHour: 4, currentTask: L('Morning brief', 'Brief pagi') }),
    mk({ id: 'researcher-1', teamId: 'team_news', name: 'Yoga', role: 'researcher', roleTitle: L('News scout', 'Pemantau berita'), model: 'claude-haiku-5-5', color: AGENT_COLORS[4], reportsTo: 'manager', permissions: ['web', 'browser', 'read_company', 'write_workspace'], browserMode: 'separate', tokensToday: 18_500, turnsThisHour: 6 }),
    mk({ id: 'secretary', teamId: OFFICE_ID, name: 'Sekar', role: 'secretary', roleTitle: L('Secretary', 'Sekretaris'), model: 'claude-haiku-5-5', effort: 'low', outputStyle: 'concise', color: '#E8E4DA', permissions: ['read_company', 'run_commands'], tokensToday: 3_100, telegram: { configured: true, chatId: '581203974', notify: { input: true, report: true, digest: '07:00' } }, currentTask: L('Relay reports and questions to the owner on Telegram', 'Meneruskan laporan dan pertanyaan ke owner lewat Telegram'), memoryExcerpt: [L('Owner prefers one digest instead of many small pings.', 'Owner lebih suka satu ringkasan daripada banyak notifikasi kecil.')] }),
    mk({ id: 'advisor-1', teamId: 'team_quant', name: 'Wira', role: 'advisor', roleTitle: L('Advisor, my wavelet research session', 'Penasihat, sesi riset wavelet saya'), model: 'claude-opus-5-5', color: '#C8D1D9', reportsTo: 'manager', permissions: ['web', 'read_company'], advisorSession: { sessionId: '7f3c2a91-5b1e-4d8a-9c47-2e6f1d0b8a35', fork: true }, tokensToday: 9_800, currentTask: L('Answers questions about ETH regime detection', 'Menjawab pertanyaan soal deteksi regime ETH'), memoryExcerpt: [L('Continues an existing Claude Code session (forked). Read-only.', 'Melanjutkan sesi Claude Code yang sudah ada (fork). Hanya baca.')] }),
    mk({ id: 'reviewer-1', teamId: 'team_news', name: 'Putri', role: 'reviewer', roleTitle: L('Fact checker', 'Pemeriksa fakta'), model: 'claude-sonnet-5-5', color: AGENT_COLORS[3], reportsTo: 'manager', permissions: ['web', 'read_company', 'write_workspace'], status: 'paused', activity: L('Paused by you', 'Dijeda oleh kamu'), tokensToday: 4_000 }),
  ];

  let n = 0;
  const m = (roomId: string, from: string, en: string, id: string, minAgo: number): Message => ({ id: `seed-${n++}`, ts: ago(minAgo), roomId, from, text: L(en, id) });

  const messages: Message[] = [
    m('team_quant__ceo__manager', 'ceo', 'Arka, please check whether the ETH funding rate works as a regime signal on the 1H timeframe. I need a recommendation, not just data.', 'Arka, tolong cek apakah funding rate ETH bisa dipakai sebagai sinyal regime di timeframe 1H. Saya butuh rekomendasi, bukan cuma data.', 42),
    {
      ...m('team_quant__ceo__manager', 'manager', `On it. I read \`goals/2026-Q4.md\` and our notes in \`knowledge/\` first. Here is the plan.

**Who does what**

| Agent | Task | Output |
|---|---|---|
| Sena | Pull 2 years of ETHUSDT perp funding (8h), resample to 1H | \`workspace/clean/funding_1h.parquet\` |
| Dira | Collect research on funding as a return predictor | \`knowledge/funding-rate-literature.md\` |
| Bima | Walk-forward backtest of a z-score signal | \`projects/ETH Funding Signal/03 Outputs/\` |

**Starting hypotheses**
1. Extreme funding (|z| > 2) is followed by mean reversion within 24 to 72 hours.
2. The effect is stronger when open interest rises at the same time.

**What I will need from you later**
- The maximum drawdown you accept before we move to paper trading.

First update within the hour. I will put the charts on the projector.`, `Siap. Saya baca \`goals/2026-Q4.md\` dan catatan di \`knowledge/\` dulu. Ini rencananya.

**Pembagian kerja**

| Agent | Tugas | Output |
|---|---|---|
| Sena | Tarik funding ETHUSDT perp 2 tahun (8 jam), resample ke 1H | \`workspace/clean/funding_1h.parquet\` |
| Dira | Kumpulkan riset tentang funding sebagai prediktor return | \`knowledge/funding-rate-literature.md\` |
| Bima | Backtest walk-forward sinyal z-score | \`projects/ETH Funding Signal/03 Outputs/\` |

**Hipotesis awal**
1. Funding ekstrem (|z| > 2) diikuti mean reversion dalam 24–72 jam.
2. Efeknya lebih kuat kalau open interest ikut naik.

**Yang perlu kamu putuskan nanti**
- Batas drawdown maksimum yang masih kamu terima sebelum lanjut ke paper trading.

Update pertama dalam ±1 jam. Chart-nya akan saya tampilkan di proyektor.`, 41),
      steps: [
        { tool: 'Read', detail: 'goals/2026-Q4.md' },
        { tool: 'Grep', detail: '"funding" in knowledge/ (3 files)' },
        { tool: 'Read', detail: 'knowledge/wavelet-regime-notes.md' },
        { tool: 'Write', detail: 'projects/ETH Funding Signal/04 System/IMPLEMENTATION_BRIEF.md' },
        { tool: 'SendMessage', detail: 'DM to Sena, Dira, Bima' },
      ],
    },
    m('team_quant__dm__manager__researcher-1', 'manager', 'Sena, pull ETHUSDT perpetual funding history for the last two years from Binance. Keep the raw files in workspace/raw/.', 'Sena, tarik histori funding rate ETHUSDT perpetual 2 tahun terakhir dari Binance. Simpan mentahnya di workspace/raw/.', 40),
    m('team_quant__dm__manager__researcher-1', 'researcher-1', 'OK. /fapi/v1/fundingRate returns 1000 rows per call, so I will paginate. Starting now.', 'Oke. Endpoint /fapi/v1/fundingRate limit 1000 per request, jadi perlu paginasi. Mulai sekarang.', 39),
    m('team_quant__dm__manager__researcher-2', 'manager', 'Dira, find research on whether funding rates predict crypto returns. Focus on intraday data.', 'Dira, cari riset tentang daya prediksi funding rate terhadap return crypto. Fokus ke yang pakai data intraday.', 40),
    m('team_quant__dm__manager__analyst-1', 'manager', 'Bima, set up a walk-forward frame for a z-score signal. Wait for Sena\u2019s data.', 'Bima, siapkan kerangka walk-forward untuk sinyal berbasis z-score. Tunggu data dari Sena.', 38),
    m('team_quant__general', 'researcher-2', 'Found three relevant papers. Two of them show extreme funding tends to mean-revert within 24 to 72 hours.', 'Ketemu 3 paper yang relevan. Dua di antaranya bilang funding ekstrem cenderung diikuti mean reversion dalam 24–72 jam.', 22),
    m('team_quant__general', 'researcher-1', '@Dira do they use raw funding or a normalised version? I want the same column.', '@Dira mereka pakai funding mentah atau dinormalisasi? Supaya saya siapkan kolom yang sama.', 21),
    m('team_quant__general', 'researcher-2', 'Rolling 30-day z-score. Summary is in knowledge/funding-rate-literature.md.', 'Z-score rolling 30 hari. Ringkasannya ada di knowledge/funding-rate-literature.md.', 20),
    {
      ...m('team_quant__ceo__manager', 'manager', `**Update 1: data is in, first look is on the projector.**

- 2,190 funding periods (8h) with no gaps, Oct 2024 to Oct 2026.
- |z| > 2 happens 3.1% of the time; red dots are extreme positive funding, green dots extreme negative.
- Visually, price tends to pull back after the red clusters. Bima is now testing whether that holds out of sample.

Next update: walk-forward results with Sharpe and drawdown.`, `**Update 1: data sudah lengkap, gambaran awal ada di proyektor.**

- 2.190 periode funding (8 jam) tanpa gap, Okt 2024 sampai Okt 2026.
- |z| > 2 terjadi 3,1% dari waktu; titik merah funding positif ekstrem, titik hijau negatif ekstrem.
- Secara visual, harga cenderung turun setelah kumpulan titik merah. Bima sekarang menguji apakah ini bertahan di data out-of-sample.

Update berikutnya: hasil walk-forward lengkap dengan Sharpe dan drawdown.`, 18),
      steps: [
        { tool: 'Read', detail: 'workspace/clean/funding_1h.parquet (via python)' },
        { tool: 'Bash', detail: 'python "projects/ETH Funding Signal/04 System/plot_funding.py"' },
        { tool: 'ShowOnProjector', detail: 'projects/ETH Funding Signal/03 Outputs/funding_zscore.png' },
      ],
      projectorId: 'pj-seed-1',
    },
    m('team_resto__ceo__manager', 'ceo', 'Laras, please summarise last week\u2019s sales per menu item.', 'Laras, tolong ringkas penjualan minggu lalu per menu.', 60 * 26),
    m('team_resto__ceo__manager', 'manager', 'Saved in projects/weekly-sales/2026-W42.md. The top three items grew 12% week on week.', 'Sudah saya simpan di projects/weekly-sales/2026-W42.md. Tiga menu teratas naik 12% dibanding minggu sebelumnya.', 60 * 26 - 8),
    m('team_news__ceo__manager', 'ceo', 'Rani, every morning at 7 send me the five news items that matter most for ETH and our IDX watchlist.', 'Rani, setiap pagi jam 7 kirim 5 berita paling penting untuk ETH dan watchlist IDX kita.', 60 * 30),
    m('team_news__ceo__manager', 'manager', 'Noted. Yoga scouts, Putri fact-checks, I write the brief.', 'Siap. Yoga memantau, Putri memeriksa fakta, saya yang menulis brief-nya.', 60 * 30 - 3),
  ];

  messages.push(
    m(`${OFFICE_ID}__ceo__secretary`, 'secretary', `**Daily digest, 07:00**

- **Quant research**: data complete, backtest running. No decision needed yet.
- **Market news desk**: morning brief sent to you at 06:52.
- **Restaurant operations**: waiting for your OK on switching to supplier B for chicken (6% cheaper).

One item needs you: *supplier B for chicken, yes or no?*`, `**Ringkasan harian, 07:00**

- **Riset kuant**: data lengkap, backtest berjalan. Belum ada keputusan yang perlu kamu ambil.
- **Meja berita pasar**: brief pagi sudah dikirim jam 06:52.
- **Operasional restoran**: menunggu persetujuanmu untuk pindah ke supplier B untuk ayam (6% lebih murah).

Satu hal butuh jawabanmu: *supplier B untuk ayam, ya atau tidak?*`, 200),
    m(`${OFFICE_ID}__reports`, 'team_resto/manager', 'Report for the owner: supplier B is 6% cheaper for chicken this week with the same grade. I need a yes or no to switch from next Monday.', 'Laporan untuk owner: supplier B 6% lebih murah untuk ayam minggu ini dengan grade yang sama. Saya butuh ya atau tidak untuk pindah mulai Senin depan.', 205),
    m('xteam__team_news__team_quant', 'team_quant/manager', '@Rani are there news events that explain the funding spikes on 3 Aug and 21 Sep? We want to know whether the extremes were caused by news or by positioning.', '@Rani apakah ada berita yang menjelaskan lonjakan funding tanggal 3 Agu dan 21 Sep? Kami ingin tahu apakah ekstremnya karena berita atau karena positioning.', 35),
    m('xteam__team_news__team_quant', 'team_news/manager', `Both dates are in our archive:

- **3 Aug**: ETF outflow headline plus a large liquidation cascade, so news-driven.
- **21 Sep**: no major news; looks like positioning.

Summary is in \`knowledge/news-vs-funding-2026.md\`, readable for your team.`, `Dua tanggal itu ada di arsip kami:

- **3 Agu**: berita arus keluar ETF ditambah likuidasi besar, jadi dipicu berita.
- **21 Sep**: tidak ada berita besar; terlihat seperti positioning.

Ringkasannya ada di \`knowledge/news-vs-funding-2026.md\`, bisa dibaca tim kamu.`, 31),
  );
  const tag = (x: Message, extra: Partial<Message>) => Object.assign(x, extra);
  tag(messages[messages.length - 4], { telegram: 'sent' });

  const schedules: Schedule[] = [
    { id: 'sch-1', teamId: 'team_news', agentId: 'manager', title: L('Morning brief to the owner', 'Brief pagi untuk owner'), cron: '45 6 * * *', human: L('Every day at 06:45', 'Setiap hari jam 06:45'), mode: 'agent', command: L('Write the 5 most important ETH and IDX news items and send them to the secretary.', 'Tulis 5 berita ETH dan IDX terpenting lalu kirim ke sekretaris.'), enabled: true, createdBy: 'owner', lastRun: ago(60 * 2), lastResult: L('Sent to secretary', 'Terkirim ke sekretaris'), runs: 14 },
    { id: 'sch-2', teamId: 'team_quant', agentId: 'researcher-1', title: L('Pull latest funding', 'Tarik funding terbaru'), cron: '5 */8 * * *', human: L('Every 8 hours', 'Setiap 8 jam'), mode: 'script', command: 'python "projects/ETH Funding Signal/04 System/fetch_funding.py" --append', enabled: true, createdBy: 'manager', lastRun: ago(95), lastResult: L('OK, 1 new row, no anomaly', 'OK, 1 baris baru, tidak ada anomali'), runs: 41 },
    { id: 'sch-3', teamId: 'team_resto', agentId: 'researcher-1', title: L('Supplier price check', 'Cek harga supplier'), cron: '0 8 * * 1', human: L('Every Monday at 08:00', 'Setiap Senin jam 08:00'), mode: 'script', command: 'python "projects/Menu Costing/03 System/supplier_prices.py"', enabled: true, createdBy: 'owner', lastRun: ago(60 * 24), lastResult: L('Chicken price changed > 5%, Tama was woken up', 'Harga ayam berubah > 5%, Tama dibangunkan'), runs: 7 },
  ];

  const projector: ProjectorItem[] = [
    {
      id: 'pj-seed-1',
      ts: ago(18),
      teamId: 'team_quant',
      agentId: 'manager',
      title: L('ETH funding z-score and price', 'Funding z-score ETH dan harga'),
      path: 'projects/ETH Funding Signal/03 Outputs/funding_zscore.png',
      src: fundingImg,
      kind: 'image',
    },
  ];

  const projects: Project[] = [
    {
      id: 'eth-funding-signal',
      name: 'ETH Funding Signal',
      teamId: 'team_quant',
      description: L('Research and validate ETHUSDT perpetual funding rate as a 1H regime signal.', 'Riset dan validasi funding rate ETHUSDT perpetual sebagai sinyal regime 1H.'),
      shipped: L('A signal that passes walk-forward backtesting and runs in paper trading for at least 30 days.', 'Sinyal yang lolos backtest walk-forward dan berjalan di paper trading minimal 30 hari.'),
      people: 'Owner, Arka, Sena, Dira, Bima',
      process: ['Data', 'Research', 'Backtest', 'Outputs'],
      rules: [L('Save charts in 03 Outputs and show them on the projector', 'Simpan chart di 03 Outputs dan tampilkan lewat proyektor')],
      phase: 'build',
      created: '2026-10-12',
      lastSession: L('Walk-forward backtest on 5 folds; open-interest filter tested', 'Backtest walk-forward 5 lipatan; filter open interest diuji'),
      decisions: 6,
      findings: 11,
      collaborators: [{ kind: 'team', id: 'team_news', access: 'advisor', invitedAt: ago(60 * 20) }],
    },
    {
      id: 'menu-costing',
      name: 'Menu Costing',
      teamId: 'team_resto',
      description: L('Weekly food cost per menu item from supplier prices.', 'Food cost mingguan per menu dari harga supplier.'),
      shipped: L('Every menu item under 35% food cost, reviewed weekly.', 'Semua menu di bawah 35% food cost, direview tiap minggu.'),
      people: 'Owner, Laras, Tama, Wulan',
      process: ['Supplier Prices', 'Costing', 'Outputs'],
      rules: [L('Prices in IDR per kg', 'Harga dalam Rupiah per kg')],
      phase: 'checkpoint',
      created: '2026-09-02',
      lastSession: L('Week 42 costing done; two items above target', 'Costing minggu 42 selesai; dua menu di atas target'),
      decisions: 3,
      findings: 5,
      collaborators: [],
    },
  ];

  const consults: Room[] = [consultRoom('team_quant', 'team_news')];

  return { company, teams, agents, messages, projector, projects, schedules, consults };
}
