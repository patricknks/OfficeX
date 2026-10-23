<p align="center"><img src="assets/banner.png" alt="OfficeX" width="720"></p>

# OfficeX

A 3D office for a team of Claude Code agents. The owner (you) talks to managers, managers hand work to their agents,
agents message each other, and all of it is visible in the building, the chat rooms and on the projector. Every agent
is a real Claude Code session on this computer, running on a Claude subscription (no API key).

```
Owner ──chat──▶ Manager ──send_message──▶ Agent ──answer──▶ Manager ──▶ Owner / Secretary ──▶ Telegram
```

## Install on Windows

You need:
- **Claude Code** installed (signing in to a Claude account is done from the OfficeX GUI, see *Claude account*).
- **Git for Windows** (Claude Code uses it for the Bash tool): `winget install Git.Git`.
- **Python 3** for scheduled scripts, Telegram and the GUI sign-in: `winget install Python.Python.3.12`.
- Node.js LTS is installed by the installer when missing.

Then:

```powershell
git clone <this repository> "C:\Apps\OfficeX"
```

Double-click `C:\Apps\OfficeX\install.cmd` (safe to run again; Enter keeps the previous value). The installer:
- asks for the instance name, language, port (default 80), URL path (default `/OfficeX`), a password for other
  devices, and the **company folder** (for example `D:\Companies\MY_COMPANY`);
- runs `npm install` and `npm run build`;
- creates an **OfficeX** shortcut on the Desktop and in the Start menu;
- adds a Windows Firewall rule: the GUI port is open to the local network and Tailscale (100.64.0.0/10) only.

Configuration lives in `server.json` (not in git). Every option with an example: `server.example.json`.
Update to the latest version: `update.cmd` (fetches the branch and rebuilds; a copy without git is rebuilt from its files).
For a development copy, clone it a second time into another folder and give it another instance name and port in the installer.

## Open it

- On this computer: `http://localhost/OfficeX/` (add `:port` when the port is not 80, e.g. `http://localhost:8080/OfficeX/`).
- From a phone or another computer on the same network: `http://<LAN IP of the PC>/OfficeX/`.
- From anywhere with **Tailscale**: the PC's Tailscale IP (`http://100.101.102.103/OfficeX/`) or its MagicDNS name
  (`http://my-pc.tail1234.ts.net/OfficeX/`). The firewall rule already allows the Tailscale range.
- The path is case-insensitive and `/` redirects to it.
- When `password` is set, other devices get a login prompt: **any username**, the password from `server.json`.
- The shortcut starts the server and opens the GUI; when it is already running it asks *Yes* to open, *No* to stop.
  On stop, working agents get time to finish their current step first.
- While OfficeX runs, its icon sits next to the clock: double-click opens the GUI, right-click gives open / log / stop.
  The server itself is a Node process, so Task Manager lists it as "Node.js JavaScript Runtime".
- Log: `logs\server.log`.

## Claude account

OfficeX **uses no account until the owner chooses one** (safe for a public install: it never borrows the Claude Code
login of whoever happens to be signed in on that computer). Click *Connect Claude* in the top bar:

- **Sign in with Claude** → **Open Claude sign-in** → sign in and approve on claude.ai (from your phone or any computer)
  → copy the code it shows → paste → **Finish**. When the sign-in is opened on the OfficeX computer itself and ends with
  "You're all set up" and no code, OfficeX connects by itself.
- **Use this computer's Claude Code login**: only for the person who already ran `claude` in a terminal on that computer.
- **Sign in with another account** to switch (e.g. to a Pro account), **Sign out** to drop the account.

OfficeX runs `claude setup-token` behind the scenes. The token is stored in `COMPANY_XXX\office\claude-account.json`
(never sent to the browser) and agents use it through `CLAUDE_CODE_OAUTH_TOKEN`; the Claude Code login in the PC's
terminal is untouched. Company memory, projects, chats and schedules do not change when you switch accounts. On Windows
this needs the Python package `pywinpty` (installed by the installer, or on first use).

