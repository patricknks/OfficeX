// Shared data contract between the GUI and the (future) orchestrator backend.
// The mock simulator emits exactly these events, so swapping it for a real
// WebSocket later should not require UI changes.

export type Lang = 'en' | 'id';

export type ModelId = 'claude-fable-5-1' | 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];

/** Claude Code `--effort`: how deeply the model reasons. Not the same as how long its answers are. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh';
export const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh'];

/** Claude Code `outputStyle`: how the agent writes its replies. */
export type OutputStyle = 'default' | 'explanatory' | 'concise';
export const OUTPUT_STYLES: OutputStyle[] = ['default', 'explanatory', 'concise'];

export type RoleKind = 'manager' | 'researcher' | 'analyst' | 'reviewer' | 'custom' | 'advisor' | 'secretary';

/** The secretary lives in the front office, not in a team room. */
export const OFFICE_ID = 'office';

/** What the agent is doing right now. Derived from the Claude Code stream-json events. */
export type AgentStatus =
  | 'idle' // no pending work
  | 'thinking' // model is generating
  | 'tool' // running a tool (WebSearch, Read, Write, Bash…)
  | 'messaging' // sending a chat message
  | 'waiting' // waiting for a reply from another agent / the owner
  | 'paused'; // paused by the owner (this agent only)

/** What the GUI shows, after team pause and the Claude connection are taken into account. */
export type ShownStatus = AgentStatus | 'team_paused' | 'offline';

export type Place = 'desk' | 'meeting' | 'lounge';

export type ToolName = 'WebSearch' | 'WebFetch' | 'Browser' | 'Read' | 'Write' | 'Edit' | 'Bash' | 'Grep';

export type Permission = 'web' | 'browser' | 'office_files' | 'read_company' | 'write_workspace' | 'write_projects' | 'run_commands';
export const PERMISSION_IDS: Permission[] = ['web', 'browser', 'office_files', 'read_company', 'write_workspace', 'write_projects', 'run_commands'];
/** What an advisor may ever have: reading only. */
export const READ_ONLY_PERMISSIONS: Permission[] = ['web', 'read_company'];

/**
 * How an agent with the 'browser' permission gets a Chrome:
 * - separate:  its own Chrome profile (Playwright MCP, user-data-dir inside the agent folder). Many agents can work in parallel.
 * - my_chrome: the owner's real Chrome with their logins (claude --chrome / Claude in Chrome). One agent at a time.
 */
export type BrowserMode = 'separate' | 'my_chrome';

export interface Agent {
  id: string; // folder slug, e.g. "researcher-1"
  teamId: string;
  name: string;
  role: RoleKind;
  roleTitle: string; // e.g. "Market data researcher"
  model: ModelId;
  effort: EffortLevel;
  outputStyle: OutputStyle;
  color: string; // avatar color
  sessionId: string; // claude session id, used with --resume
  status: AgentStatus;
  activity: string; // human-readable current activity
  tool?: ToolName;
  reportsTo?: string;
  permissions: Permission[];
  browserMode?: BrowserMode;
  tokensToday: number;
  turnsThisHour: number;
  currentTask?: string;
  memoryExcerpt: string[];
  /** live mode: size of the agent's conversation (tokens) and when OfficeX compacts it */
  context?: number;
  compactAt?: number;
  compactedAt?: number;
  compacting?: boolean;
  /** managers, live mode: may pick model/effort per task for team members (send_message model/effort) */
  autoModel?: boolean;
  hiredAt?: number; // set for agents added in this session (they walk in)
  /** Advisor that continues an existing Claude Code session (claude --resume <id> --fork-session), read-only. */
  advisorSession?: { sessionId: string; fork: boolean };
  /** Secretary only: Telegram is configured on the server (the token never reaches the GUI). */
  telegram?: { configured: boolean; chatId?: string; notify?: SecretaryNotify };
}

/** What the secretary forwards to the owner's Telegram. */
export interface SecretaryNotify {
  input: boolean; // a team needs a decision or input
  report: boolean; // a manager sent a report for the owner
  digest: string | null; // daily digest time "HH:MM", or null for none
}

export interface Team {
  id: string; // "team_quant"
  name: string;
  mission: string;
  color: string; // room color
  paused: boolean; // paused by the owner: no turns, agents rest in the lounge
  meeting: boolean; // team is gathered in the meeting room
  lastActive: string; // ISO
}

/** Lifecycle phase from the new-project skill. */
export type ProjectPhase = 'bootstrap' | 'discovery' | 'decision' | 'build' | 'checkpoint';
export const PHASES: ProjectPhase[] = ['bootstrap', 'discovery', 'decision', 'build', 'checkpoint'];

/** A project folder under COMPANY_XXX/projects/, scaffolded with the new-project skill layout. */
export interface Project {
  id: string; // slug
  name: string; // folder name
  teamId: string;
  description: string;
  shipped: string;
  people: string;
  process: string[]; // process steps -> numbered folders
  rules: string[];
  phase: ProjectPhase;
  created: string; // YYYY-MM-DD
  lastSession?: string;
  decisions: number;
  findings: number;
  /** Teams or single agents invited as advisors: they can read this project, never write to it. */
  collaborators: Collaborator[];
}

export interface Collaborator {
  kind: 'team' | 'agent';
  id: string; // team id, or agent key "team/agent"
  access: 'advisor';
  invitedAt: number;
}

/**
 * A repetitive job. "script" runs a command without Claude (no tokens) and only wakes the agent
 * when the script reports something; "agent" gives the agent a prompt on schedule.
 */
