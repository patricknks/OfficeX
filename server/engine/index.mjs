// OfficeX engine: the company folder as state, Claude Code agents as workers.
//
//   owner ──message──▶ manager turn ──send_message──▶ agent turn ──reply──▶ manager turn ──▶ owner
//
// Every agent turn is one `claude -p --resume <session>` process (see runner.mjs). Agents talk through the
// OfficeX MCP tools (mcp-server.mjs → /api/internal/*). Everything is saved in the company folder, so the
// app can restart at any time; the GUI follows along through Server-Sent Events.
//
// Loop safety: a message sent with a tool is a request and wakes the receiver; the receiver's final answer
// wakes the requester once; an answer to an answer wakes nobody. On top of that: a hop limit per
// conversation chain, a turn limit per agent per hour, and a limit on parallel turns.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { uid, uuid, UUID_RE, localDate, localStamp, slugify, safeId, readJson, writeJson, writeText, appendJsonl, readJsonlTail, rel, inside, clip } from './util.mjs';
import { parseCron, cronMatches, humanCron } from './cron.mjs';
import { companyClaudeMd, teamClaudeMd, agentClaudeMd } from './prompts.mjs';
import { resolveClaude, runTurn, failureKind, childEnv } from './runner.mjs';
import { scaffoldProject } from '../scaffold-project.mjs';

export const OFFICE = 'office';
const AGENT_FIELDS = ['id', 'teamId', 'name', 'role', 'roleTitle', 'model', 'effort', 'outputStyle', 'color', 'sessionId', 'started', 'permissions', 'browserMode', 'reportsTo', 'advisorSession', 'currentTask', 'hiredAt', 'paused', 'usage', 'context', 'compactedAt', 'autoModel'];
const PATCHABLE = ['name', 'roleTitle', 'model', 'effort', 'outputStyle', 'permissions', 'browserMode', 'currentTask', 'color', 'autoModel'];
const MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const SERIES_COLORS = ['#E0A21B', '#2F8FD8', '#D9584A', '#3FA66B', '#8E6BD8', '#E07B39'];