**Plan usage** in the top bar (*Session* and *Week*, click for details and reset times) mirrors Settings → Usage on
claude.ai. OfficeX reads it from Claude with the agents' account token (every 5 minutes and after agent turns) and from
the limit reports Claude Code sends with every agent turn. Accounts signed in through OfficeX are not allowed to read
that usage page, so for them the numbers come from agent turns (and *Refresh* runs one tiny Haiku turn). Old Claude Code
versions only report limits when close to one: run `claude update`.

## Start from an empty company folder

1. **New team** in the sidebar → team name and mission.
2. **Add agent** → the manager first, then researchers/analysts. Pick model, effort and permissions ("Can do").
3. Chat with the manager in the *You and <manager>* tab. The manager plans, delegates by DM and reports back.
4. Optional: *Front office* → **Add secretary** → paste a Telegram bot token so reports reach your phone.

Everything is plain files in the company folder:

```
COMPANY_XXX\
├─ CLAUDE.md, company.json        company info (read by every agent)
├─ goals\                         company and team goals
├─ employees\<team>\              team.json, CLAUDE.md (roster), schedules.json, reports\
│  └─ <agent>\                    agent.json, CLAUDE.md (role), memory.md, notes\, workspace\, .officex\ (mcp.json, queue)
├─ office\secretary\              secretary, telegram.json (the token lives only here)
├─ office\claude-account.json     the Claude account the agents use (only here)
├─ projects\<project>\            new-project layout (numbered process folders, System, Attachments, Journal, ...)
├─ chat\<room>.jsonl              every conversation
└─ inbox\<date>\                  files you sent in chat
```

## How agents work

- Every message for an agent becomes one **turn**: `claude -p --resume <session> --output-format stream-json` in that
  agent's folder. The Claude Code session continues, so the agent keeps its context.
- `CLAUDE.md` company → team → agent is read automatically by Claude Code.
- Agents talk through the **OfficeX tools** (local MCP server `server/engine/mcp-server.mjs`):