export interface Schedule {
  id: string;
  teamId: string;
  agentId: string;
  title: string;
  cron: string; // 5-field cron, local time
  human: string; // "Every day at 07:00"
  mode: 'script' | 'agent';
  command: string; // script command or the prompt
  enabled: boolean;
  createdBy: 'owner' | 'manager';
  lastRun?: number;
  lastResult?: string;
  runs: number;
}

export interface Company {
  id: string; // "MY_COMPANY"
  name: string;
  rootPath: string; // custom root directory, chosen by the owner
}

export interface ClaudeConnection {
  state: 'disconnected' | 'connecting' | 'connected';
  since?: number;
  version?: string;
  /** live mode: why it is not connected (missing, account = none chosen yet, login = rejected, stopped) */
  error?: string;
  /** live mode: which Claude account the agents use; 'none' until the owner chooses one */
  account?: { mode: 'none' | 'officex' | 'computer'; label?: string; since?: number };
  /** live mode: plan usage like claude.ai Settings > Usage (percent used per window) */
  usage?: PlanUsage;
}

export type UsageWindow = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet';
export interface PlanUsage {
  windows: Partial<Record<UsageWindow, { pct: number; resetsAt?: number }>>;
  updated?: number;
  /** api: Claude's usage endpoint; turns: rate-limit events from agent turns */
  source?: 'api' | 'turns';
  error?: string;
  /** Refresh ran a tiny turn and Claude Code reported no limits (older Claude Code versions report them only near a limit) */
  probe?: 'silent' | 'failed';
}

export type RoomKind = 'ceo' | 'team' | 'dm' | 'consult' | 'reports';

export interface Room {
  id: string; // file name stem in COMPANY_XXX/chat/, e.g. "team_quant__ceo__manager"
  teamId: string;
  kind: RoomKind;
  members: string[]; // agent ids of teamId, "ceo", or full agent keys "team/agent" for cross-team rooms
  /** consult rooms: the two teams talking */
  teams?: string[];
}

/** One tool call the agent made before replying (from Claude Code stream-json), shown like the terminal does. */
export interface ToolStep {
  tool: ToolName | 'ShowOnProjector' | string;
  detail: string;
}

export interface Message {
  id: string;
  ts: number;
  roomId: string;
  from: string; // agent id or "ceo"
  text: string; // markdown, exactly as the agent wrote it
  steps?: ToolStep[];
  projectorId?: string; // image this message put on the projector
  attachments?: Attachment[];
  /** secretary messages that were also delivered to the owner's Telegram */
  telegram?: 'sent' | 'failed';
  /** manager → member: model/effort chosen for this task only */
  run?: { model?: ModelId; effort?: EffortLevel };
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  url: string; // where the GUI can load it (server /api/files?... or a local blob: URL)
  savedPath?: string; // path inside the company folder once the server stored it
}

/** An image an agent put on the projector (show_on_projector tool). */
export interface ProjectorItem {
  id: string;
  ts: number;
  teamId: string;
  agentId: string;
  title: string;
  path: string; // file inside the company folder, e.g. projects/eth-funding-signal/04 Outputs/equity_curve.png
  src: string; // URL the GUI loads; the server will serve /api/files?path=...
  /** image: a static file. live: a chart the agent keeps feeding with projector.data events */
  kind: 'image' | 'live';
  series?: { name: string; color: string; axis?: 'left' | 'right' }[];
}

export interface LiveSeries {
  t: number[];
  values: number[][]; // one array per series
}

export interface ActivityEvent {
  id: string;
  ts: number;
  teamId: string;
  agentId: string;
  kind: 'tool' | 'message' | 'status' | 'hire' | 'meeting';
  text: string;
}

/** Events the backend will push over WebSocket. */
export type ServerEvent =
  | { type: 'agent.status'; teamId: string; agentId: string; status: AgentStatus; activity: string; tool?: ToolName }
  | { type: 'agent.usage'; teamId: string; agentId: string; tokensToday: number; turnsThisHour: number }
  | { type: 'team.meeting'; teamId: string; active: boolean }
  | { type: 'message'; message: Message }
  | { type: 'projector.show'; item: ProjectorItem }
  | { type: 'projector.data'; id: string; t: number; values: number[] }
  | { type: 'schedule.upsert'; schedule: Schedule }
  | { type: 'schedule.run'; id: string; ts: number; result: string }
  | { type: 'schedule.remove'; id: string }
  | { type: 'activity'; event: ActivityEvent }
  | { type: 'message.update'; roomId: string; id: string; patch: Partial<Message> }
  | { type: 'snapshot'; state: LiveSnapshot }
  | { type: 'claude'; claude: ClaudeConnection };

/** Structure of the company as the OfficeX engine sends it (api/state and "snapshot" events). */
export interface LiveSnapshot {
  company: Company;
  teams: Team[];
  agents: Agent[];
  projects: Project[];
  schedules: Schedule[];
  consults: Room[];
  claude: ClaudeConnection;
  reminders?: Reminder[];
}

/** A reminder the secretary keeps for the owner; OfficeX delivers it on time (chat + Telegram). */
export interface Reminder {
  id: string;
  text: string;
  at: number; // next time, epoch ms
  repeat: string | null; // cron for repeating reminders
  created: number;
  by?: string;
}

/** api/state: the snapshot plus history. */
export interface LiveState extends LiveSnapshot {
  engine: 'live';
  messages: Message[];
  projector: ProjectorItem[];
  live: Record<string, LiveSeries>;
  activity: ActivityEvent[];
  language: Lang;
}
