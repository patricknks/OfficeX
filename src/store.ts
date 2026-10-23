import { create } from 'zustand';
import { OFFICE_ID, type ActivityEvent, type Agent, type Attachment, type ClaudeConnection, type Collaborator, type Company, type Lang, type LiveSeries, type Message, type Place, type Project, type Reminder, type ProjectorItem, type Room, type Schedule, type ServerEvent, type ShownStatus, type Team } from './types';
import { consultRoom, officeRooms, roomsForTeam, seed, TEAM_COLORS } from './mock/data';
import { bridge, call } from './api';
import type { LiveSnapshot, LiveState } from './types';

export const agentKey = (teamId: string, agentId: string) => `${teamId}/${agentId}`;
/** Room members are local ids, "ceo", "system", or full keys for cross-team rooms. */
export const memberKey = (room: Room, m: string) => (m === 'ceo' || m === 'system' || m.includes('/') ? m : agentKey(room.teamId, m));

let uid = 0;
export const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${uid++}`;

/** A message travelling across the building. Endpoints are agent keys or "ceo". */
export interface Flight {
  id: string;
  from: string;
  to: string;
  color: string;
  start: number;
}

export type LabelMode = 'full' | 'names' | 'off';
export type FocusInput = { kind: 'building' } | { kind: 'team'; teamId: string } | { kind: 'agent'; key: string } | { kind: 'projector' };
export type Focus = FocusInput & { n: number };

/** What the GUI shows after team pause and the Claude connection are applied. */
export function shownStatus(a: Agent, team: Team | undefined, claude: ClaudeConnection): ShownStatus {
  if (claude.state !== 'connected') return 'offline';
  if (a.status === 'paused') return 'paused';
  if (team?.paused) return 'team_paused';
  return a.status;
}

export function placeOf(a: Agent, team: Team | undefined, claude: ClaudeConnection): Place {
  const s = shownStatus(a, team, claude);
  if (s === 'offline' || s === 'paused' || s === 'team_paused') return 'lounge';
  if (team?.meeting) return 'meeting';
  return 'desk';
}

type Pane = { width: number; collapsed: boolean };
const CHAT_KEY = 'officex.chat';
const SIDE_KEY = 'officex.side';
function loadPane(key: string, width: number): Pane {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return { width: typeof v.width === 'number' ? v.width : width, collapsed: !!v.collapsed };
  } catch {
    return { width, collapsed: false };
  }
}
function savePane(key: string, v: Pane) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* per-browser convenience only */
  }
}
const loadChat = () => loadPane(CHAT_KEY, 420);

const LANG_KEY = 'officex.lang';
function loadLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'id' ? v : null;
  } catch {
    return null;
  }
}
function saveLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* storage unavailable: language is asked again next time */
  }
}

interface State {
  lang: Lang | null;
  company: Company;
  teams: Team[];
  agents: Record<string, Agent>;
  rooms: Room[];
  messages: Message[];
  projector: ProjectorItem[];
  live: Record<string, LiveSeries>;
  projects: Project[];
  schedules: Schedule[];
  reminders: Reminder[];
  consults: Room[];
  chat: Pane;
  side: Pane;
  /** teams folded in the sidebar (click the open team's name again); the selection stays */
  folded: Record<string, boolean>;
  secretaryOpen: boolean;
  projectOpen: string | null;
  newProjectOpen: boolean;
  viewer: { open: boolean; id: string | null };
  activity: ActivityEvent[];
  flights: Flight[];
  claude: ClaudeConnection;

  selectedTeamId: string;
  selectedAgentKey: string | null;
  activeRoomId: string | null;
  floorView: 'all' | number;
  labels: LabelMode;
  focus: Focus;
  addAgentOpen: boolean;
  connectOpen: boolean;

  /** pending: asking the server; demo: built-in simulator; live: OfficeX engine with real Claude Code agents */
  mode: 'pending' | 'demo' | 'live';
  hydrate: (s: LiveState) => void;
  setMode: (m: 'pending' | 'demo' | 'live') => void;
  chooseLanguage: (l: Lang) => void;
  connectClaude: () => void;
  disconnectClaude: () => void;
  setConnectOpen: (o: boolean) => void;
  selectTeam: (id: string, focus?: boolean) => void;
  selectAgent: (key: string | null) => void;
  setActiveRoom: (id: string) => void;
  setTeamPaused: (teamId: string, paused: boolean) => void;
  setAllPaused: (paused: boolean) => void;
  setAgentPaused: (teamId: string, id: string, paused: boolean) => void;
  setRootPath: (p: string) => void;
  createTeam: (name: string, mission: string) => void;
  setAddAgentOpen: (o: boolean) => void;
  hireAgent: (agent: Agent) => void;
  updateAgent: (teamId: string, id: string, patch: Partial<Agent>) => void;
  sendAsCeo: (text: string, attachments?: Attachment[]) => void;
  deleteTeam: (teamId: string) => void;
  deleteProject: (id: string) => void;
  inviteToProject: (projectId: string, c: Omit<Collaborator, 'invitedAt' | 'access'>) => void;
  removeCollaborator: (projectId: string, c: Collaborator) => void;
  ensureConsult: (a: string, b: string) => string;
  setScheduleEnabled: (id: string, enabled: boolean) => void;
  setChat: (patch: Partial<Pane>) => void;
  setSide: (patch: Partial<Pane>) => void;
  /** click on a team name: open it, or fold it when it is already open */
  toggleTeam: (id: string) => void;
  setSecretaryOpen: (o: boolean) => void;
  setFloorView: (v: 'all' | number) => void;
  cycleLabels: () => void;
  focusOn: (f: FocusInput) => void;
  openProject: (id: string | null) => void;
  setNewProjectOpen: (o: boolean) => void;
  addProject: (p: Project) => void;
  openViewer: (id?: string) => void;
  closeViewer: () => void;
  applyEvent: (e: ServerEvent) => void;
}

const allRooms = (agents: Record<string, Agent>, teams: Team[], consults: Room[]) => [
  ...teams.flatMap((t) => roomsForTeam(t.id, Object.values(agents).filter((a) => a.teamId === t.id))),
  ...officeRooms(Object.values(agents)),
  ...consults.filter((r) => (r.teams ?? []).every((id) => teams.some((t) => t.id === id))),
];

/** Turn the engine's snapshot into store fields; agents keep their walk-in time. */
function structure(st: LiveSnapshot, prev: { agents: Record<string, Agent> }) {
  const agents = Object.fromEntries(
    st.agents.map((a) => {
      const k = agentKey(a.teamId, a.id);
      return [k, { ...a, hiredAt: a.hiredAt && Date.now() - a.hiredAt < 6000 ? a.hiredAt : prev.agents[k]?.hiredAt }];
    }),
  );
  return {
    company: st.company,
    teams: st.teams,
    agents,
    projects: st.projects,
    schedules: st.schedules,
    reminders: st.reminders ?? [],
    consults: st.consults,
    rooms: allRooms(agents, st.teams, st.consults),
    claude: st.claude,
  };
}

function seeded(lang: Lang) {
  const s = seed(lang);
  const agents = Object.fromEntries(s.agents.map((a) => [agentKey(a.teamId, a.id), a]));
  return { company: s.company, teams: s.teams, agents, rooms: allRooms(agents, s.teams, s.consults), consults: s.consults, messages: s.messages, projector: s.projector, projects: s.projects, schedules: s.schedules };
}

const initialLang = loadLang();
const initial = seeded(initialLang ?? 'en');

export const useStore = create<State>((set, get) => ({
  lang: initialLang,
  ...initial,
  activity: [],
  viewer: { open: false, id: null },
  live: {},
  reminders: [],
  chat: loadChat(),
  side: loadPane(SIDE_KEY, 300),
  folded: {},
  secretaryOpen: false,
  projectOpen: null,
  newProjectOpen: false,
  flights: [],
  claude: { state: 'disconnected' },

  selectedTeamId: initial.teams[0].id,
  selectedAgentKey: null,
  activeRoomId: initial.rooms.find((r) => r.teamId === initial.teams[0].id && r.kind === 'ceo')?.id ?? null,
  floorView: 'all',
  labels: 'full',
  focus: { kind: 'building', n: 0 },
  addAgentOpen: false,
  connectOpen: false,

  mode: 'pending',
  hydrate: (st) => {
    const merged = structure(st, get());
    const messages = st.messages;
    const teamIds = merged.teams.map((t) => t.id);
    const hasSec = Object.values(merged.agents).some((a) => a.teamId === OFFICE_ID);
    const sel = teamIds.includes(get().selectedTeamId) ? get().selectedTeamId : teamIds[0] ?? (hasSec ? OFFICE_ID : '');
    set({
      ...merged,
      mode: 'live',
      messages,
      projector: st.projector,
      live: st.live,
      activity: st.activity,
      selectedTeamId: sel,
      selectedAgentKey: null,
      projectOpen: null,
      activeRoomId: merged.rooms.find((r) => r.teamId === sel && r.kind === 'ceo')?.id ?? merged.rooms.find((r) => r.teamId === sel)?.id ?? null,
    });
  },
  setMode: (mode) => set({ mode }),

  chooseLanguage: (lang) => {
    saveLang(lang);
    const first = get().lang === null;
    if (first && get().mode !== 'live') {
      const s = seeded(lang);
      set({ ...s, lang, activeRoomId: s.rooms.find((r) => r.teamId === s.teams[0].id && r.kind === 'ceo')?.id ?? null });
    } else set({ lang });
  },

  connectClaude: () => {
    set({ claude: { state: 'connecting' } });
    if (bridge.on) return call('POST', 'api/claude', { action: 'connect' });
    window.setTimeout(() => set({ claude: { state: 'connected', since: Date.now() } }), 1600);
  },
  disconnectClaude: () => {
    set({ claude: { state: 'disconnected' } });
    call('POST', 'api/claude', { action: 'disconnect' });
  },
  setConnectOpen: (connectOpen) => set({ connectOpen }),

  selectTeam: (id, focus = true) => {
    const room = get().rooms.find((r) => r.teamId === id && r.kind === 'ceo') ?? get().rooms.find((r) => r.teamId === id);
    set({ selectedTeamId: id, activeRoomId: room?.id ?? null, selectedAgentKey: null });
    if (focus) get().focusOn({ kind: 'team', teamId: id });
  },
  selectAgent: (key) => {
    if (!key) return set({ selectedAgentKey: null });
    const a = get().agents[key];
    if (a && a.teamId !== get().selectedTeamId) get().selectTeam(a.teamId, false);
    set({ selectedAgentKey: key, projectOpen: null });
  },
  setActiveRoom: (activeRoomId) => set({ activeRoomId }),

  setTeamPaused: (teamId, paused) => {
    set({ teams: get().teams.map((t) => (t.id === teamId ? { ...t, paused, meeting: paused ? false : t.meeting } : t)) });
    call('PATCH', 'api/teams', { id: teamId, paused });
  },
  setAllPaused: (paused) => {
    set({ teams: get().teams.map((t) => ({ ...t, paused, meeting: paused ? false : t.meeting })) });
    call('POST', 'api/pause-all', { paused });
  },
  setAgentPaused: (teamId, id, paused) =>
    get().updateAgent(teamId, id, paused ? { status: 'paused', activity: '' } : { status: 'idle', activity: '' }),

  setRootPath: (rootPath) => set({ company: { ...get().company, rootPath } }),

  createTeam: (name, mission) => {
    const base = 'team_' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'new');
    let id = base;
    let i = 2;
    while (get().teams.some((t) => t.id === id)) id = `${base}_${i++}`;
    const team = { id, name, mission, color: TEAM_COLORS[get().teams.length % TEAM_COLORS.length], paused: false, meeting: false, lastActive: new Date().toISOString() };
    const teams = [...get().teams, team];
    set({ teams, rooms: allRooms(get().agents, teams, get().consults), floorView: 'all' });
    call('POST', 'api/teams', team);
    get().selectTeam(id);
  },

  setAddAgentOpen: (addAgentOpen) => set({ addAgentOpen }),
  hireAgent: (agent) => {
    const agents = { ...get().agents, [agentKey(agent.teamId, agent.id)]: { ...agent, hiredAt: Date.now() } };
    set({ agents, rooms: allRooms(agents, get().teams, get().consults) });
    call('POST', 'api/agents', agent);
    get().applyEvent({
      type: 'activity',
      event: { id: nextId('act'), ts: Date.now(), teamId: agent.teamId, agentId: agent.id, kind: 'hire', text: agent.roleTitle },
    });
    if (!get().activeRoomId || !get().rooms.some((r) => r.id === get().activeRoomId))
      set({ activeRoomId: get().rooms.find((r) => r.teamId === agent.teamId)?.id ?? null });
  },
  updateAgent: (teamId, id, patch) => {
    const k = agentKey(teamId, id);
    const a = get().agents[k];
    if (a) set({ agents: { ...get().agents, [k]: { ...a, ...patch } } });
    // runtime fields (activity, usage...) belong to the engine; only send what the owner can change
    const { name, roleTitle, model, effort, outputStyle, permissions, browserMode, status } = patch;
    const out = Object.fromEntries(Object.entries({ name, roleTitle, model, effort, outputStyle, permissions, browserMode, status }).filter(([, v]) => v !== undefined));
    if (Object.keys(out).length) call('PATCH', 'api/agents', { teamId, id, patch: out });
  },

  sendAsCeo: (text, attachments) => {
    const { selectedTeamId, rooms } = get();
    const room = rooms.find((r) => r.teamId === selectedTeamId && r.kind === 'ceo');
    // live: the engine stores the message and sends it back over the event stream
    if (room && bridge.on) return call('POST', 'api/messages', { roomId: room.id, text, attachments });
    if (room)
      get().applyEvent({
        type: 'message',
        message: { id: nextId('msg'), ts: Date.now(), roomId: room.id, from: 'ceo', text, ...(attachments?.length ? { attachments } : {}) },
      });
  },

  deleteTeam: (teamId) => {
    const s = get();
    const agents = Object.fromEntries(Object.entries(s.agents).filter(([, a]) => a.teamId !== teamId));
    const teams = s.teams.filter((t) => t.id !== teamId);
    const consults = s.consults.filter((r) => !(r.teams ?? []).includes(teamId));
    const projects = s.projects
      .filter((p) => p.teamId !== teamId)
      .map((p) => ({ ...p, collaborators: p.collaborators.filter((c) => c.id !== teamId && !c.id.startsWith(teamId + '/')) }));
    set({
      agents,
      teams,
      consults,
      projects,
      rooms: allRooms(agents, teams, consults),
      schedules: s.schedules.filter((x) => x.teamId !== teamId),
      selectedAgentKey: null,
      projectOpen: null,
      floorView: 'all',
    });
    get().selectTeam(teams[0]?.id ?? OFFICE_ID, false);
    get().focusOn({ kind: 'building' });
  },
  deleteProject: (id) => set({ projects: get().projects.filter((p) => p.id !== id), projectOpen: get().projectOpen === id ? null : get().projectOpen }),
  inviteToProject: (projectId, c) => {
    const p = get().projects.find((x) => x.id === projectId);
    if (!p || p.collaborators.some((x) => x.id === c.id)) return;
    const collab: Collaborator = { ...c, access: 'advisor', invitedAt: Date.now() };
    const collaborators = [...p.collaborators, collab];
    set({ projects: get().projects.map((x) => (x.id === projectId ? { ...x, collaborators } : x)) });
    const otherTeam = c.kind === 'team' ? c.id : c.id.split('/')[0];
    if (otherTeam !== p.teamId && otherTeam !== OFFICE_ID) get().ensureConsult(p.teamId, otherTeam);
    call('PATCH', 'api/projects', { id: projectId, collaborators });
  },
  removeCollaborator: (projectId, c) => {
    const p = get().projects.find((x) => x.id === projectId);
    if (!p) return;
    const collaborators = p.collaborators.filter((y) => y.id !== c.id);
    set({ projects: get().projects.map((x) => (x.id === projectId ? { ...x, collaborators } : x)) });
    call('PATCH', 'api/projects', { id: projectId, collaborators });
  },
  ensureConsult: (a, b) => {
    const room = consultRoom(a, b);
    if (!get().consults.some((r) => r.id === room.id)) {
      const consults = [...get().consults, room];
      set({ consults, rooms: allRooms(get().agents, get().teams, consults) });
      call('POST', 'api/consults', { a, b });
    }
    return room.id;
  },
  setScheduleEnabled: (id, enabled) => {
    set({ schedules: get().schedules.map((x) => (x.id === id ? { ...x, enabled } : x)) });
    call('PATCH', 'api/schedules', { id, enabled });
  },
  setChat: (patch) => {
    const chat = { ...get().chat, ...patch };
    savePane(CHAT_KEY, chat);
    set({ chat });
  },
  setSide: (patch) => {
    const side = { ...get().side, ...patch };
    savePane(SIDE_KEY, side);
    set({ side });
  },
  toggleTeam: (id) => {
    const { selectedTeamId, folded } = get();
    if (selectedTeamId === id && !folded[id]) return set({ folded: { ...folded, [id]: true } });
    set({ folded: { ...folded, [id]: false } });
    get().selectTeam(id);
  },
  setSecretaryOpen: (secretaryOpen) => set({ secretaryOpen }),

  setFloorView: (floorView) => set({ floorView }),
  cycleLabels: () => set({ labels: get().labels === 'full' ? 'names' : get().labels === 'names' ? 'off' : 'full' }),
  focusOn: (f) => set({ focus: { ...f, n: get().focus.n + 1 } as Focus }),

  openProject: (projectOpen) => set({ projectOpen, selectedAgentKey: null }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  addProject: (p) => {
    set({ projects: [...get().projects, p], projectOpen: p.id, selectedAgentKey: null });
    get().applyEvent({ type: 'activity', event: { id: nextId('act'), ts: Date.now(), teamId: p.teamId, agentId: 'manager', kind: 'status', text: `project:${p.name}` } });
  },
  openViewer: (id) => {
    const list = get().projector;
    if (!list.length) return;
    set({ viewer: { open: true, id: id ?? list[list.length - 1].id } });
  },
  closeViewer: () => set({ viewer: { ...get().viewer, open: false } }),

  applyEvent: (e) => {
    const s = get();
    switch (e.type) {
      case 'agent.status': {
        const k = agentKey(e.teamId, e.agentId);
        const a = s.agents[k];
        if (!a || a.status === 'paused') return;
        set({ agents: { ...s.agents, [k]: { ...a, status: e.status, activity: e.activity, tool: e.tool } } });
        return;
      }
      case 'agent.usage': {
        const k = agentKey(e.teamId, e.agentId);
        const a = s.agents[k];
        if (a) set({ agents: { ...s.agents, [k]: { ...a, tokensToday: e.tokensToday, turnsThisHour: e.turnsThisHour } } });
        return;
      }
      case 'team.meeting':
        set({ teams: s.teams.map((t) => (t.id === e.teamId ? { ...t, meeting: e.active } : t)) });
        return;
      case 'message': {
        const room = s.rooms.find((r) => r.id === e.message.roomId);
        if (!room) return;
        const keyOf = (m: string) => memberKey(room, m);
        const sender = s.agents[keyOf(e.message.from)];
        const color = e.message.from === 'ceo' ? '#ffffff' : sender?.color ?? '#ffffff';
        const now = performance.now();
        const flights = room.members
          .filter((m) => m !== e.message.from)
          .map((to) => ({ id: nextId('fl'), from: keyOf(e.message.from), to: keyOf(to), color, start: now }));
        set({
          messages: [...s.messages, e.message],
          flights: [...s.flights.filter((f) => now - f.start < 3000), ...flights],
          teams: s.teams.map((t) => (t.id === room.teamId || room.teams?.includes(t.id) ? { ...t, lastActive: new Date().toISOString() } : t)),
        });
        return;
      }
      case 'activity':
        set({ activity: [e.event, ...s.activity].slice(0, 80) });
        return;
      case 'projector.data': {
        const cur = s.live[e.id] ?? { t: [], values: [] };
        const values = e.values.map((v, i) => [...(cur.values[i] ?? []), v].slice(-240));
        set({ live: { ...s.live, [e.id]: { t: [...cur.t, e.t].slice(-240), values } } });
        return;
      }
      case 'schedule.upsert':
        set({ schedules: s.schedules.some((x) => x.id === e.schedule.id) ? s.schedules.map((x) => (x.id === e.schedule.id ? e.schedule : x)) : [...s.schedules, e.schedule] });
        return;
      case 'schedule.run':
        set({ schedules: s.schedules.map((x) => (x.id === e.id ? { ...x, lastRun: e.ts, lastResult: e.result, runs: x.runs + 1 } : x)) });
        return;
      case 'schedule.remove':
        set({ schedules: s.schedules.filter((x) => x.id !== e.id) });
        return;
      case 'snapshot': {
        const merged = structure(e.state, s);
        const keep = (id: string) => merged.rooms.some((r) => r.id === id);
        set({
          ...merged,
          activeRoomId: s.activeRoomId && keep(s.activeRoomId) ? s.activeRoomId : merged.rooms.find((r) => r.teamId === s.selectedTeamId)?.id ?? null,
          selectedAgentKey: s.selectedAgentKey && merged.agents[s.selectedAgentKey] ? s.selectedAgentKey : null,
          projectOpen: s.projectOpen && merged.projects.some((p) => p.id === s.projectOpen) ? s.projectOpen : null,
        });
        return;
      }
      case 'message.update':
        set({ messages: s.messages.map((m) => (m.id === e.id ? { ...m, ...e.patch } : m)) });
        return;
      case 'claude':
        set({ claude: e.claude });
        return;
      case 'projector.show': {
        const now = performance.now();
        set({
          projector: [...s.projector, e.item].slice(-30),
          flights: [...s.flights.filter((f) => now - f.start < 3000), { id: nextId('fl'), from: agentKey(e.item.teamId, e.item.agentId), to: 'projector', color: '#ffffff', start: now }],
          // keep the viewer on the new image if it is already open
          viewer: s.viewer.open ? { open: true, id: e.item.id } : s.viewer,
        });
        return;
      }
    }
  },
}));