| Tool | Who | What |
|---|---|---|
| `send_message` | everyone | message `owner`, `manager`, `team`, an agent id or `secretary`; the receiver wakes up |
| `list_team` | everyone | roster and status of the team |
| `remember` / `forget` | everyone | keep a lasting note in the agent's `memory.md` (survives compaction) |
| `show_on_projector` | everyone but advisors | show an image on the projector |
| `show_live_chart` | managers, agents | live chart from a JSONL file a script keeps appending to |
| `ask_team` | managers | ask another team's manager in the *Between teams* room |
| `send_to_secretary` | managers | a report for the owner; forwarded to Telegram |
| `schedule_add/list/remove/enable` | managers | repeating jobs for the team |
| `move_file` | managers | move files from `inbox\` into a project folder |
| `create_project` | managers | create a project with the new-project layout |
| `telegram_send` | secretary | send a Telegram message now |
| `reminder_add/list/cancel` | secretary | one-off or repeating reminders for the owner |

- **Permissions → Claude Code flags**: web = WebSearch/WebFetch; write = Write/Edit in the agent's folder (and
  `projects\` when allowed); run commands = Bash; Excel and Office = Bash restricted to Python; Chrome = Playwright MCP
  (separate profile) or `--chrome` (your own Chrome). Advisors are read-only.
- **Advisor from an existing Claude Code session**: the first turn uses `--resume <id> --fork-session`, so your
  original session is untouched.
- **Token guards**: a tool message wakes the receiver; an answer wakes the asker once; an answer to an answer wakes
  nobody. Plus a chain limit (`maxHops`, default 24 agent-to-agent steps; after that the next messages are kept on hold and the owner is asked to reply before the team goes on), turns per agent per hour (`maxTurnsPerAgentPerHour`) and parallel turns
  (`maxConcurrentTurns`) in `server.json`. Pause a team or an agent any time; its queue is kept and resumes later.

## Saving tokens: agent memory

- **Conversations are compacted automatically.** Every turn re-reads the agent's whole conversation, so longer means
  more expensive. Once an agent's conversation passes `compactAtTokens` (default 60,000) and the agent is idle, OfficeX
  runs Claude Code's `/compact` to summarise it. The size and a *Tidy up memory now* button are in the agent panel.
  `0` turns it off (Claude Code still compacts on its own when the context is full).
- **Not summarised:** the company/team/agent CLAUDE.md files, projects, `goals\`, schedules, reminders and each agent's
  **`memory.md`**. Routines, procedures and preferences you teach are saved there by the agent with the `remember`
  tool (`forget` removes outdated lines); the content is handed to the agent on every turn, so nothing has to be taught
  again after a summary. You can edit `memory.md` directly too.

## Schedules

Tell the manager "do X every day at 07:00". The manager calls `schedule_add`:
- **script** — a command runs without Claude (**no tokens**). The script prints one JSON line
  `{"ok": true, "anomaly": false, "summary": "..."}`. An agent is woken only on `anomaly` or failure.
- **agent** — the agent gets the instruction as a message at that time (uses tokens).
Schedules are listed in the team sidebar and can be paused one by one.

## Secretary and Telegram

1. Telegram → **@BotFather** → `/newbot` → copy the token. Send any message to your new bot.
2. Sidebar → *Front office* → paper-plane icon → paste the token → **Find my chat ID** → **Save and send a test message**.

**Reminders**: tell the secretary "remind me at 21:00 to ..." (or repeating, e.g. "every Monday at 08:00"). At that
time OfficeX itself posts the reminder in chat and sends it to Telegram, without tokens; reminders missed while the PC
was off are sent as soon as OfficeX starts. The list is shown under *Front office*.

Manager reports (`send_to_secretary`), questions that need your decision and the daily digest go to Telegram.
**Reply straight from Telegram**: your message lands in the secretary's chat and the secretary passes it to the right
manager. The token is stored only in `COMPANY_XXX\office\secretary\telegram.json`, never sent to the browser.

## More

- **Chat**: Markdown like Claude Code with the trail of tool steps; paste images (Ctrl+V), drag files in, or click the
  clip. Files land in `inbox\<date>\` and the manager moves them to `Attachments\Knowledge References\`.
  The chat panel can be widened and collapsed.
- **Projector**: images or live charts; click for full screen with zoom and pan.
- **Collaboration**: invite another team or one agent as a project advisor (read-only).
- **Excel**: the *Excel and Office files* permission + the `office-files` skill (pandas/openpyxl, xlwings for real Excel).
- **Delete team/project**: type its name first; the folder is moved to `_archive`, never deleted.
- **Demo mode**: opened without a server (`preview\index.html`) or without `companyRoot`, the GUI uses sample data and
  a simulator.

## Code layout

```
install.cmd, start.cmd, stop.cmd, update.cmd
scripts/OfficeX.ps1           launcher (shortcut), install.ps1, update.ps1, telegram_send.py, claude_login.py
server/serve.mjs              HTTP server: GUI, login, uploads, files, archive, Telegram
server/engine/                orchestrator
├─ index.mjs                  company state, queues & turns, agent tools, schedules, secretary, account, API + SSE
├─ runner.mjs                 runs claude -p and reads stream-json
├─ mcp-server.mjs             OfficeX tools for agents (MCP stdio, no dependencies)
├─ prompts.mjs                company / team / agent CLAUDE.md
└─ cron.mjs                   5-field cron parser
server/scaffold-project.mjs   project folder builder (new-project)
templates/                    new project contents, office-files skill
src/                          GUI (React + three.js): store.ts, live.ts (api/state + api/events), office/, components/
```

GUI API (also under `/OfficeX/api/...`): `GET api/state`, `GET api/events` (SSE), `POST api/messages`,
`POST|PATCH api/teams`, `POST api/pause-all`, `POST|PATCH api/agents`, `POST api/agents/compact`,
`POST|PATCH|DELETE api/projects`, `POST api/consults`, `PATCH|DELETE api/schedules`, `DELETE api/reminders`,
`POST api/claude`, `POST api/claude/login`, `POST api/usage`, `POST api/uploads`, `GET api/files`,
`GET|POST api/secretary/telegram`. Agent tools: `api/internal/tools/*` (this computer only, with a per-turn token).

## Development

```bash
npm install
npm run dev            # GUI only (demo mode) at http://localhost:5173
npm run typecheck
npm run build          # dist/ served by the server
npm run serve          # server + engine (needs server.json with companyRoot)
npm run build:preview  # single file dist-preview/index.html (demo mode, no server)
```