export function createEngine({ cfg, appRoot, port, log }) {
  const C = cfg.companyRoot ? path.resolve(cfg.companyRoot) : '';
  const enabled = !!C;
  const lang = cfg.language === 'en' ? 'en' : 'id';
  const L = (en, id) => (lang === 'id' ? id : en);
  const LIM = {
    concurrent: Number(cfg.maxConcurrentTurns ?? 3),
    perHour: Number(cfg.maxTurnsPerAgentPerHour ?? 30),
    hops: Number(cfg.maxHops ?? 24),
    timeoutMs: Number(cfg.turnTimeoutMinutes ?? 20) * 60_000,
    toolTurns: Number(cfg.maxToolTurns ?? 60),
    // compact an agent's conversation once it is this big (tokens); 0 = only Claude Code's own auto-compact
    compactAt: Number(cfg.compactAtTokens ?? 60_000),
  };

  const S = {
    company: { id: '', name: '', rootPath: C },
    teams: [],
    agents: new Map(), // key "team/agent" -> agent (persisted fields + runtime)
    projects: [],
    schedules: [],
    consults: new Set(),
    projector: [],
    live: {}, // projector id -> { t: [], values: [][] }
    activity: [],
    claude: { state: 'disconnected', since: 0, version: '', error: '' },
    messages: new Map(), // roomId -> recent messages
    telegram: { configured: false, chatId: '', notify: { input: true, report: true, digest: '07:00' } },
    reminders: [], // owner reminders kept by the secretary: { id, text, at (ms), repeat (cron|null), created }
  };
  let claudeBin = null;
  const clients = new Set();
  const turns = new Map(); // token -> turn
  const running = new Map(); // agent key -> child process
  const feeds = new Map(); // projector id -> { abs, offset, teamId }
  const timers = [];

  // ---------------------------------------------------------------- paths
  const P = {
    team: (t) => path.join(C, 'employees', t),
    agent: (a) => (a.teamId === OFFICE ? path.join(C, OFFICE, a.id) : path.join(C, 'employees', a.teamId, a.id)),
    chat: (roomId) => path.join(C, 'chat', `${roomId}.jsonl`),
    schedules: (t) => path.join(C, 'employees', t, 'schedules.json'),
    telegram: () => path.join(C, OFFICE, 'secretary', 'telegram.json'),
    engine: () => path.join(C, OFFICE, 'engine.json'),
    reminders: () => path.join(C, OFFICE, 'reminders.json'),
    // the Claude account OfficeX signed in to from the GUI (long-lived token from `claude setup-token`); never sent to the GUI
    account: () => path.join(C, OFFICE, 'claude-account.json'),
  };
  const key = (a) => `${a.teamId}/${a.id}`;
  const teamOf = (id) => S.teams.find((t) => t.id === id);
  const agentsOf = (teamId) => [...S.agents.values()].filter((a) => a.teamId === teamId);
  const managerOf = (teamId) => agentsOf(teamId).find((a) => a.role === 'manager');
  const secretary = () => agentsOf(OFFICE).find((a) => a.role === 'secretary');

  // ---------------------------------------------------------------- events (SSE)
  function emit(ev) {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(line);
  }
  let snapTimer = null;
  function snapshot() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => emit({ type: 'snapshot', state: structural() }), 60);
  }
  function activity(teamId, agentId, kind, text) {
    const ev = { id: uid('act'), ts: Date.now(), teamId, agentId, kind, text: clip(text, 160) };
    S.activity.unshift(ev);
    S.activity.length = Math.min(S.activity.length, 80);
    emit({ type: 'activity', event: ev });
  }

  // ---------------------------------------------------------------- agents: persist + view
  function saveAgent(a) {
    const out = {};
    for (const f of AGENT_FIELDS) if (a[f] !== undefined) out[f] = a[f];
    writeJson(path.join(P.agent(a), 'agent.json'), out);
  }
  function tokensToday(a) {
    return a.usage?.day === localDate() ? a.usage.tokens : 0;
  }
  function turnsThisHour(a) {
    const cut = Date.now() - 3600_000;
    a.turnTimes = (a.turnTimes ?? []).filter((t) => t > cut);
    return a.turnTimes.length;
  }
  function view(a) {
    return {
      id: a.id,
      teamId: a.teamId,
      name: a.name,
      role: a.role,
      roleTitle: a.roleTitle,
      model: a.model,
      effort: a.effort ?? 'medium',
      outputStyle: a.outputStyle ?? 'default',
      color: a.color,
      sessionId: a.sessionId,
      status: a.paused ? 'paused' : a.status ?? 'idle',
      activity: a.paused ? '' : a.activity ?? '',
      tool: a.tool,
      reportsTo: a.reportsTo,
      permissions: a.permissions ?? [],
      browserMode: a.browserMode,
      tokensToday: tokensToday(a),
      turnsThisHour: turnsThisHour(a),
      currentTask: a.currentTask,
      memoryExcerpt: memoryLines(a).slice(-8),
      autoModel: a.role === 'manager' ? a.autoModel !== false : undefined,
      context: a.context ?? 0,
      compactAt: LIM.compactAt,
      compactedAt: a.compactedAt,
      compacting: !!a.compacting,
      runModel: a.runModel,
      advisorSession: a.advisorSession,
      telegram: a.role === 'secretary' ? { configured: S.telegram.configured, chatId: S.telegram.chatId, notify: S.telegram.notify } : undefined,
    };
  }
  function setStatus(a, status, text = '', tool) {
    a.status = status;
    a.activity = text;
    a.tool = tool;
    if (status === 'idle' || status === 'waiting') a.runModel = undefined; // the task-specific model ends with the turn
    if (a.paused) return;
    emit({ type: 'agent.status', teamId: a.teamId, agentId: a.id, status, activity: text, tool, runModel: a.runModel });
  }

  // ---------------------------------------------------------------- rooms
  function rooms() {
    const out = [];
    for (const t of S.teams) {
      const members = agentsOf(t.id);
      const mgr = members.find((a) => a.role === 'manager');
      if (mgr) out.push({ id: `${t.id}__ceo__${mgr.id}`, teamId: t.id, kind: 'ceo', members: ['ceo', mgr.id] });
      out.push({ id: `${t.id}__general`, teamId: t.id, kind: 'team', members: members.map((a) => a.id) });
      if (mgr) for (const a of members) if (a.id !== mgr.id) out.push({ id: `${t.id}__dm__${mgr.id}__${a.id}`, teamId: t.id, kind: 'dm', members: [mgr.id, a.id] });
    }
    const sec = secretary();
    if (sec) {
      const mgrs = [...S.agents.values()].filter((a) => a.role === 'manager').map(key);
      out.push({ id: `${OFFICE}__ceo__${sec.id}`, teamId: OFFICE, kind: 'ceo', members: ['ceo', sec.id] });
      out.push({ id: `${OFFICE}__reports`, teamId: OFFICE, kind: 'reports', members: [key(sec), ...mgrs] });
    }
    for (const id of S.consults) out.push(consultRoom(...id.slice(7).split('__')));
    return out;
  }
  function consultRoom(a, b) {
    const [x, y] = [a, b].sort();
    return { id: `xteam__${x}__${y}`, teamId: x, kind: 'consult', teams: [x, y], members: [`${x}/manager`, `${y}/manager`] };
  }
  const roomById = (id) => rooms().find((r) => r.id === id);
  const memberKey = (room, m) => (m === 'ceo' || m === 'system' || m.includes('/') ? m : `${room.teamId}/${m}`);
  function roomLabel(room, forAgent) {
    if (room.kind === 'ceo') return room.teamId === OFFICE ? L('the front office chat with the owner', 'chat kantor depan dengan owner') : L('your chat with the owner', 'chat kamu dengan owner');
    if (room.kind === 'team') return L(`the team room of ${teamOf(room.teamId)?.name}`, `ruang tim ${teamOf(room.teamId)?.name}`);
    if (room.kind === 'dm') {
      const other = room.members.find((m) => m !== forAgent?.id);
      return L(`your direct chat with ${S.agents.get(`${room.teamId}/${other}`)?.name ?? other}`, `chat langsung dengan ${S.agents.get(`${room.teamId}/${other}`)?.name ?? other}`);
    }
    if (room.kind === 'consult') {
      const other = room.teams.find((t) => t !== forAgent?.teamId);
      return L(`the shared room with team ${teamOf(other)?.name ?? other}`, `ruang bersama dengan tim ${teamOf(other)?.name ?? other}`);
    }
    return L('the front office reports room', 'ruang laporan kantor depan');
  }
  function nameOf(k) {
    if (k === 'ceo') return L('Owner', 'Owner');
    if (k === 'system') return 'OfficeX';
    const a = S.agents.get(k);
    return a ? `${a.name} (${a.roleTitle}${a.teamId !== OFFICE ? `, ${teamOf(a.teamId)?.name ?? a.teamId}` : ''})` : k;
  }

  // ---------------------------------------------------------------- messages
  function cache(roomId) {
    if (!S.messages.has(roomId)) S.messages.set(roomId, readJsonlTail(P.chat(roomId), 150));
    return S.messages.get(roomId);
  }
  function findMessage(roomId, id) {
    return cache(roomId).find((m) => m.id === id);
  }
  /** Save + broadcast a message. `from` is "ceo", "system" or an agent key. */
  function post(roomId, fromKey, text, extra = {}) {
    const room = roomById(roomId);
    if (!room) throw new Error(`no room ${roomId}`);
    const cross = room.kind === 'consult' || room.kind === 'reports';
    const from = fromKey === 'ceo' || fromKey === 'system' ? fromKey : cross ? fromKey : fromKey.split('/')[1];
    const msg = { id: uid('msg'), ts: Date.now(), roomId, from, text, ...extra };
    appendJsonl(P.chat(roomId), msg);
    const list = cache(roomId);
    list.push(msg);
    if (list.length > 300) list.splice(0, list.length - 300);
    const { hop, kind, wake, ...pub } = msg;
    emit({ type: 'message', message: pub });
    const t = teamOf(room.teamId);
    if (t) t.lastActive = new Date().toISOString();
    if (fromKey !== 'ceo' && fromKey !== 'system') {
      const a = S.agents.get(fromKey);
      if (a) activity(a.teamId, a.id, 'message', L(`posted in ${room.kind === 'ceo' ? 'the owner chat' : room.kind}`, `menulis di ${room.kind === 'ceo' ? 'chat owner' : room.kind}`));
    }
    return msg;
  }

  // ---------------------------------------------------------------- queue / wake
  function savePending(a) {
    try {
      writeJson(path.join(P.agent(a), '.officex', 'pending.json'), a.pending ?? []);
    } catch {
      /* folder gone (team deleted) */
    }
  }
  /** Give an agent a new turn later for this message. */
  const MODEL_ALIAS = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
  function wake(agentKey, msg, { hop = 0, kind = 'ask', from, run } = {}) {
    const a = S.agents.get(agentKey);
    if (!a) return false;
    a.pending = a.pending ?? [];
    if (hop > LIM.hops) {
      // a long agent-to-agent chain: keep the message, but wait for a word from the owner before going on
      // (guards against runaway loops without losing work)
      a.pending.push({ roomId: msg.roomId, msgId: msg.id, hop: 0, kind, from: from ?? msg.from, at: Date.now(), held: true, ...(run ? { run } : {}) });
      savePending(a);
      activity(a.teamId, a.id, 'status', L(`chain limit (${LIM.hops} steps): message kept, waiting for the owner`, `batas rantai (${LIM.hops} langkah): pesan disimpan, menunggu owner`));
      chainNotice(a.teamId);
      return false;
    }
    a.pending.push({ roomId: msg.roomId, msgId: msg.id, hop, kind, from: from ?? msg.from, at: Date.now(), ...(run ? { run } : {}) });
    savePending(a);
    if (kind === 'ask' && from === 'ceo') {
      a.currentTask = clip(msg.text, 120);
      saveAgent(a);
    }
    pumpSoon();
    return true;
  }
  const chainNoticed = new Map(); // teamId -> time of the last notice
  function chainNotice(teamId) {
    const last = chainNoticed.get(teamId) ?? 0;
    if (Date.now() - last < 10 * 60_000) return;
    chainNoticed.set(teamId, Date.now());
    const mgr = managerOf(teamId);
    const team = teamOf(teamId);
    if (!mgr || !team) return;
    const text = L(
      `The team has been passing work between agents for ${LIM.hops} steps without you. Their next messages are kept on hold so nothing runs away. Reply anything here (e.g. "continue") to let them carry on, or give new directions.`,
      `Tim sudah saling mengoper pekerjaan ${LIM.hops} langkah tanpa kamu. Pesan berikutnya disimpan dulu supaya tidak berjalan tanpa kendali. Balas apa saja di sini (mis. "lanjut") supaya mereka melanjutkan, atau beri arahan baru.`,
    );
    post(`${teamId}__ceo__${mgr.id}`, 'system', text);
    relayToOwner(`${L('Needs your input', 'Butuh masukanmu')} — ${team.name}:\n\n${text}`, { reason: 'input' });
  }
  /** The owner spoke to this team: held messages go on, the chain starts again at 0. */
  function releaseHeld(teamId) {
    let any = false;
    for (const a of agentsOf(teamId)) {
      if (!a.pending?.some((i) => i.held)) continue;
      a.pending = a.pending.map((i) => (i.held ? { ...i, held: false, hop: 0 } : i));
      savePending(a);
      any = true;
    }
    if (any) {
      chainNoticed.delete(teamId);
      pumpSoon();
    }
  }
  let pumpTimer = null;
  function pumpSoon() {
    clearTimeout(pumpTimer);
    pumpTimer = setTimeout(pump, 50);
  }
  function pump() {
    if (S.claude.state !== 'connected') return;
    const ready = [...S.agents.values()]
      .filter((a) => a.pending?.some((i) => !i.held) && !running.has(key(a)) && !a.paused && !(a.teamId !== OFFICE && teamOf(a.teamId)?.paused))
      .sort((x, y) => x.pending.find((i) => !i.held).at - y.pending.find((i) => !i.held).at);
    for (const a of ready) {
      if (running.size >= LIM.concurrent) break;
      if (turnsThisHour(a) >= LIM.perHour) {
        if (a.status !== 'waiting') setStatus(a, 'waiting', L('Hourly turn limit reached', 'Batas giliran per jam tercapai'));
        continue;
      }
      startTurn(a);
    }
    // compaction waits until the agent has nothing else to do, and takes a turn slot like any turn
    for (const a of S.agents.values()) {
      if (running.size >= LIM.concurrent) break;
      if (a.needsCompact && a.started && !a.paused && !a.pending?.some((i) => !i.held) && !running.has(key(a))) startCompact(a);
    }
  }

  /** Summarise an agent's conversation with Claude Code's /compact; memory.md and the company files are not touched. */
  function startCompact(a) {
    const k = key(a);
    a.needsCompact = false;
    a.compacting = true;
    const before = a.context ?? 0;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', a.model || 'claude-sonnet-5-5', '--resume', a.sessionId];
    const focus = L(
      'Keep: open tasks and who is waiting for what, decisions made, instructions and routines from the owner, names and paths of files and projects, what was last delivered. Drop: raw tool output, data already saved in files, finished small talk.',
      'Pertahankan: tugas yang masih berjalan dan siapa menunggu apa, keputusan, instruksi dan rutinitas dari owner, nama dan path file serta proyek, hasil terakhir yang dikirim. Buang: output tool mentah, data yang sudah tersimpan di file, obrolan yang sudah selesai.',
    );
    setStatus(a, 'thinking', L('Tidying up its memory', 'Merapikan ingatan'));
    log(`compact ${k} (context ${Math.round(before / 1000)}k)`);
    const { child, done } = runTurn({ claude: claudeBin, cwd: P.agent(a), args, prompt: `/compact ${focus}`, env: { OFFICEX_COMPANY: C, OFFICEX_TEAM: a.teamId, OFFICEX_AGENT: a.id, ...accountEnv() }, timeoutMs: 10 * 60_000, cb: { onRateLimit: usageFromTurn } });
    running.set(k, child);
    done
      .then((r) => {
        const after = r.compacted?.post_tokens ?? (r.compacted ? undefined : null);
        if (r.ok || r.compacted) {
          a.compactedAt = Date.now();
          a.context = typeof after === 'number' ? after : Math.min(before, 10_000);
          activity(a.teamId, a.id, 'status', L(`Tidied up its memory (conversation ${Math.round(before / 1000)}k → ${Math.round(a.context / 1000)}k tokens)`, `Merapikan ingatan (percakapan ${Math.round(before / 1000)}k → ${Math.round(a.context / 1000)}k token)`));
          log(`compact ${k} done: ${Math.round(before / 1000)}k -> ${Math.round(a.context / 1000)}k`);
        } else {
          log(`compact ${k} failed: ${r.error}`);
          if (failureKind(r) === 'auth') setClaude('disconnected', 'login');
        }
      })
      .catch((err) => log(`compact ${k} crashed: ${err.message}`))
      .finally(() => {
        running.delete(k);
        a.compacting = false;
        saveAgent(a);
        setStatus(a, 'idle', '');
        snapshot();
        pumpSoon();
      });
  }

  // ---------------------------------------------------------------- turns
  function toolConfig(a) {
    const p = new Set(a.permissions ?? []);
    const advisor = a.role === 'advisor';
    const help = claudeBin?.help ?? '';
    const tools = ['Read', 'Glob', 'Grep'];
    const allowed = ['Glob', 'Grep', 'mcp__officex'];
    // reading inside the own folder never asks; read_company allows reading the rest of the company folder
    if (p.has('read_company') || advisor) allowed.push('Read');
    if (p.has('web')) tools.push('WebSearch', 'WebFetch'), allowed.push('WebSearch', 'WebFetch');
    if (!advisor && (p.has('write_workspace') || p.has('write_projects') || a.role === 'manager' || a.role === 'secretary')) tools.push('Write', 'Edit', 'NotebookEdit');
    if (!advisor && (p.has('run_commands') || p.has('office_files'))) {
      tools.push('Bash');
      if (p.has('run_commands')) allowed.push('Bash');
      else allowed.push('Bash(python *)', 'Bash(python3 *)', 'Bash(py *)', 'Bash(pip install *)', 'Bash(python:*)', 'Bash(py:*)');
    }
    tools.push('Skill');
    const addDirs = [];
    if (!advisor && p.has('write_projects')) addDirs.push(path.join(C, 'projects'));
    const mcp = {
      officex: {
        command: process.execPath,
        args: [path.join(appRoot, 'server', 'engine', 'mcp-server.mjs')],
        env: { OFFICEX_URL: `http://127.0.0.1:${port}` },
      },
    };
    let chrome = false;
    if (!advisor && p.has('browser')) {
      if (a.browserMode === 'my_chrome' && help.includes('--chrome')) chrome = true;
      else {
        const profile = path.join(P.agent(a), '.officex', 'chrome-profile');
        mcp.browser =
          process.platform === 'win32'
            ? { command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@latest', '--user-data-dir', profile] }
            : { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--user-data-dir', profile] };
        allowed.push('mcp__browser');
      }
    }
    if (chrome) allowed.push('mcp__claude-in-chrome');
    return { tools, allowed, addDirs, mcp, chrome, disallowed: advisor ? ['Write', 'Edit', 'NotebookEdit', 'Bash'] : [] };
  }

  // ---------------------------------------------------------------- lasting memory (memory.md)
  // Long conversations get compacted (summarised), so anything that must last lives in memory.md in the agent's folder.
  // OfficeX hands its content to the agent on every turn; the agent keeps it with the remember / forget tools.
  const memoryFile = (a) => path.join(P.agent(a), 'memory.md');
  function memoryText(a) {
    try {
      return fs.readFileSync(memoryFile(a), 'utf8');
    } catch {
      return '';
    }
  }
  const memoryLines = (a) => memoryText(a).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  function memoryPrompt(a) {
    const mem = memoryText(a).trim();
    return [
      '# Lasting memory (OfficeX)',
      'Your conversation history is summarised from time to time to save tokens. Anything that must survive that goes in your memory.md:',
      'routines and procedures the owner taught you, standing preferences and decisions, recurring jobs, where important files live, who to ask for what.',
      'Save it with the `remember` tool as soon as you learn it (one short line each; check below first, do not repeat), and remove outdated lines with `forget`.',
      'Project knowledge stays in the project and company files; memory.md is for what you would otherwise need to be told again.',
      '',
      mem ? `## memory.md (now)\n${clip(mem, 8000)}` : '## memory.md (now)\n(empty)',
    ].join('\n');
  }

  const STYLE = {
    explanatory: 'Explain your reasoning and the why behind results; teach as you go.',
    concise: 'Be concise: short status updates, details only when asked.',
  };

  function buildPrompt(a, room, items) {
    const lines = [];
    const now = new Date();
    const day = now.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', { weekday: 'long' });
    lines.push(L(`OfficeX: new messages for you in ${roomLabel(room, a)}.`, `OfficeX: pesan baru untukmu di ${roomLabel(room, a)}.`));
    lines.push(L(`Now: ${day} ${localStamp(now)} (local time of the owner's PC).`, `Sekarang: ${day} ${localStamp(now)} (waktu lokal PC owner).`), '');
    for (const it of items) {
      const m = findMessage(room.id, it.msgId);
      if (!m) continue;
      lines.push(`[${localStamp(new Date(m.ts))}] ${nameOf(memberKey(room, m.from))}:`);
      lines.push(m.text || '(no text)');
      if (m.attachments?.length) {
        lines.push(L('Attachments (in the company folder):', 'Lampiran (di folder company):'));
        for (const f of m.attachments) lines.push(`- ${f.savedPath ?? f.name}${f.savedPath ? `  (${path.join(C, f.savedPath)})` : L('  (not saved on the server)', '  (tidak tersimpan di server)')}`);
      }
      lines.push('');
    }
    const asker = [...items].reverse().find((i) => i.kind === 'ask' && i.from !== 'system');
    lines.push('---');
    if (a.role === 'manager') {
      const u = S.claude.usage?.windows;
      const f = u?.five_hour, w = u?.seven_day;
      if (f || w) {
        const now = Date.now();
        const pct = (x) => (x.resetsAt && x.resetsAt < now ? 0 : Math.round(x.pct));
        lines.push(L(`Plan usage now: session ${f ? pct(f) : '?'}%, week ${w ? pct(w) : '?'}% (details: plan_usage). Near the limit: pause and wait for the reset, do not downgrade models.`, `Pemakaian paket sekarang: sesi ${f ? pct(f) : '?'}%, minggu ${w ? pct(w) : '?'}% (detail: plan_usage). Kalau hampir habis: jeda dan tunggu reset, jangan turunkan model.`));
      }
    }
    lines.push(
      L(
        `Your final answer is posted in ${roomLabel(room, a)}${asker && asker.from !== 'ceo' ? ` and goes back to ${nameOf(memberKey(room, asker.from))}` : ''}. Use send_message for anyone else. Answer NO_REPLY if nothing needs saying.`,
        `Jawaban akhirmu diposting di ${roomLabel(room, a)}${asker && asker.from !== 'ceo' ? ` dan kembali ke ${nameOf(memberKey(room, asker.from))}` : ''}. Pakai send_message untuk orang lain. Jawab NO_REPLY kalau tidak ada yang perlu disampaikan.`,
      ),
    );
    return lines.join('\n');
  }

  const modelLabel = (m) => ({ 'claude-fable-5-1': 'Fable 5.1', 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' })[m] ?? m;
  function startTurn(a, retry = false) {
    const k = key(a);
    const roomId = a.pending.find((i) => !i.held).roomId;
    const items = a.pending.filter((i) => i.roomId === roomId && !i.held);
    a.pending = a.pending.filter((i) => i.roomId !== roomId || i.held);
    savePending(a);
    const room = roomById(roomId);
    if (!room) return pumpSoon();
    const hop = Math.max(...items.map((i) => i.hop ?? 0));
    const replyTo = [...items].reverse().find((i) => i.kind === 'ask' && i.from !== 'ceo' && i.from !== 'system');

    const token = crypto.randomBytes(18).toString('hex');
    const askerKey = replyTo ? memberKey(room, replyTo.from) : items.some((i) => i.from === 'ceo') ? 'ceo' : null;
    const turn = { token, agentKey: k, roomId, hop, steps: [], projectorId: undefined, started: Date.now(), triggeredByOwner: items.some((i) => i.from === 'ceo'), askerKey, answered: false, postedRooms: new Set() };
    turns.set(token, turn);

    const dir = P.agent(a);
    fs.mkdirSync(path.join(dir, '.officex'), { recursive: true });
    const tc = toolConfig(a);
    tc.mcp.officex.env.OFFICEX_TURN_TOKEN = token;
    const mcpFile = path.join(dir, '.officex', 'mcp.json');
    writeJson(mcpFile, { mcpServers: tc.mcp });

    const help = claudeBin.help;
    // the manager may have picked a model/effort for this task only (send_message model/effort)
    const run = items.reduce((acc, i) => ({ ...acc, ...(i.run ?? {}) }), {});
    const model = MODELS.includes(run.model) ? run.model : a.model || 'claude-sonnet-5-5';
    const effort = EFFORTS.includes(run.effort) ? run.effort : a.effort;
    turn.model = model;
    a.runModel = model !== (a.model || 'claude-sonnet-5-5') ? model : undefined;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model];
    if (help.includes('--effort') && EFFORTS.includes(effort)) args.push('--effort', effort);
    if (model !== (a.model || 'claude-sonnet-5-5') || (effort && effort !== a.effort)) activity(a.teamId, a.id, 'status', L(`This task runs on ${modelLabel(model)}${effort ? `, effort ${effort}` : ''} (set by the manager)`, `Tugas ini memakai ${modelLabel(model)}${effort ? `, effort ${effort}` : ''} (dipilih manajer)`));
    if (a.started) args.push('--resume', a.sessionId);
    else if (a.advisorSession?.sessionId) args.push('--resume', a.advisorSession.sessionId, ...(a.advisorSession.fork !== false ? ['--fork-session'] : []));
    else args.push('--session-id', a.sessionId);
    args.push('--permission-mode', 'acceptEdits');
    if (help.includes('--permission-prompts')) args.push('--permission-prompts', 'none');
    args.push('--tools', tc.tools.join(','));
    args.push('--allowedTools', tc.allowed.join(','));
    if (tc.disallowed.length) args.push('--disallowedTools', tc.disallowed.join(','));
    args.push('--mcp-config', mcpFile);
    for (const d of tc.addDirs) args.push('--add-dir', d);
    if (tc.chrome) args.push('--chrome');
    args.push('--append-system-prompt', [STYLE[a.outputStyle], memoryPrompt(a)].filter(Boolean).join('\n\n'));
    args.push('--max-turns', String(LIM.toolTurns));

    const prompt = buildPrompt(a, room, items);
    a.turnTimes = [...(a.turnTimes ?? []), Date.now()];
    setStatus(a, 'thinking', L('Reading new messages', 'Membaca pesan baru'));
    log(`turn ${k} in ${roomId} (hop ${hop})`);

    const { child, done } = runTurn({
      claude: claudeBin,
      cwd: dir,
      args,
      prompt,
      timeoutMs: LIM.timeoutMs,
      env: { OFFICEX_COMPANY: C, OFFICEX_TEAM: a.teamId, OFFICEX_AGENT: a.id, ...accountEnv() },
      cb: {
        onInit: (sid) => {
          if (!a.started || a.sessionId !== sid) {
            a.sessionId = sid;
            a.started = true;
            saveAgent(a);
          }
        },
        onTool: (d) => {
          turn.steps.push({ tool: d.tool, detail: d.detail });
          if (d.tool === 'Message' || d.tool === 'AskTeam' || d.tool === 'SendToSecretary') setStatus(a, 'messaging', '');
          else setStatus(a, 'tool', `${d.tool}: ${d.detail}`, d.kind);
          if (!['Message', 'AskTeam'].includes(d.tool)) activity(a.teamId, a.id, 'tool', `${d.tool}: ${d.detail}`);
        },
        onText: () => setStatus(a, 'thinking', L('Writing', 'Menulis')),
        onToolResult: () => setStatus(a, 'thinking', L('Reading the result', 'Membaca hasil')),
        onRateLimit: usageFromTurn,
      },
    });
    running.set(k, child);
    const stopTyping = a.role === 'secretary' && room.teamId === OFFICE && room.kind === 'ceo' ? telegramTyping() : () => {};

    done.then(async (r) => {
      stopTyping();
      usageSoon();
      running.delete(k);
      turns.delete(token);
      if (r.usage) {
        const used = (r.usage.input_tokens ?? 0) + (r.usage.output_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
        a.usage = { day: localDate(), tokens: tokensToday(a) + used };
        saveAgent(a);
      }
      emit({ type: 'agent.usage', teamId: a.teamId, agentId: a.id, tokensToday: tokensToday(a), turnsThisHour: turnsThisHour(a) });
      if (r.context) {
        a.context = r.compacted ? Math.min(r.context, a.context ?? r.context) : r.context;
        if (LIM.compactAt > 0 && a.context >= LIM.compactAt) a.needsCompact = true;
        saveAgent(a);
      }

      if (!S.agents.has(k)) return; // deleted meanwhile
      if (r.ok) {
        const text = (r.text || '').trim();
        // already answered with a tool message in this turn: the final text is only a recap, keep it out of the chat
        if (turn.answered || turn.postedRooms.has(roomId)) activity(a.teamId, a.id, 'status', clip(text, 140));
        else if (text && !/^NO_REPLY\b/.test(text)) {
          const extra = { steps: turn.steps.length ? turn.steps : undefined, projectorId: turn.projectorId, hop, kind: 'reply' };
          const toOwnerPhone = a.role === 'secretary' && room.teamId === OFFICE && room.kind === 'ceo';
          const msg = toOwnerPhone ? await secretarySays(a, text, extra) : post(roomId, k, text, extra);
          if (replyTo && replyTo.from) {
            const back = memberKey(room, replyTo.from);
            if (S.agents.has(back)) {
              wake(back, msg, { hop: hop + 1, kind: 'reply', from: k });
              S.agents.get(back).awaiting?.delete(k);
            }
          }
        }
      } else {
        const kind = failureKind(r);
        log(`turn failed ${k}: ${kind}: ${r.error}`);
        if (kind === 'session' && !retry && a.started) {
          // the saved conversation is gone (e.g. ~/.claude cleaned): start a fresh one
          a.sessionId = uuid();
          a.started = false;
          a.advisorSession = undefined;
          saveAgent(a);
          a.pending = [...items, ...a.pending];
          return startTurn(a, true);
        }
        if (kind === 'auth') {
          a.pending = [...items, ...a.pending];
          savePending(a);
          setClaude('disconnected', 'login');
        } else if (kind === 'model') {
          a.pending = [...items, ...a.pending];
          savePending(a);
          post(roomId, 'system', L(`${a.name} cannot use the model "${modelLabel(turn.model)}" with this Claude account: ${r.error}. Pick another model in the agent panel (or, manager, in send_message); the message is kept.`, `${a.name} tidak bisa memakai model "${modelLabel(turn.model)}" dengan akun Claude ini: ${r.error}. Ganti model di panel agent (atau, manajer, di send_message); pesannya disimpan.`));
        } else if (kind === 'limit') {
          a.pending = [...items, ...a.pending];
          savePending(a);
          post(roomId, 'system', L(`${a.name} hit the Claude usage limit. The message is kept and retried in 10 minutes.`, `${a.name} terkena batas pemakaian Claude. Pesannya disimpan dan dicoba lagi 10 menit lagi.`));
          setTimeout(pumpSoon, 10 * 60_000);
        } else {
          post(roomId, 'system', L(`${a.name} could not finish this turn: ${r.error}`, `${a.name} gagal menyelesaikan giliran ini: ${r.error}`), { steps: turn.steps.length ? turn.steps : undefined });
        }
      }
      const waitingFor = [...(a.awaiting ?? [])].map((x) => S.agents.get(x)?.name).filter(Boolean);
      if (waitingFor.length) setStatus(a, 'waiting', L(`Waiting for ${waitingFor.join(', ')}`, `Menunggu ${waitingFor.join(', ')}`));
      else setStatus(a, 'idle', '');
      pumpSoon();
    }).catch((err) => {
      running.delete(k);
      turns.delete(token);
      stopTyping();
      log(`turn ${k} crashed: ${err.stack || err.message}`);
      setStatus(a, 'idle', '');
      pumpSoon();
    });
  }

  function setClaude(state, error = '') {
    S.claude = { ...S.claude, state, error, since: state === 'connected' ? Date.now() : S.claude.since };
    emit({ type: 'claude', claude: S.claude });
    if (state === 'connected') pumpSoon();
  }

  // ---------------------------------------------------------------- telegram + secretary relay
  function loadTelegram() {
    const t = readJson(P.telegram(), {}) ?? {};
    S.telegram = { configured: !!(t.token && t.chat_id), chatId: String(t.chat_id ?? ''), notify: t.notify ?? S.telegram.notify, lastDigest: t.lastDigest };
  }
  // Telegram straight from Node (no Python process per message, so no extra second of start-up)
  const tgApi = async (method, params, timeoutMs = 20_000) => {
    const t = readJson(P.telegram(), {}) ?? {};
    const res = await fetch(`https://api.telegram.org/bot${t.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: t.chat_id, ...params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.json();
  };
  async function sendTelegram(text) {
    if (!S.telegram.configured) return { ok: false, error: 'not configured' };
    try {
      let rest = String(text);
      while (rest) {
        let cut = rest.length <= 4000 ? rest.length : rest.lastIndexOf('\n', 4000);
        if (cut < 2000) cut = Math.min(4000, rest.length);
        const r = await tgApi('sendMessage', { text: rest.slice(0, cut), disable_web_page_preview: true });
        if (!r.ok) return { ok: false, error: r.description ?? 'Telegram error' };
        rest = rest.slice(cut).replace(/^\n+/, '');
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  /** "typing..." in the owner's Telegram while the secretary works on an answer */
  function telegramTyping() {
    if (!S.telegram.configured) return () => {};
    const ping = () => tgApi('sendChatAction', { action: 'typing' }, 8000).catch(() => {});
    ping();
    const iv = setInterval(ping, 4500);
    return () => clearInterval(iv);
  }
  /** Mark a message after the fact (e.g. Telegram delivered) without holding up the chat. */
  function patchMessage(msg, patch) {
    Object.assign(msg, patch);
    emit({ type: 'message.update', roomId: msg.roomId, id: msg.id, patch });
  }

  /** A report for the owner: kept in the reports room, copied to the owner's front-office chat, sent to Telegram when enabled. */
  async function relayToOwner(text, { reason = 'report' } = {}) {
    const sec = secretary();
    if (!sec) return { delivered: 'none' };
    const want = reason === 'input' ? S.telegram.notify.input : reason === 'report' ? S.telegram.notify.report : true;
    const msg = post(`${OFFICE}__ceo__${sec.id}`, key(sec), text);
    if (!(S.telegram.configured && want)) return { delivered: 'app' };
    const r = await sendTelegram(text);
    if (!r.ok) log(`telegram failed: ${r.error}`);
    patchMessage(msg, { telegram: r.ok ? 'sent' : 'failed' });
    if (r.ok) activity(OFFICE, sec.id, 'tool', L('Telegram: sent to the owner', 'Telegram: terkirim ke owner'));
    return { delivered: r.ok ? 'sent' : 'failed' };
  }

  /** The secretary talking to the owner: the app chat and, when Telegram is set up, the owner's phone too. */
  async function secretarySays(sec, text, extra = {}) {
    const msg = post(`${OFFICE}__ceo__${sec.id}`, key(sec), text, extra);
    if (S.telegram.configured && cfg.telegramMirrorSecretary !== false)
      sendTelegram(`${sec.name}: ${text}`).then((r) => {
        if (!r.ok) log(`telegram failed: ${r.error}`);
        patchMessage(msg, { telegram: r.ok ? 'sent' : 'failed' });
      });
    return msg;
  }

  // Long polling: Telegram holds the request open until a message arrives, so owner messages show up at once.
  let tgOffset = 0;
  let tgLoop = false;
  async function telegramLoop() {
    if (tgLoop) return;
    tgLoop = true;
    while (tgLoop) {
      if (!S.telegram.configured || cfg.telegramPolling === false || !secretary()) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      try {
        const t = readJson(P.telegram(), {}) ?? {};
        const body = await tgApi('getUpdates', { offset: tgOffset, timeout: 25, allowed_updates: ['message'], chat_id: undefined }, 35_000);
        if (!body.ok) throw new Error(body.description);
        for (const u of body.result ?? []) {
          tgOffset = Math.max(tgOffset, u.update_id + 1);
          const m = u.message;
          if (!m?.text || String(m.chat?.id) !== String(t.chat_id) || m.text === '/start') continue;
          const sec = secretary();
          if (!sec) break;
          const msg = post(`${OFFICE}__ceo__${sec.id}`, 'ceo', m.text, { via: 'telegram', hop: 0, kind: 'ask' });
          wake(key(sec), msg, { hop: 0, kind: 'ask', from: 'ceo' });
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000)); // offline or Telegram unreachable
      }
    }
  }

  function digestTick() {
    const d = S.telegram.notify?.digest;
    if (!d || !secretary()) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = localDate(now);
    if (hm !== d || S.telegram.lastDigest === today) return;
    S.telegram.lastDigest = today;
    const t = readJson(P.telegram(), {}) ?? {};
    t.lastDigest = today;
    if (fs.existsSync(path.dirname(P.telegram()))) writeJson(P.telegram(), t);
    const since = now.getTime() - 24 * 3600_000;
    const reports = cache(`${OFFICE}__reports`).filter((m) => m.ts > since && m.from !== key(secretary()));
    const activeJobs = S.schedules.filter((s) => s.enabled).length;
    const lines = reports.map((m) => `• ${teamOf(m.from.split('/')[0])?.name ?? m.from}: ${clip(m.text.split('\n')[0].replace(/[*#_`]/g, ''), 140)}`);
    const text = L(
      `Daily digest ${today}\n\n${lines.length ? lines.join('\n') : 'No new reports in the last 24 hours.'}\n\n${activeJobs} schedules active.`,
      `Ringkasan harian ${today}\n\n${lines.length ? lines.join('\n') : 'Tidak ada laporan baru dalam 24 jam terakhir.'}\n\n${activeJobs} jadwal aktif.`,
    );
    relayToOwner(text, { reason: 'digest' });
  }

  // ---------------------------------------------------------------- projector
  function projectorAdd(item) {
    S.projector.push(item);
    if (S.projector.length > 30) S.projector.splice(0, S.projector.length - 30);
    writeJson(path.join(C, OFFICE, 'projector.json'), S.projector);
    emit({ type: 'projector.show', item });
  }
  function parseLiveLine(line, series) {
    try {
      const o = JSON.parse(line);
      if (Array.isArray(o)) return { t: Date.now(), values: o.map(Number) };
      if (Array.isArray(o.values)) return { t: Number(o.t) || Date.now(), values: o.values.map(Number) };
      return { t: Number(o.t) || Date.now(), values: series.map((s) => Number(o[s.name])) };
    } catch {
      const parts = line.split(/[,;\t]/).map(Number);
      return parts.every((n) => !Number.isNaN(n)) ? { t: Date.now(), values: parts } : null;
    }
  }
  function feedTick() {
    for (const [id, f] of feeds) {
      let size;
      try {
        size = fs.statSync(f.abs).size;
      } catch {
        continue;
      }
      if (size < f.offset) f.offset = 0; // file was rewritten
      if (size === f.offset) continue;
      const fd = fs.openSync(f.abs, 'r');
      const len = Math.min(size - f.offset, 1 << 20);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      f.offset = size;
      const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
      for (const l of lines.slice(-240)) {
        const p = parseLiveLine(l.trim(), f.series);
        if (!p) continue;
        const cur = S.live[id] ?? (S.live[id] = { t: [], values: [] });
        cur.t.push(p.t);
        p.values.forEach((v, i) => (cur.values[i] = [...(cur.values[i] ?? []), v].slice(-240)));
        cur.t = cur.t.slice(-240);
        emit({ type: 'projector.data', id, t: p.t, values: p.values });
      }
    }
  }

  // ---------------------------------------------------------------- tools for agents
  const S_STR = (description) => ({ type: 'string', description });
  const TOOL_DEFS = {
    send_message: {
      description:
        'Send a chat message that wakes the receiver. to: "owner" (managers and secretary), "manager", "team" (team room), an agent id from your team, "secretary" (managers), or a team id (secretary only). The receiver answers in the same room and the answer comes back to you. To answer the person who asked you, just give your final answer instead of using this tool.',
      inputSchema: {
        type: 'object',
        properties: {
          to: S_STR('Who gets it'),
          text: S_STR('Markdown text'),
          needs_input: { type: 'boolean', description: 'to="owner" only: the owner must decide or answer; also sent to their phone via the secretary' },
          model: { type: 'string', enum: ['fable', 'opus', 'sonnet', 'haiku'], description: 'Managers only, for a team member: the model for THIS task only (their default stays). Match the task: haiku = fetch/convert/tidy/run a script; sonnet = read and summarise, routine analysis, drafting; opus = reasoning, research ideas, judgement, review; fable = the hardest problems.' },
          effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], description: 'Managers only, for a team member: how deeply they think for THIS task only.' },
        },
        required: ['to', 'text'],
      },
    },
    list_team: { description: 'List your team: ids, names, titles, what each is doing now.', inputSchema: { type: 'object', properties: {} } },
    plan_usage: { description: 'How much of the Claude plan (shared by every agent) is used: current 5-hour session and this week, with reset times. Use it to pace the team: near a limit, finish what is in flight, pause new research and wait for the reset (never switch thinking work to a weaker model).', inputSchema: { type: 'object', properties: {} } },
    show_on_projector: {
      description: 'Show an image file (png, jpg, gif, webp, svg) on the office projector for the owner. Save charts as image files first.',
      inputSchema: { type: 'object', properties: { path: S_STR('File path, relative to the company folder or absolute inside it'), title: S_STR('Short title') }, required: ['path', 'title'] },
    },
    show_live_chart: {
      description:
        'Show a realtime line chart on the projector. Keep a script appending one line per update to a file: JSON array [v1, v2], {"t": epoch_ms, "values": [...]}, or {"<series name>": value}. OfficeX reads new lines every second.',
      inputSchema: {
        type: 'object',
        properties: {
          title: S_STR('Chart title'),
          file: S_STR('Data file (JSONL), relative to the company folder or absolute inside it'),
          series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, axis: { type: 'string', enum: ['left', 'right'] }, color: { type: 'string' } }, required: ['name'] } },
        },
        required: ['title', 'file', 'series'],
      },
    },
    ask_team: {
      description: "Ask another team's manager for input, data or a review. Their answer comes back to you.",
      inputSchema: { type: 'object', properties: { team: S_STR('Team id, e.g. team_news'), question: S_STR('What you need and why') }, required: ['team', 'question'] },
    },
    send_to_secretary: {
      description: "Send a report for the owner via the secretary (front office). It is forwarded to the owner's Telegram when enabled. Also saved under employees/<team>/reports/.",
      inputSchema: { type: 'object', properties: { title: S_STR('Report title'), text: S_STR('Report in Markdown, readable on a phone'), needs_decision: { type: 'boolean' } }, required: ['title', 'text'] },
    },
    schedule_add: {
      description:
        'Add a repeating job for your team. mode "script": runs `command` in the agent folder without Claude (no tokens); the script should print one JSON line {"ok":true,"anomaly":false,"summary":"..."}; the agent is woken only on anomaly or failure. mode "agent": the agent gets `command` as a prompt on schedule.',
      inputSchema: {
        type: 'object',
        properties: {
          title: S_STR('What the job does'),
          cron: S_STR('5-field cron in local time, e.g. "0 7 * * *" every day 07:00'),
          mode: { type: 'string', enum: ['script', 'agent'] },
          command: S_STR('Script command (mode script) or the prompt (mode agent)'),
          agent: S_STR('Agent id that owns the job (default: you)'),
          notify: { type: 'string', enum: ['none', 'secretary'], description: 'secretary: send results (script: only anomalies) to the owner via the secretary' },
        },
        required: ['title', 'cron', 'mode', 'command'],
      },
    },
    schedule_list: { description: "List your team's schedules.", inputSchema: { type: 'object', properties: {} } },
    schedule_remove: { description: 'Remove a schedule.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    schedule_enable: { description: 'Pause or resume a schedule.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] } },
    move_file: {
      description: "Move a file inside the company folder, e.g. an owner upload from inbox/<date>/ into a project's Attachments folder. Folders are created as needed.",
      inputSchema: { type: 'object', properties: { from: S_STR('Source path'), to: S_STR('Destination file or folder (end with /)') }, required: ['from', 'to'] },
    },
    create_project: {
      description:
        'Create a new project folder for your team with the standard layout (numbered process folders, System, Skills, Attachments, Iteration Logs, Journal, CLAUDE.md, MAP.md, COMMANDS.md, slash commands). Use when the owner asks for a new project.',
      inputSchema: {
        type: 'object',
        properties: {
          name: S_STR('Project folder name, e.g. "ETH Funding Signal"'),
          description: S_STR('What the project is about'),
          shipped: S_STR('What "done" means'),
          process: { type: 'array', items: { type: 'string' }, description: 'Process steps, become numbered folders (default Ideas, In Progress, Done)' },
          rules: { type: 'array', items: { type: 'string' }, description: 'Rules the team must follow in this project' },
        },
        required: ['name', 'description'],
      },
    },
    reminder_add: {
      description:
        "Set a reminder for the owner. At that time OfficeX itself posts it in the front office chat and sends it to the owner's Telegram (no agent turn, no tokens). Works while OfficeX is running; a reminder missed while the PC was off is sent as soon as OfficeX starts again.",
      inputSchema: {
        type: 'object',
        properties: {
          text: S_STR('What to remind the owner of, written to the owner, e.g. "Reparasi keyboard"'),
          at: S_STR('Local date and time "YYYY-MM-DD HH:MM", or just "HH:MM" for the next time that clock time comes (today or tomorrow)'),
          repeat: S_STR('Optional 5-field cron in local time for a repeating reminder, e.g. "0 21 * * 1-5". When set, "at" may be omitted.'),
        },
        required: ['text'],
      },
    },
    reminder_list: { description: "List the owner's upcoming reminders.", inputSchema: { type: 'object', properties: {} } },
    reminder_cancel: { description: 'Cancel a reminder by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    remember: {
      description: 'Save one lasting fact to your memory.md: a routine or procedure the owner taught you, a standing preference or decision, where something lives. It is given to you on every turn, also after the conversation is summarised.',
      inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'One short line.' } }, required: ['note'] },
    },
    forget: {
      description: 'Remove lines from your memory.md that contain this text (outdated or wrong).',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    telegram_send: { description: "Send a message to the owner's Telegram now.", inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  };
  function toolsFor(a) {
    return [...toolsForRole(a), 'remember', 'forget'];
  }
  function toolsForRole(a) {
    if (a.role === 'secretary') return ['send_message', 'telegram_send', 'show_on_projector', 'reminder_add', 'reminder_list', 'reminder_cancel'];
    if (a.role === 'advisor') return ['send_message', 'list_team'];
    if (a.role === 'manager') return ['send_message', 'list_team', 'plan_usage', 'show_on_projector', 'show_live_chart', 'ask_team', 'send_to_secretary', 'schedule_add', 'schedule_list', 'schedule_remove', 'schedule_enable', 'move_file', 'create_project'];
    return ['send_message', 'list_team', 'show_on_projector', 'show_live_chart'];
  }

  const companyPath = (p) => {
    const abs = path.isAbsolute(p) ? inside(C, path.relative(C, p)) : inside(C, p);
    if (!abs) throw new Error('path must be inside the company folder');
    return abs;
  };
  const ok = (text) => ({ text });

  async function callTool(turn, name, args) {
    const a = S.agents.get(turn.agentKey);
    if (!a) throw new Error('agent not found');
    if (!toolsFor(a).includes(name)) throw new Error(`${name} is not available for your role`);
    const mgr = managerOf(a.teamId);
    const hop = turn.hop + 1;
    const ensureConsult = (other) => {
      const r = consultRoom(a.teamId, other);
      if (!S.consults.has(r.id)) {
        S.consults.add(r.id);
        writeText(P.chat(r.id), '', { keep: true });
        snapshot();
      }
      return r.id;
    };

    switch (name) {
      case 'send_message': {
        const to = String(args.to ?? '').trim();
        const text = String(args.text ?? '').trim();
        if (!text) throw new Error('text is empty');
        if (to === 'owner') {
          if (a.role === 'secretary') {
            await secretarySays(a, text);
            turn.postedRooms.add(`${OFFICE}__ceo__${a.id}`);
            if (turn.askerKey === 'ceo') turn.answered = true;
            return ok(L('Sent to the owner.', 'Terkirim ke owner.'));
          }
          if (a.role !== 'manager') throw new Error('only the manager talks to the owner; send it to your manager');
          post(`${a.teamId}__ceo__${a.id}`, key(a), text, { steps: turn.steps.length ? [...turn.steps] : undefined });
          turn.postedRooms.add(`${a.teamId}__ceo__${a.id}`);
          if (turn.askerKey === 'ceo') turn.answered = true;
          if (args.needs_input) relayToOwner(`${L('Needs your input', 'Butuh masukanmu')} — ${teamOf(a.teamId)?.name}:\n\n${text}`, { reason: 'input' });
          setStatus(a, 'messaging', '');
          return ok(L('Sent to the owner. They answer in their own time; you will get a new turn when they do.', 'Terkirim ke owner. Owner menjawab kapan sempat; kamu dapat giliran baru saat itu.'));
        }
        if (to === 'secretary' && a.role === 'manager') return callTool(turn, 'send_to_secretary', { title: clip(text.split('\n')[0], 60), text });
        if (a.role === 'secretary') {
          const team = teamOf(to) ?? S.teams.find((t) => t.name.toLowerCase() === to.toLowerCase());
          const m = team && managerOf(team.id);
          if (!m) throw new Error(`unknown team "${to}". Teams: ${S.teams.map((t) => t.id).join(', ')}`);
          const msg = post(`${OFFICE}__reports`, key(a), `@${m.name} ${text}`, { hop, kind: 'ask' });
          wake(key(m), msg, { hop, kind: 'ask', from: key(a) });
          return ok(L(`Sent to ${m.name}, manager of ${team.name}.`, `Terkirim ke ${m.name}, manajer ${team.name}.`));
        }
        if (to === 'team') {
          const msg = post(`${a.teamId}__general`, key(a), text, { hop, kind: 'ask' });
          const mentioned = agentsOf(a.teamId).filter((x) => x.id !== a.id && (a.role === 'manager' ? x.role !== 'advisor' : new RegExp(`@${x.name}\\b|@${x.id}\\b`, 'i').test(text)));
          mentioned.forEach((x) => wake(key(x), msg, { hop, kind: 'ask', from: key(a) }));
          return ok(L(`Posted in the team room${mentioned.length ? `; woke ${mentioned.map((x) => x.name).join(', ')}` : ' (mention @name to wake someone)'}.`, `Diposting di ruang tim${mentioned.length ? `; membangunkan ${mentioned.map((x) => x.name).join(', ')}` : ' (sebut @nama untuk membangunkan seseorang)'}.`));
        }
        if (teamOf(to) && to !== a.teamId && a.role === 'manager') return callTool(turn, 'ask_team', { team: to, question: text });
        const target = to === 'manager' ? mgr : agentsOf(a.teamId).find((x) => x.id === to || x.name.toLowerCase() === to.toLowerCase());
        if (!target || target.id === a.id) throw new Error(`unknown receiver "${to}". Your team: ${agentsOf(a.teamId).map((x) => x.id).join(', ')}`);
        if (!mgr) throw new Error('your team has no manager yet');
        let roomId;
        if (a.id === mgr.id) roomId = `${a.teamId}__dm__${mgr.id}__${target.id}`;
        else if (target.id === mgr.id) roomId = `${a.teamId}__dm__${mgr.id}__${a.id}`;
        else roomId = `${a.teamId}__general`;
        // writing to the one who asked you in this turn is your answer, not a new request
        const kind = turn.askerKey === key(target) ? 'reply' : 'ask';
        const run = {};
        if (a.role === 'manager' && a.autoModel !== false && target.role !== 'advisor') {
          if (MODEL_ALIAS[args.model]) run.model = MODEL_ALIAS[args.model];
          if (EFFORTS.includes(args.effort)) run.effort = args.effort;
        }
        const msg = post(roomId, key(a), roomId.endsWith('__general') ? `@${target.name} ${text}` : text, { hop, kind, steps: turn.steps.length ? [...turn.steps] : undefined, ...(run.model || run.effort ? { run } : {}) });
        turn.postedRooms.add(roomId);
        const woke = wake(key(target), msg, { hop, kind, from: key(a), run: run.model || run.effort ? run : undefined });
        if (kind === 'reply') {
          turn.answered = true;
          target.awaiting?.delete(key(a));
        } else (a.awaiting ??= new Set()).add(key(target));
        if (a.role === 'manager') {
          target.currentTask = clip(text, 120);
          saveAgent(target);
        }
        return ok(
          woke
            ? L(`Sent to ${target.name}. Their answer comes back to you as a new turn; you do not need to wait in this turn.`, `Terkirim ke ${target.name}. Jawabannya datang sebagai giliran baru; tidak perlu menunggu di giliran ini.`)
            : L(`Posted to ${target.name} and kept on hold: the team has exchanged ${LIM.hops} messages without the owner. The owner has been asked; ${target.name} continues as soon as the owner replies in your chat. Do not resend.`, `Terkirim ke ${target.name} dan ditahan dulu: tim sudah bertukar ${LIM.hops} pesan tanpa owner. Owner sudah diberi tahu; ${target.name} lanjut begitu owner membalas di chatmu. Jangan kirim ulang.`),
        );
      }
      case 'list_team': {
        const rows = agentsOf(a.teamId).map((x) => `- ${x.id}: ${x.name}, ${x.roleTitle}${x.role === 'advisor' ? ' (advisor, read-only)' : ''} — ${x.paused ? 'paused' : x.status ?? 'idle'}${x.currentTask ? `; task: ${x.currentTask}` : ''}`);
        const others = S.teams.filter((t) => t.id !== a.teamId).map((t) => `- ${t.id}: ${t.name}${t.paused ? ' (paused)' : ''}`);
        return ok(`${L('Your team', 'Timmu')} (${teamOf(a.teamId)?.name ?? a.teamId}):\n${rows.join('\n')}\n\n${L('Other teams', 'Tim lain')}:\n${others.join('\n') || '-'}`);
      }
      case 'show_on_projector': {
        const abs = companyPath(String(args.path ?? ''));
        if (!fs.existsSync(abs)) throw new Error(`file not found: ${args.path}`);
        if (!IMAGE.test(abs)) throw new Error('only image files (png, jpg, gif, webp, svg); save the chart as an image first');
        const r = rel(C, abs);
        const item = { id: uid('pj'), ts: Date.now(), teamId: a.teamId, agentId: a.id, title: clip(args.title || path.basename(abs), 80), path: r, src: `api/files?path=${encodeURIComponent(r)}`, kind: 'image' };
        projectorAdd(item);
        turn.projectorId = item.id;
        activity(a.teamId, a.id, 'tool', `ShowOnProjector: ${item.title}`);
        return ok(L('On the projector now.', 'Sudah tampil di proyektor.'));
      }
      case 'show_live_chart': {
        const abs = companyPath(String(args.file ?? ''));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (!fs.existsSync(abs)) fs.writeFileSync(abs, '');
        const series = (Array.isArray(args.series) ? args.series : []).slice(0, 6).map((s, i) => ({ name: String(s.name ?? `s${i + 1}`), color: s.color || SERIES_COLORS[i], axis: s.axis === 'right' ? 'right' : 'left' }));
        if (!series.length) throw new Error('series needs at least one entry');
        const r = rel(C, abs);
        const item = { id: uid('pj'), ts: Date.now(), teamId: a.teamId, agentId: a.id, title: clip(args.title, 80), path: r, src: '', kind: 'live', series };
        // backfill what the file already has, then follow new lines
        const size = fs.statSync(abs).size;
        feeds.set(item.id, { abs, offset: Math.max(0, size - 64 * 1024), series, teamId: a.teamId, path: r });
        while (feeds.size > 5) feeds.delete(feeds.keys().next().value);
        projectorAdd(item);
        feedTick();
        turn.projectorId = item.id;
        return ok(L('Live chart is on the projector. Keep appending lines to the file.', 'Chart live tampil di proyektor. Terus tambahkan baris ke file itu.'));
      }
      case 'ask_team': {
        const team = teamOf(String(args.team)) ?? S.teams.find((t) => t.name.toLowerCase() === String(args.team).toLowerCase());
        if (!team || team.id === a.teamId) throw new Error(`unknown team. Teams: ${S.teams.filter((t) => t.id !== a.teamId).map((t) => `${t.id} (${t.name})`).join(', ')}`);
        const m = managerOf(team.id);
        if (!m) throw new Error(`${team.name} has no manager`);
        const roomId = ensureConsult(team.id);
        const msg = post(roomId, key(a), `@${m.name} ${String(args.question ?? '')}`, { hop, kind: 'ask' });
        const woke = !team.paused && wake(key(m), msg, { hop, kind: 'ask', from: key(a) });
        if (team.paused) wake(key(m), msg, { hop, kind: 'ask', from: key(a) }); // answered when resumed
        (a.awaiting ??= new Set()).add(key(m));
        return ok(
          team.paused
            ? L(`${team.name} is paused; ${m.name} answers when the owner resumes the team.`, `${team.name} sedang dijeda; ${m.name} menjawab saat owner melanjutkan tim itu.`)
            : woke
              ? L(`Asked ${m.name} (${team.name}). The answer comes back to you as a new turn.`, `Sudah ditanyakan ke ${m.name} (${team.name}). Jawabannya datang sebagai giliran baru.`)
              : L('Posted and kept on hold until the owner replies (chain limit).', 'Terkirim dan ditahan sampai owner membalas (batas rantai).'),
        );
      }
      case 'send_to_secretary': {
        const title = clip(args.title || 'Report', 80);
        const body = String(args.text ?? '').trim();
        const teamName = teamOf(a.teamId)?.name ?? a.teamId;
        const file = path.join(P.team(a.teamId), 'reports', `${localDate()}-${slugify(title, 'report')}.md`);
        writeText(file, `# ${title}\n\n${teamName}, ${a.name}, ${localStamp()}\n\n${body}\n`);
        const text = `**${L('Report from', 'Laporan dari')} ${teamName}: ${title}**${args.needs_decision ? L(' (needs your decision)', ' (butuh keputusanmu)') : ''}\n\n${body}\n\n\`${rel(C, file)}\``;
        if (!secretary()) {
          post(`${a.teamId}__ceo__${a.id}`, key(a), text);
          return ok(L('There is no secretary yet, so the report went to your chat with the owner.', 'Belum ada sekretaris, jadi laporannya masuk ke chat kamu dengan owner.'));
        }
        post(`${OFFICE}__reports`, key(a), text);
        const r = await relayToOwner(text, { reason: args.needs_decision ? 'input' : 'report' });
        return ok(r.delivered === 'sent' ? L("Delivered to the secretary and the owner's Telegram.", 'Terkirim ke sekretaris dan Telegram owner.') : L('Delivered to the secretary (Telegram not sent).', 'Terkirim ke sekretaris (Telegram tidak terkirim).'));
      }
      case 'schedule_add': {
        try {
          parseCron(args.cron);
        } catch (e) {
          throw new Error(`cron: ${e.message}`);
        }
        const owner = args.agent ? agentsOf(a.teamId).find((x) => x.id === args.agent) : a;
        if (!owner) throw new Error(`unknown agent ${args.agent}`);
        const mode = args.mode === 'agent' ? 'agent' : 'script';
        let id = `sch-${slugify(args.title, 'job')}`;
        for (let i = 2; S.schedules.some((s) => s.id === id); i++) id = `sch-${slugify(args.title, 'job')}-${i}`;
        const s = {
          id,
          teamId: a.teamId,
          agentId: owner.id,
          title: clip(args.title, 80),
          cron: String(args.cron).trim(),
          human: humanCron(args.cron, lang),
          mode,
          command: String(args.command),
          notify: args.notify === 'secretary' ? 'secretary' : 'none',
          enabled: true,
          createdBy: turn.triggeredByOwner ? 'owner' : 'manager',
          runs: 0,
        };
        S.schedules.push(s);
        saveSchedules(a.teamId);
        emit({ type: 'schedule.upsert', schedule: s });
        activity(a.teamId, a.id, 'tool', `Schedule: ${s.title} (${s.human})`);
        return ok(L(`Scheduled ${s.id}: ${s.human} (${s.cron}), mode ${mode}, runs as ${owner.name}.`, `Terjadwal ${s.id}: ${s.human} (${s.cron}), mode ${mode}, dijalankan ${owner.name}.`));
      }
      case 'schedule_list': {
        const list = S.schedules.filter((s) => s.teamId === a.teamId);
        return ok(list.length ? list.map((s) => `- ${s.id}: ${s.title} | ${s.cron} (${s.human}) | ${s.mode} | ${s.enabled ? 'on' : 'paused'} | ${s.lastResult ?? 'not run yet'}`).join('\n') : L('No schedules.', 'Belum ada jadwal.'));
      }
      case 'schedule_remove':
      case 'schedule_enable': {
        const s = S.schedules.find((x) => x.id === args.id && x.teamId === a.teamId);
        if (!s) throw new Error(`no schedule ${args.id} in your team`);
        if (name === 'schedule_remove') {
          S.schedules = S.schedules.filter((x) => x !== s);
          emit({ type: 'schedule.remove', id: s.id });
        } else {
          s.enabled = !!args.enabled;
          emit({ type: 'schedule.upsert', schedule: s });
        }
        saveSchedules(a.teamId);
        return ok('OK');
      }
      case 'move_file': {
        const from = companyPath(String(args.from ?? ''));
        let to = companyPath(String(args.to ?? ''));
        const r = rel(C, to);
        if (/^(chat|office)(\/|$)/.test(r) || (/^employees\//.test(r) && !r.startsWith(`employees/${a.teamId}/`))) throw new Error('that destination is not allowed');
        if (!fs.existsSync(from) || fs.statSync(from).isDirectory()) throw new Error(`file not found: ${args.from}`);
        if (String(args.to).endsWith('/') || String(args.to).endsWith('\\') || (fs.existsSync(to) && fs.statSync(to).isDirectory())) to = path.join(to, path.basename(from));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (fs.existsSync(to)) throw new Error(`already exists: ${rel(C, to)}`);
        try {
          fs.renameSync(from, to);
        } catch {
          fs.copyFileSync(from, to);
          fs.unlinkSync(from);
        }
        return ok(L(`Moved to ${rel(C, to)}`, `Dipindah ke ${rel(C, to)}`));
      }
      case 'create_project': {
        const r = scaffoldProject(C, {
          name: String(args.name ?? ''),
          team: a.teamId,
          description: String(args.description ?? ''),
          shipped: String(args.shipped ?? ''),
          people: teamOf(a.teamId)?.name ?? '',
          process: Array.isArray(args.process) && args.process.length ? args.process.map(String) : ['Ideas', 'In Progress', 'Done'],
          rules: Array.isArray(args.rules) ? args.rules.map(String) : [],
        }, { python: cfg.python });
        loadProjects();
        snapshot();
        activity(a.teamId, a.id, 'status', `project:${path.basename(r.dir)}`);
        return ok(L(`Project created at ${rel(C, r.dir)}. Read its CLAUDE.md and MAP.md before you start.`, `Proyek dibuat di ${rel(C, r.dir)}. Baca CLAUDE.md dan MAP.md-nya sebelum mulai.`));
      }
      case 'reminder_add': {
        const text = clip(args.text, 500);
        if (!text) throw new Error('text is empty');
        let repeat = args.repeat ? String(args.repeat).trim() : null;
        if (repeat) {
          try {
            parseCron(repeat);
          } catch (e) {
            throw new Error(`repeat: ${e.message}`);
          }
        }
        let at = null;
        if (args.at) {
          at = parseWhen(String(args.at));
          if (!at) throw new Error('at must be "YYYY-MM-DD HH:MM" or "HH:MM" (local time)');
          if (at < Date.now() - 60_000) throw new Error(`that time has already passed (now is ${localStamp()})`);
        } else if (!repeat) throw new Error('give "at" or "repeat"');
        const r = { id: uid('rem'), text, at: at ?? nextCron(repeat), repeat, created: Date.now(), by: a.name };
        S.reminders.push(r);
        saveReminders();
        return ok(L(`Reminder ${r.id} set for ${localStamp(new Date(r.at))}${repeat ? `, then ${humanCron(repeat, lang)}` : ''}. It will be posted here and sent to Telegram.`, `Pengingat ${r.id} dipasang untuk ${localStamp(new Date(r.at))}${repeat ? `, lalu ${humanCron(repeat, lang)}` : ''}. Akan muncul di chat ini dan dikirim ke Telegram.`));
      }
      case 'reminder_list': {
        const list = [...S.reminders].sort((x, y) => x.at - y.at);
        return ok(list.length ? list.map((r) => `- ${r.id}: ${localStamp(new Date(r.at))}${r.repeat ? ` (${humanCron(r.repeat, lang)})` : ''} — ${r.text}`).join('\n') : L('No reminders.', 'Belum ada pengingat.'));
      }
      case 'reminder_cancel': {
        const before = S.reminders.length;
        S.reminders = S.reminders.filter((r) => r.id !== args.id);
        if (S.reminders.length === before) throw new Error(`no reminder ${args.id}`);
        saveReminders();
        return ok(L('Cancelled.', 'Dibatalkan.'));
      }
      case 'plan_usage':
        return ok(usageText() ?? L('No usage reading yet (it appears after the first agent turns).', 'Belum ada data pemakaian (muncul setelah giliran agent pertama).'));
      case 'remember': {
        const note = clip(String(args.note ?? '').replace(/\s+/g, ' ').trim(), 400);
        if (!note) throw new Error('note is empty');
        if (memoryLines(a).some((l) => l.replace(/^[-*]\s*/, '').toLowerCase() === note.toLowerCase())) return ok(L('Already in memory.md.', 'Sudah ada di memory.md.'));
        const cur = memoryText(a);
        const head = cur.trim() ? '' : `# ${a.name} — memory\n\n`;
        fs.writeFileSync(memoryFile(a), `${head}${cur && !cur.endsWith('\n') ? '\n' : ''}- ${note}\n`, { flag: 'a' });
        snapshot();
        return ok(L('Saved to memory.md.', 'Disimpan ke memory.md.'));
      }
      case 'forget': {
        const needle = String(args.text ?? '').trim().toLowerCase();
        if (!needle) throw new Error('text is empty');
        const lines = memoryText(a).split(/\r?\n/);
        const keep = lines.filter((l) => l.startsWith('#') || !l.toLowerCase().includes(needle));
        const removed = lines.length - keep.length;
        if (removed) fs.writeFileSync(memoryFile(a), keep.join('\n'));
        snapshot();
        return ok(L(`Removed ${removed} line(s).`, `${removed} baris dihapus.`));
      }
      case 'telegram_send': {
        const r = await sendTelegram(String(args.text ?? ''));
        return r.ok ? ok(L('Sent.', 'Terkirim.')) : { text: `Telegram: ${r.error}`, isError: true };
      }
    }
    throw new Error(`unknown tool ${name}`);
  }

  // ---------------------------------------------------------------- reminders
  /** "2026-10-20 21:00", "2026-10-20T21:00", or "21:00" (next time that clock time comes), local time. */
  function parseWhen(s) {
    let m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})[:.](\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    m = s.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!m) return null;
    const d = new Date();
    d.setHours(+m[1], +m[2], 0, 0);
    if (d.getTime() < Date.now() - 30_000) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  /** Next time a cron expression fires, searching minute by minute up to 366 days ahead. */
  function nextCron(expr, from = Date.now()) {
    const c = parseCron(expr);
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 527_040; i++, d.setMinutes(d.getMinutes() + 1)) if (cronMatches(c, d)) return d.getTime();
    return null;
  }
  function saveReminders() {
    writeJson(P.reminders(), S.reminders);
    snapshot();
  }
  function reminderTick() {
    const now = Date.now();
    const sec = secretary();
    if (!sec) return;
    let changed = false;
    for (const r of [...S.reminders]) {
      if (r.at > now) continue;
      const late = now - r.at > 10 * 60_000 ? L(` (late: due ${localStamp(new Date(r.at))})`, ` (terlambat: seharusnya ${localStamp(new Date(r.at))})`) : '';
      secretarySays(sec, `⏰ ${L('Reminder', 'Pengingat')}: ${r.text}${late}`);
      activity(OFFICE, sec.id, 'tool', `${L('Reminder', 'Pengingat')}: ${r.text}`);
      if (r.repeat) r.at = nextCron(r.repeat, now) ?? Infinity;
      else S.reminders = S.reminders.filter((x) => x !== r);
      changed = true;
    }
    if (changed) saveReminders();
  }

  // ---------------------------------------------------------------- schedules
  function saveSchedules(teamId) {
    const list = S.schedules.filter((s) => s.teamId === teamId).map(({ _key, ...s }) => s);
    if (fs.existsSync(P.team(teamId))) writeJson(P.schedules(teamId), list);
  }
  function scheduleTick() {
    const now = new Date();
    const minuteKey = `${localDate(now)} ${now.getHours()}:${now.getMinutes()}`;
    for (const s of S.schedules) {
      if (!s.enabled || s._key === minuteKey) continue;
      let c;
      try {
        c = parseCron(s.cron);
      } catch {
        continue;
      }
      if (!cronMatches(c, now)) continue;
      s._key = minuteKey;
      const team = teamOf(s.teamId);
      const a = S.agents.get(`${s.teamId}/${s.agentId}`);
      if (!team || team.paused || !a || a.paused) continue;
      if (s.mode === 'agent') runAgentJob(s, a);
      else runScriptJob(s, a);
    }
    digestTick();
    reminderTick();
  }
  function finishRun(s, result) {
    s.lastRun = Date.now();
    s.lastResult = clip(result, 140);
    s.runs = (s.runs ?? 0) + 1;
    saveSchedules(s.teamId);
    emit({ type: 'schedule.run', id: s.id, ts: s.lastRun, result: s.lastResult });
  }
  function runAgentJob(s, a) {
    const note = s.notify === 'secretary' ? (a.role === 'manager' ? L('\n\nWhen done, send the result with send_to_secretary.', '\n\nSetelah selesai, kirim hasilnya dengan send_to_secretary.') : L('\n\nWhen done, report to your manager.', '\n\nSetelah selesai, laporkan ke manajermu.')) : '';
    const msg = post(`${s.teamId}__general`, 'system', `⏰ ${L('Scheduled job', 'Jadwal')}: **${s.title}** → ${a.name}\n\n${s.command}${note}`, { hop: 0, kind: 'ask' });
    wake(`${s.teamId}/${a.id}`, msg, { hop: 0, kind: 'ask', from: 'system' });
    finishRun(s, L('Started', 'Dimulai'));
  }
  function runScriptJob(s, a) {
    const dir = P.agent(a);
    const child = spawn(s.command, { cwd: dir, shell: true, windowsHide: true, env: childEnv({ OFFICEX_COMPANY: C, OFFICEX_TEAM: s.teamId, OFFICEX_AGENT: a.id, PYTHONIOENCODING: 'utf-8' }) });
    let out = '';
    child.stdout.on('data', (d) => (out = (out + d).slice(-20_000)));
    child.stderr.on('data', (d) => (out = (out + d).slice(-20_000)));
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    activity(s.teamId, a.id, 'tool', `${L('Schedule', 'Jadwal')}: ${s.title}`);
    child.on('close', (code) => {
      clearTimeout(timer);
      let res = null;
      for (const line of out.trim().split('\n').reverse()) {
        try {
          res = JSON.parse(line.trim());
          break;
        } catch {
          /* keep looking */
        }
      }
      const failed = code !== 0 || res?.ok === false;
      const anomaly = !!res?.anomaly;
      const summary = res?.summary ?? (failed ? `exit ${code}: ${clip(out.trim().split('\n').pop(), 120)}` : L('OK', 'OK'));
      finishRun(s, failed ? `${L('Failed', 'Gagal')}: ${summary}` : anomaly ? `${L('Anomaly', 'Anomali')}: ${summary}` : summary);
      if (failed || anomaly) {
        const msg = post(
          `${s.teamId}__general`,
          'system',
          `⏰ ${L('Scheduled script', 'Script terjadwal')} **${s.title}** ${failed ? L('failed', 'gagal') : L('reported something', 'melaporkan sesuatu')}: ${summary}\n\n\`${s.command}\`\n\n${L('Output (end)', 'Output (akhir)')}:\n\`\`\`\n${clip(out.trim(), 1500)}\n\`\`\``,
          { hop: 0, kind: 'ask' },
        );
        wake(`${s.teamId}/${a.id}`, msg, { hop: 0, kind: 'ask', from: 'system' });
        if (s.notify === 'secretary') relayToOwner(`⏰ ${teamOf(s.teamId)?.name}: ${s.title}\n${summary}`, { reason: 'report' });
      }
    });
  }

  // ---------------------------------------------------------------- loading
  function load() {
    fs.mkdirSync(path.join(C, 'employees'), { recursive: true });
    fs.mkdirSync(path.join(C, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(C, 'chat'), { recursive: true });
    fs.mkdirSync(path.join(C, OFFICE), { recursive: true });
    fs.mkdirSync(path.join(C, 'goals'), { recursive: true });
    const meta = readJson(path.join(C, 'company.json'), null);
    const folder = path.basename(C);
    const name = meta?.name ?? folder.replace(/^COMPANY_/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase());
    S.company = { id: folder, name, rootPath: C };
    if (!meta) writeJson(path.join(C, 'company.json'), { name, created: localDate() });
    writeText(path.join(C, 'CLAUDE.md'), companyClaudeMd({ name, root: C, language: lang }), { keep: true });

    S.teams = [];
    S.agents.clear();
    S.schedules = [];
    const loadAgent = (dir, teamId) => {
      const j = readJson(path.join(dir, 'agent.json'));
      if (!j?.id) return;
      const a = { ...j, teamId, status: 'idle', activity: '', pending: readJson(path.join(dir, '.officex', 'pending.json'), []) ?? [], awaiting: new Set(), turnTimes: [] };
      if (!a.sessionId || !UUID_RE.test(a.sessionId)) a.sessionId = uuid();
      S.agents.set(key(a), a);
    };
    for (const d of fs.readdirSync(path.join(C, 'employees'), { withFileTypes: true })) {
      if (!d.isDirectory() || /^[._]/.test(d.name)) continue;
      const tdir = path.join(C, 'employees', d.name);
      const t = readJson(path.join(tdir, 'team.json'));
      if (!t) continue;
      S.teams.push({ id: d.name, name: t.name ?? d.name, mission: t.mission ?? '', color: t.color ?? '#9CC9F0', paused: !!t.paused, meeting: false, lastActive: t.lastActive ?? new Date().toISOString(), created: t.created ?? '' });
      for (const ad of fs.readdirSync(tdir, { withFileTypes: true })) if (ad.isDirectory() && !/^[._]/.test(ad.name)) loadAgent(path.join(tdir, ad.name), d.name);
      for (const s of readJson(P.schedules(d.name), []) ?? []) S.schedules.push({ ...s, teamId: d.name });
    }
    S.teams.sort((x, y) => (x.created ?? '').localeCompare(y.created ?? ''));
    for (const d of fs.readdirSync(path.join(C, OFFICE), { withFileTypes: true })) if (d.isDirectory() && !/^[._]/.test(d.name)) loadAgent(path.join(C, OFFICE, d.name), OFFICE);
    loadProjects();
    S.consults = new Set(
      fs
        .readdirSync(path.join(C, 'chat'))
        .filter((f) => /^xteam__[a-z0-9_-]+__[a-z0-9_-]+\.jsonl$/.test(f))
        .map((f) => f.slice(0, -6)),
    );
    S.projector = readJson(path.join(C, OFFICE, 'projector.json'), []) ?? [];
    for (const it of S.projector) if (it.kind === 'live' && it.path) feeds.set(it.id, { abs: path.join(C, it.path), offset: 0, series: it.series ?? [], teamId: it.teamId, path: it.path });
    while (feeds.size > 5) feeds.delete(feeds.keys().next().value);
    loadTelegram();
    S.reminders = (readJson(P.reminders(), []) ?? []).filter((r) => r && r.id && r.text && Number.isFinite(r.at));
    const eng = readJson(P.engine(), {}) ?? {};
    S.ownerDisconnected = !!eng.disconnected;
  }
  function loadProjects() {
    const out = [];
    const dir = path.join(C, 'projects');
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || /^[._]/.test(d.name)) continue;
      const pj = readJson(path.join(dir, d.name, 'project.json'));
      if (!pj) continue;
      const process_ = (pj.folders?.process ?? []).map((p) => String(p).replace(/^\d+\s+/, ''));
      let decisions = 0;
      let findings = 0;
      try {
        const j = path.join(dir, d.name, pj.folders?.journal ?? '');
        decisions = (fs.readFileSync(path.join(j, 'DECISIONS.md'), 'utf8').match(/^### /gm) ?? []).length;
        findings = (fs.readFileSync(path.join(j, 'RESEARCH.md'), 'utf8').match(/^### /gm) ?? []).length;
      } catch {
        /* journal not there yet */
      }
      out.push({
        id: pj.slug ?? slugify(d.name),
        name: d.name,
        teamId: pj.team ?? '',
        description: pj.description ?? '',
        shipped: pj.shipped ?? '',
        people: pj.people ?? '',
        process: process_.length ? process_ : ['Ideas', 'In Progress', 'Done'],
        rules: pj.rules ?? [],
        phase: pj.phase ?? 'bootstrap',
        created: pj.created ?? '',
        lastSession: pj.lastSession,
        decisions,
        findings,
        collaborators: pj.collaborators ?? [],
      });
    }
    S.projects = out.sort((x, y) => x.created.localeCompare(y.created));
    for (const p of S.projects)
      for (const c of p.collaborators) {
        const other = c.kind === 'team' ? c.id : c.id.split('/')[0];
        if (other !== p.teamId && teamOf(other) && teamOf(p.teamId)) S.consults.add(consultRoom(p.teamId, other).id);
      }
  }
  function writeTeamClaude(teamId) {
    const t = teamOf(teamId);
    if (!t) return;
    writeText(path.join(P.team(teamId), 'CLAUDE.md'), teamClaudeMd({ team: t, agents: agentsOf(teamId).map((a) => ({ ...a, status: a.paused ? 'paused' : 'idle' })) }));
  }
  function saveTeam(t) {
    writeJson(path.join(P.team(t.id), 'team.json'), { name: t.name, mission: t.mission, color: t.color, paused: t.paused, created: t.created ?? new Date().toISOString(), lastActive: t.lastActive });
  }

  // ---------------------------------------------------------------- state for the GUI
  function structural() {
    return {
      company: S.company,
      teams: S.teams,
      agents: [...S.agents.values()].map(view),
      projects: S.projects,
      schedules: S.schedules.map(({ _key, ...s }) => s),
      consults: [...S.consults].map((id) => consultRoom(...id.slice(7).split('__'))),
      claude: S.claude,
      reminders: [...S.reminders].sort((x, y) => x.at - y.at),
    };
  }
  function fullState() {
    const messages = [];
    for (const r of rooms()) for (const m of cache(r.id)) {
      const { hop, kind, wake, ...pub } = m;
      messages.push(pub);
    }
    messages.sort((x, y) => x.ts - y.ts);
    return { engine: 'live', language: lang, ...structural(), messages, projector: S.projector, live: S.live, activity: S.activity };
  }

  // ---------------------------------------------------------------- owner actions (HTTP)
  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 2_000_000) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          resolve(null);
        }
      });
    });
  }
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

  function ownerMessage(body) {
    const room = roomById(body.roomId);
    if (!room) throw new Error('unknown room');
    const text = String(body.text ?? '').slice(0, 50_000);
    const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 20).map((f) => ({ id: String(f.id), name: String(f.name), size: Number(f.size) || 0, mime: String(f.mime || ''), url: String(f.url || ''), savedPath: f.savedPath ? String(f.savedPath) : undefined }));
    if (!text.trim() && !attachments.length) throw new Error('empty message');
    const msg = post(room.id, 'ceo', text, { attachments: attachments.length ? attachments : undefined, hop: 0, kind: 'ask' });
    let targets = [];
    if (room.kind === 'ceo') targets = room.teamId === OFFICE ? [secretary()] : [managerOf(room.teamId)];
    else if (room.kind === 'team') targets = [managerOf(room.teamId), ...agentsOf(room.teamId).filter((x) => new RegExp(`@${x.name}\\b`, 'i').test(text))];
    else targets = room.members.filter((m) => m !== 'ceo').map((m) => S.agents.get(memberKey(room, m)));
    for (const t of new Set(targets.filter(Boolean))) wake(key(t), msg, { hop: 0, kind: 'ask', from: 'ceo' });
    if (room.teamId !== OFFICE) releaseHeld(room.teamId);
    return msg;
  }

  function hire(body) {
    const a = body?.agent ?? body;
    const teamId = String(a.teamId ?? '');
    if (teamId !== OFFICE && !teamOf(teamId)) throw new Error('unknown team');
    if (!safeId(a.id)) throw new Error('bad agent id');
    if (S.agents.has(`${teamId}/${a.id}`)) throw new Error('agent id already used in this team');
    const role = String(a.role ?? 'custom');
    if (teamId === OFFICE && role !== 'secretary') throw new Error('the front office only has a secretary');
    if (role === 'manager' && managerOf(teamId)) throw new Error('this team already has a manager');
    const advisor = role === 'advisor';
    const agent = {
      id: a.id,
      teamId,
      name: clip(a.name, 40) || a.id,
      role,
      roleTitle: clip(a.roleTitle, 60) || role,
      model: MODELS.includes(a.model) ? a.model : 'claude-sonnet-5-5',
      effort: EFFORTS.includes(a.effort) ? a.effort : 'medium',
      outputStyle: ['default', 'explanatory', 'concise'].includes(a.outputStyle) ? a.outputStyle : 'default',
      color: /^#[0-9a-f]{6}$/i.test(a.color ?? '') ? a.color : '#F2B544',
      sessionId: !advisor && UUID_RE.test(a.sessionId ?? '') ? a.sessionId : uuid(),
      started: false,
      permissions: (Array.isArray(a.permissions) ? a.permissions : []).filter((p) => (advisor ? ['web', 'read_company'] : ['web', 'browser', 'office_files', 'read_company', 'write_workspace', 'write_projects', 'run_commands']).includes(p)),
      browserMode: a.browserMode === 'my_chrome' ? 'my_chrome' : 'separate',
      reportsTo: role === 'manager' || teamId === OFFICE ? undefined : managerOf(teamId)?.id,
      advisorSession: advisor && UUID_RE.test(a.advisorSession?.sessionId ?? '') ? { sessionId: a.advisorSession.sessionId, fork: a.advisorSession.fork !== false } : undefined,
      currentTask: a.currentTask ? clip(a.currentTask, 400) : undefined,
      hiredAt: Date.now(),
      status: 'idle',
      activity: '',
      pending: [],
      awaiting: new Set(),
      turnTimes: [],
    };
    if (advisor && !agent.advisorSession) throw new Error('advisor needs an existing Claude Code session id');
    const dir = P.agent(agent);
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
    S.agents.set(key(agent), agent);
    saveAgent(agent);
    writeText(path.join(dir, 'CLAUDE.md'), agentClaudeMd({ agent, team: teamOf(teamId), company: S.company, brief: a.currentTask }), { keep: true });
    // skills the agent can use (Claude Code reads .claude/skills/<name>/SKILL.md in the working directory)
    const skills = [];
    if (agent.permissions.includes('office_files')) skills.push('office-files');
    for (const s of skills) {
      const src = path.join(appRoot, 'templates', 'skills', `${s}.md`);
      if (fs.existsSync(src)) writeText(path.join(dir, '.claude', 'skills', s, 'SKILL.md'), fs.readFileSync(src, 'utf8'), { keep: true });
    }
    if (teamId !== OFFICE) writeTeamClaude(teamId);
    activity(teamId, agent.id, 'hire', agent.roleTitle);
    snapshot();
    return view(agent);
  }

  function patchAgent(body) {
    const a = S.agents.get(`${body.teamId}/${body.id}`);
    if (!a) throw new Error('unknown agent');
    const p = body.patch ?? {};
    for (const f of PATCHABLE) if (p[f] !== undefined) a[f] = p[f];
    if (a.role === 'advisor') a.permissions = (a.permissions ?? []).filter((x) => ['web', 'read_company'].includes(x));
    if (p.status === 'paused') a.paused = true;
    if (p.status === 'idle' && a.paused) {
      a.paused = false;
      a.status = 'idle';
    }
    saveAgent(a);
    if (a.teamId !== OFFICE) writeTeamClaude(a.teamId);
    emit({ type: 'agent.status', teamId: a.teamId, agentId: a.id, status: a.paused ? 'paused' : a.status, activity: a.paused ? '' : a.activity ?? '' });
    snapshot();
    pumpSoon();
  }

  function createTeam(body) {
    const name = clip(body.name, 60);
    if (!name) throw new Error('name is required');
    let id = safeId(body.id) && /^team_/.test(body.id) ? body.id : `team_${slugify(name, 'new').replace(/-/g, '_')}`;
    for (let i = 2; teamOf(id) || fs.existsSync(P.team(id)); i++) id = `${id.replace(/_\d+$/, '')}_${i}`;
    const t = { id, name, mission: clip(body.mission, 400), color: /^#[0-9a-f]{6}$/i.test(body.color ?? '') ? body.color : '#9CC9F0', paused: false, meeting: false, lastActive: new Date().toISOString(), created: new Date().toISOString() };
    fs.mkdirSync(path.join(P.team(id), 'reports'), { recursive: true });
    S.teams.push(t);
    saveTeam(t);
    writeJson(P.schedules(id), []);
    writeTeamClaude(id);
    snapshot();
    return t;
  }

  function removeTeam(id) {
    for (const a of agentsOf(id)) {
      running.get(key(a))?.kill();
      S.agents.delete(key(a));
    }
    S.teams = S.teams.filter((t) => t.id !== id);
    S.schedules = S.schedules.filter((s) => s.teamId !== id);
    for (const c of [...S.consults]) if (c.split('__').slice(1).includes(id)) S.consults.delete(c);
    snapshot();
  }

  async function handle(req, res, route, url) {
    if (!route.startsWith('/api/')) return false;
    const m = req.method;
    try {
      // ---- agent tools (loopback, per-turn token) ----
      if (route.startsWith('/api/internal/')) {
        if (!isLoopback(req)) return json(res, 403, { error: 'forbidden' }), true;
        const turn = turns.get(String(req.headers['x-officex-turn'] ?? ''));
        if (!turn) return json(res, 401, { error: 'this turn has ended' }), true;
        const a = S.agents.get(turn.agentKey);
        if (route === '/api/internal/tools/list') return json(res, 200, { tools: toolsFor(a).map((n) => ({ name: n, ...TOOL_DEFS[n] })) }), true;
        if (route === '/api/internal/tools/call') {
          const b = await readBody(req);
          try {
            const r = await callTool(turn, b?.name, b?.arguments ?? {});
            return json(res, 200, r), true;
          } catch (err) {
            return json(res, 200, { text: err.message, isError: true }), true;
          }
        }
        return json(res, 404, { error: 'not found' }), true;
      }
      if (!enabled) return false;

      if (route === '/api/state' && m === 'GET') return json(res, 200, fullState()), true;
      if (route === '/api/events' && m === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(`retry: 3000\n\ndata: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return true;
      }
      const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
      if (body === null) return json(res, 400, { error: 'bad JSON' }), true;

      if (route === '/api/messages' && m === 'POST') return json(res, 201, ownerMessage(body)), true;
      if (route === '/api/teams' && m === 'POST') return json(res, 201, createTeam(body)), true;
      if (route === '/api/teams' && m === 'PATCH') {
        const t = teamOf(body.id);
        if (!t) throw new Error('unknown team');
        if (typeof body.paused === 'boolean') t.paused = body.paused;
        if (body.name) t.name = clip(body.name, 60);
        if (body.mission !== undefined) t.mission = clip(body.mission, 400);
        saveTeam(t);
        writeTeamClaude(t.id);
        snapshot();
        pumpSoon();
        return json(res, 200, t), true;
      }
      if (route === '/api/pause-all' && m === 'POST') {
        for (const t of S.teams) {
          t.paused = !!body.paused;
          saveTeam(t);
        }
        snapshot();
        pumpSoon();
        return json(res, 200, { ok: true }), true;
      }
      if (route === '/api/agents' && m === 'POST') return json(res, 201, hire(body)), true;
      if (route === '/api/agents' && m === 'PATCH') return patchAgent(body), json(res, 200, { ok: true }), true;
      if (route === '/api/agents/compact' && m === 'POST') {
        const a = S.agents.get(`${body.teamId}/${body.id}`);
        if (!a) throw new Error('unknown agent');
        if (!a.started) throw new Error(L('This agent has no conversation yet.', 'Agent ini belum punya percakapan.'));
        a.needsCompact = true;
        pumpSoon();
        return json(res, 200, { ok: true }), true;
      }
      if (route === '/api/projects' && m === 'PATCH') {
        const p = S.projects.find((x) => x.id === body.id);
        if (!p) throw new Error('unknown project');
        const file = path.join(C, 'projects', p.name, 'project.json');
        const pj = readJson(file, {});
        pj.collaborators = (Array.isArray(body.collaborators) ? body.collaborators : []).map((c) => ({ kind: c.kind === 'agent' ? 'agent' : 'team', id: String(c.id), access: 'advisor', invitedAt: Number(c.invitedAt) || Date.now() }));
        writeJson(file, pj);
        p.collaborators = pj.collaborators;
        for (const c of p.collaborators) {
          const other = c.kind === 'team' ? c.id : c.id.split('/')[0];
          if (other !== p.teamId && teamOf(other)) {
            const r = consultRoom(p.teamId, other);
            if (!S.consults.has(r.id)) {
              S.consults.add(r.id);
              writeText(P.chat(r.id), '', { keep: true });
            }
          }
        }
        snapshot();
        return json(res, 200, p), true;
      }
      if (route === '/api/consults' && m === 'POST') {
        if (!teamOf(body.a) || !teamOf(body.b) || body.a === body.b) throw new Error('two different teams needed');
        const r = consultRoom(body.a, body.b);
        S.consults.add(r.id);
        writeText(P.chat(r.id), '', { keep: true });
        snapshot();
        return json(res, 200, r), true;
      }
      if (route === '/api/schedules' && m === 'PATCH') {
        const s = S.schedules.find((x) => x.id === body.id);
        if (!s) throw new Error('unknown schedule');
        s.enabled = !!body.enabled;
        saveSchedules(s.teamId);
        emit({ type: 'schedule.upsert', schedule: s });
        return json(res, 200, s), true;
      }
      if (route === '/api/schedules' && m === 'DELETE') {
        const s = S.schedules.find((x) => x.id === url.searchParams.get('id'));
        if (!s) throw new Error('unknown schedule');
        S.schedules = S.schedules.filter((x) => x !== s);
        saveSchedules(s.teamId);
        emit({ type: 'schedule.remove', id: s.id });
        return json(res, 200, { ok: true }), true;
      }
      if (route === '/api/reminders' && m === 'DELETE') {
        S.reminders = S.reminders.filter((r) => r.id !== url.searchParams.get('id'));
        saveReminders();
        return json(res, 200, { ok: true }), true;
      }
      if (route === '/api/claude/login' && m === 'POST') {
        if (body.action === 'start') return json(res, 200, await loginStart(body.label)), true;
        if (body.action === 'code') return json(res, 200, await loginCode(body.code)), true;
        if (body.action === 'computer') {
          // explicit opt-in: agents use the Claude Code login of the computer OfficeX runs on
          login?.child.kill();
          login = null;
          writeJson(P.account(), { mode: 'computer', created: Date.now() });
          log('Claude account: this computer\'s Claude Code login (chosen in the GUI).');
          await accountChanged(true);
          return json(res, 200, S.claude.account), true;
        }
        if (body.action === 'cancel') {
          login?.child.kill();
          login = null;
          return json(res, 200, { ok: true }), true;
        }
        if (body.action === 'logout') {
          try {
            fs.unlinkSync(P.account());
          } catch {
            /* already gone */
          }
          log('Claude account: signed out. Agents wait until an account is chosen.');
          await accountChanged();
          return json(res, 200, S.claude.account), true;
        }
      }
      if (route === '/api/usage' && m === 'POST') {
        await refreshUsage(true);
        if (S.claude.usage?.error) await probeUsage();
        return json(res, 200, S.claude.usage ?? {}), true;
      }
      if (route === '/api/claude' && m === 'POST') {
        if (body.action === 'disconnect') {
          S.ownerDisconnected = true;
          writeJson(P.engine(), { disconnected: true });
          for (const c of running.values()) c.kill();
          setClaude('disconnected', 'stopped');
        } else {
          S.ownerDisconnected = false;
          writeJson(P.engine(), { disconnected: false });
          await connect();
        }
        return json(res, 200, S.claude), true;
      }
    } catch (err) {
      return json(res, 400, { error: err.message }), true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Claude account
  // Nothing is used until the owner chooses (a public install must never borrow whoever is logged in on the computer):
  //   office/claude-account.json  {mode:'officex', token, label, created}  signed in from the GUI → CLAUDE_CODE_OAUTH_TOKEN
  //                               {mode:'computer', created}               this computer's own Claude Code login
  //   no file                     no account: agents wait, the GUI asks to sign in
  function account() {
    const a = readJson(P.account(), null);
    if (a?.token) return { mode: 'officex', ...a };
    if (a?.mode === 'computer') return a;
    return null;
  }
  const accountEnv = () => {
    const a = account();
    // the token must win over any API key or token set on the computer
    return a?.mode === 'officex' ? { CLAUDE_CODE_OAUTH_TOKEN: a.token, ANTHROPIC_API_KEY: null, ANTHROPIC_AUTH_TOKEN: null } : {};
  };
  function accountView() {
    const a = account();
    if (!a) return { mode: 'none' };
    return a.mode === 'officex' ? { mode: 'officex', label: a.label, since: a.created } : { mode: 'computer', since: a.created };
  }
  /** After the account changed: agents waiting for an account start working, or stop taking turns. */
  async function accountChanged(chosen = false) {
    S.claude.account = accountView();
    S.claude.usage = undefined; // another account, other limits
    usageRetryAt = 0;
    if (chosen && S.ownerDisconnected) {
      // choosing an account means "use it": undo an earlier Disconnect
      S.ownerDisconnected = false;
      writeJson(P.engine(), { disconnected: false });
    }
    if (S.ownerDisconnected) setClaude('disconnected', 'stopped');
    else if (S.claude.account.mode === 'none') setClaude('disconnected', 'account');
    else await connect();
    snapshot();
  }
  let login = null; // { child, url, label, waiters }
  function loginHelper(retried = false) {
    return new Promise((resolve) => {
      // BROWSER: claude setup-token must not open a tab on the server; the owner opens the link on their own device
      const child = execFile(cfg.python, [path.join(appRoot, 'scripts', 'claude_login.py'), claudeBin?.bin ?? 'claude'], { windowsHide: true, timeout: 20 * 60_000, env: childEnv({ BROWSER: 'officex-no-browser', OFFICEX_LOGIN_LOG: path.join(appRoot, 'logs', 'claude-login.log') }) });
      const st = { child, url: null, label: '', waiters: [] };
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.event === 'url') {
            st.url = ev.url;
            resolve({ ok: true, st });
            continue;
          }
          if (ev.event === 'token') {
            // pasted code, or the sign-in finished in a browser on this computer without a code
            writeJson(P.account(), { token: ev.token, label: st.label || L('Claude account', 'Akun Claude'), created: Date.now() });
            log(`Claude account: signed in as "${st.label || 'Claude account'}" from the GUI.`);
            if (login === st) login = null;
            accountChanged(true).finally(() => st.waiters.splice(0).forEach((w) => w(ev)));
            continue;
          }
          st.waiters.splice(0).forEach((w) => w(ev));
          if (ev.event === 'error' && !st.url) {
            if (!retried && /pywinpty/.test(ev.message)) {
              // first use on Windows: install the pseudo-terminal package once, then try again
              log('Installing pywinpty for GUI sign-in...');
              execFile(cfg.python, ['-m', 'pip', 'install', '--user', 'pywinpty'], { windowsHide: true, timeout: 5 * 60_000 }, (err) => {
                if (err) resolve({ ok: false, error: `pip install pywinpty failed: ${err.message}` });
                else loginHelper(true).then(resolve);
              });
            } else resolve({ ok: false, error: ev.message });
          }
        }
      });
      child.on('close', () => {
        st.waiters.splice(0).forEach((w) => w({ event: 'error', message: 'sign-in closed' }));
        if (!st.url) resolve({ ok: false, error: 'sign-in closed before it showed a link' });
        if (login === st) login = null;
      });
      child.on('error', (err) => resolve({ ok: false, error: `${cfg.python}: ${err.message}` }));
    });
  }
  async function loginStart(label) {
    if (!claudeBin?.ok) claudeBin = await resolveClaude(cfg.claudePath);
    if (!claudeBin?.ok) throw new Error('Claude Code is not installed on this computer');
    login?.child.kill();
    login = null;
    const r = await loginHelper();
    if (!r.ok) throw new Error(r.error);
    login = r.st;
    login.label = clip(String(label ?? '').trim(), 60);
    return { url: login.url };
  }
  function loginCode(code) {
    if (!login) {
      // the sign-in may already have finished on its own (browser on this computer)
      if (account()?.mode === 'officex') return Promise.resolve(accountView());
      throw new Error('start the sign-in first');
    }
    const st = login;
    return new Promise((resolve, reject) => {
      st.waiters.push((ev) => (ev.event === 'token' ? resolve(accountView()) : reject(new Error(ev.message || 'sign-in failed'))));
      st.child.stdin.write(String(code).trim() + '\n');
    });
  }

  // ---------------------------------------------------------------- plan usage (like Settings > Usage on claude.ai)
  // Read from Claude's usage endpoint with the account's own token, and from the rate-limit events agent turns report.
  // Windows: five_hour (current session), seven_day (week), seven_day_opus / seven_day_sonnet (per-model weekly).
  // The computer's own login is only read, never refreshed: refreshing would rotate Claude Code's tokens.
  function credentialsToken() {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const c = readJson(path.join(dir, '.credentials.json'), null)?.claudeAiOauth;
    if (!c?.accessToken) return null;
    if (c.expiresAt && c.expiresAt < Date.now() + 60_000) return null; // Claude Code renews it on the next turn
    return c.accessToken;
  }
  function usageToken() {
    const a = account();
    if (!a) return null;
    return a.mode === 'officex' ? a.token : credentialsToken();
  }
  const usageFile = () => path.join(C, OFFICE, 'usage.json');
  function setUsage(patch) {
    S.claude = { ...S.claude, usage: { windows: {}, ...(S.claude.usage ?? {}), ...patch } };
    emit({ type: 'claude', claude: S.claude });
    if (patch.windows) writeJson(usageFile(), S.claude.usage); // survives a restart
  }
  const WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
  const WINDOW_LABEL = { five_hour: ['Current session (5 h)', 'Sesi saat ini (5 jam)'], seven_day: ['This week (all models)', 'Minggu ini (semua model)'], seven_day_opus: ['This week (Opus)', 'Minggu ini (Opus)'], seven_day_sonnet: ['This week (Sonnet)', 'Minggu ini (Sonnet)'] };
  /** One line per window for agents, like the top bar: "Current session: 6% used, resets 06:10". */
  function usageText() {
    const u = S.claude.usage;
    if (!u?.windows || !Object.keys(u.windows).length) return null;
    const now = Date.now();
    const lines = [];
    for (const k of WINDOWS) {
      const w = u.windows[k];
      if (!w) continue;
      const pct = w.resetsAt && w.resetsAt < now ? 0 : Math.round(w.pct);
      const reset = w.resetsAt && w.resetsAt > now ? L(`resets ${localStamp(new Date(w.resetsAt))}`, `reset ${localStamp(new Date(w.resetsAt))}`) : L('just reset', 'baru reset');
      lines.push(`- ${L(...WINDOW_LABEL[k])}: ${pct}% ${L('used', 'terpakai')}, ${reset}`);
    }
    const age = u.updated ? Math.round((now - u.updated) / 60000) : null;
    lines.push(L(`(reading ${age ?? '?'} min old; limits are shared by every agent of this company)`, `(data ${age ?? '?'} menit lalu; batas ini dipakai bersama oleh semua agent company)`));
    return lines.join('\n');
  }
  let usageRetryAt = 0;
  let usageBusy = false;
  async function refreshUsage(force = false) {
    if (usageBusy || (!force && Date.now() < usageRetryAt)) return;
    const tok = usageToken();
    if (!tok) return;
    usageBusy = true;
    try {
      const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { authorization: `Bearer ${tok}`, 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json', 'user-agent': `claude-code/${String(S.claude.version || '').split(' ')[0] || '2'}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        usageRetryAt = Date.now() + 30 * 60_000; // e.g. a token without the profile scope: rely on agent turns
        if (S.claude.usage?.error !== `HTTP ${res.status}`) log(`Usage endpoint: HTTP ${res.status}; usage comes from agent turns only.`);
        setUsage({ error: `HTTP ${res.status}` });
        return;
      }
      const j = await res.json();
      const windows = {};
      for (const k of WINDOWS) {
        const w = j?.[k];
        if (!w || !Number.isFinite(Number(w.utilization))) continue;
        const r = w.resets_at;
        windows[k] = { pct: Number(w.utilization), resetsAt: typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : r ? Date.parse(r) : undefined };
      }
      usageRetryAt = 0;
      setUsage({ windows, source: 'api', updated: Date.now(), error: '' });
    } catch (err) {
      usageRetryAt = Date.now() + 10 * 60_000;
      setUsage({ error: err.name === 'TimeoutError' ? 'timeout' : err.message });
    } finally {
      usageBusy = false;
    }
  }
  /** rate_limit_event from a turn: utilization is a fraction (0-1), resetsAt unix seconds. */
  function usageFromTurn(info) {
    const windows = { ...(S.claude.usage?.windows ?? {}) };
    let any = false;
    for (const [k, w] of Object.entries(info.unifiedWindows ?? {})) {
      if (!WINDOWS.includes(k) || !Number.isFinite(w?.utilization)) continue;
      windows[k] = { pct: w.utilization * 100, resetsAt: w.resetsAt ? w.resetsAt * 1000 : windows[k]?.resetsAt };
      any = true;
    }
    if (!any && WINDOWS.includes(info.rateLimitType) && Number.isFinite(info.utilization)) {
      windows[info.rateLimitType] = { pct: info.utilization * 100, resetsAt: info.resetsAt ? info.resetsAt * 1000 : windows[info.rateLimitType]?.resetsAt };
      any = true;
    }
    if (any) setUsage({ windows, source: S.claude.usage?.source === 'api' ? 'api' : 'turns', updated: Date.now(), probe: undefined });
  }
  /**
   * One tiny Claude Code turn (Haiku, no tools, nothing saved) just to read the limits it reports. Only when the owner
   * clicks Refresh and the usage endpoint refuses the token (accounts signed in with setup-token have no profile scope).
   */
  let probing = false;
  async function probeUsage() {
    if (probing || !claudeBin?.ok || S.claude.state !== 'connected') return;
    probing = true;
    try {
      const help = claudeBin.help ?? '';
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', '--model', 'haiku'];
      if (help.includes('--no-session-persistence')) args.push('--no-session-persistence');
      if (help.includes('--tools')) args.push('--tools', '');
      if (help.includes('--strict-mcp-config')) args.push('--strict-mcp-config');
      const before = S.claude.usage?.updated ?? 0;
      const { done } = runTurn({ claude: claudeBin, cwd: os.tmpdir(), args, prompt: 'Reply with OK.', env: accountEnv(), timeoutMs: 90_000, cb: { onRateLimit: usageFromTurn } });
      const r = await done;
      if ((S.claude.usage?.updated ?? 0) === before) setUsage({ probe: r.ok ? 'silent' : 'failed' });
    } finally {
      probing = false;
    }
  }
  let usageTimer = null;
  const usageSoon = () => {
    clearTimeout(usageTimer);
    usageTimer = setTimeout(() => refreshUsage(), 20_000);
  };

  async function connect() {
    setClaude('connecting');
    claudeBin = await resolveClaude(cfg.claudePath);
    if (!claudeBin.ok) {
      setClaude('disconnected', 'missing');
      log(`claude not found: ${claudeBin.error}`);
      return;
    }
    S.claude.version = claudeBin.version;
    S.claude.account = accountView();
    const mode = S.claude.account.mode;
    log(`Claude Code ${claudeBin.version} (${claudeBin.bin}), account: ${mode === 'officex' ? S.claude.account.label : mode === 'computer' ? 'this computer\'s login' : 'none chosen yet'}`);
    if (mode === 'none') return setClaude('disconnected', 'account');
    setClaude('connected');
    refreshUsage(true);
  }

  // ---------------------------------------------------------------- lifecycle
  async function start() {
    if (!enabled) return;
    load();
    log(`Company: ${S.company.name} (${S.teams.length} teams, ${S.agents.size} agents)`);
    S.claude.account = accountView();
    const savedUsage = readJson(usageFile(), null);
    if (savedUsage?.windows) S.claude.usage = { ...savedUsage, error: '' };
    if (!S.ownerDisconnected) await connect();
    timers.push(setInterval(scheduleTick, 15_000));
    timers.push(setInterval(() => S.claude.state === 'connected' && refreshUsage(), 5 * 60_000));
    timers.push(setInterval(feedTick, 1000));
    telegramLoop();
    timers.push(setInterval(() => emit({ type: 'ping' }), 25_000));
    timers.push(
      setInterval(() => {
        // keep "turns this hour" honest in the GUI
        for (const a of S.agents.values()) if (a.turnTimes?.length) emit({ type: 'agent.usage', teamId: a.teamId, agentId: a.id, tokensToday: tokensToday(a), turnsThisHour: turnsThisHour(a) });
      }, 5 * 60_000),
    );
  }
  /** Let running turns finish (Claude Code saves the session as it goes), then stop. */
  function stop() {
    timers.forEach(clearInterval);
    tgLoop = false;
    S.claude.state = 'disconnected'; // no new turns
    for (const res of clients) res.end();
    if (!running.size) return Promise.resolve();
    log(`Waiting for ${running.size} agent turn(s) to finish...`);
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (!running.size || Date.now() - t0 > 25_000) {
          clearInterval(iv);
          for (const c of running.values()) c.kill();
          resolve();
        }
      }, 250);
    });
  }

  return {
    enabled,
    start,
    stop,
    handle,
    onProjectsChanged: () => enabled && (loadProjects(), snapshot()),
    onArchived: (area, name) => {
      if (!enabled) return;
      if (area === 'employees') removeTeam(name);
      else loadProjects(), snapshot();
    },
    onTelegramChanged: () => enabled && (loadTelegram(), snapshot()),
    /** called by serve.mjs after it changed the company folder itself */
    changed(kind, name) {
      if (!enabled) return;
      if (kind === 'team-archived') removeTeam(name);
      else if (kind === 'projects') loadProjects(), snapshot();
      else if (kind === 'telegram') loadTelegram(), snapshot();
    },
    info: () => ({ engine: enabled ? 'live' : 'demo', claude: S.claude }),
  };
}
