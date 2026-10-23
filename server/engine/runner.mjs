// Runs one Claude Code turn for one agent: `claude -p ... --output-format stream-json`, prompt on stdin.
// Translates the stream into callbacks the engine turns into GUI events.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { clip } from './util.mjs';

// variables from a parent Claude Code session must not leak into agent sessions
const STRIP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED'];
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of STRIP_ENV) delete env[k];
  for (const k of Object.keys(env)) if (env[k] == null) delete env[k]; // extra may remove variables with null
  return env;
}

/** Find the claude executable. Windows: prefer claude.exe (native installer) so no shell is needed. */
export function resolveClaude(configured) {
  return new Promise((resolve) => {
    const finish = (bin, shell) =>
      execFile(bin, ['--version'], { shell, timeout: 20_000, windowsHide: true, env: childEnv() }, (err, stdout) => {
        if (err) return resolve({ ok: false, bin, shell, error: err.message });
        execFile(bin, ['--help'], { shell, timeout: 20_000, windowsHide: true, env: childEnv(), maxBuffer: 4 << 20 }, (_e, help) =>
          resolve({ ok: true, bin, shell, version: String(stdout).trim(), help: String(help || '') }),
        );
      });
    if (configured) return finish(configured, process.platform === 'win32' && !/\.exe$/i.test(configured));
    if (process.platform !== 'win32') return finish('claude', false);
    execFile('where', ['claude'], { windowsHide: true }, (err, out) => {
      const list = err ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const exe = list.find((p) => /\.exe$/i.test(p));
      if (exe) return finish(exe, false);
      const local = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
      if (fs.existsSync(local)) return finish(local, false);
      finish('claude', true); // npm shim (claude.cmd) needs cmd.exe
    });
  });
}

/** cmd.exe quoting for the shell:true case on Windows. */
const q = (a) => (/^[A-Za-z0-9_\-.,:/\\=@]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);

const TOOL_KIND = { Read: 'Read', Write: 'Write', Edit: 'Edit', MultiEdit: 'Edit', NotebookEdit: 'Edit', Bash: 'Bash', PowerShell: 'Bash', Grep: 'Grep', Glob: 'Grep', LS: 'Grep', WebSearch: 'WebSearch', WebFetch: 'WebFetch' };

/** One-line description of a tool call, like the terminal shows it. */
export function describeTool(name, input = {}) {
  if (name.startsWith('mcp__officex__')) {
    const t = name.slice(14);
    if (t === 'send_message') return { tool: 'Message', detail: `→ ${input.to}: ${clip(input.text, 70)}` };
    if (t === 'show_on_projector') return { tool: 'ShowOnProjector', detail: input.path };
    if (t === 'show_live_chart') return { tool: 'ShowOnProjector', detail: `live: ${input.file}` };
    if (t === 'ask_team') return { tool: 'AskTeam', detail: `${input.team}: ${clip(input.question, 60)}` };
    if (t === 'send_to_secretary') return { tool: 'SendToSecretary', detail: clip(input.title || input.text, 70) };
    if (t.startsWith('schedule')) return { tool: 'Schedule', detail: clip(input.title || input.id || input.cron || t, 70) };
    if (t === 'move_file') return { tool: 'MoveFile', detail: `${input.from} → ${input.to}` };
    if (t === 'reminder_add') return { tool: 'Reminder', detail: `${input.at ?? input.repeat ?? ''} ${clip(input.text, 60)}` };
    if (t === 'create_project') return { tool: 'CreateProject', detail: input.name };
    if (t === 'plan_usage') return { tool: 'PlanUsage', detail: '' };
    if (t === 'remember') return { tool: 'Remember', detail: clip(input.note, 80) };
    if (t === 'forget') return { tool: 'Forget', detail: clip(input.text, 80) };
    return { tool: t, detail: clip(JSON.stringify(input), 70) };
  }
  if (name.startsWith('mcp__browser__') || name.startsWith('mcp__claude-in-chrome__')) return { tool: 'Browser', kind: 'Browser', detail: `${name.split('__').pop()} ${clip(input.url || input.element || input.text || '', 60)}` };
  const kind = TOOL_KIND[name];
  const detail =
    input.file_path || input.notebook_path || input.command || input.query || input.url || input.pattern || input.path || input.description || input.skill || clip(JSON.stringify(input), 70);
  return { tool: name, kind, detail: clip(detail, 120) };
}

/**
 * Start a turn. Returns { child, done: Promise<result> }.
 * cb.onInit(sessionId), cb.onTool(step), cb.onText(text), cb.onToolResult()
 */
export function runTurn({ claude, cwd, args, prompt, env, timeoutMs, cb }) {
  const shell = claude.shell;
  const argv = shell ? args.map(q) : args;
  const child = spawn(shell ? q(claude.bin) : claude.bin, argv, { cwd, env: childEnv(env), shell, windowsHide: true });
  // context: tokens the model read on the last call of the turn = how big the conversation is now
  const result = { ok: false, text: '', steps: [], usage: null, sessionId: null, error: '', stderr: '', context: 0, compacted: null };
  let buf = '';
  let lastText = '';

  const handle = (o) => {
    if (o.type === 'system' && o.subtype === 'init') {
      result.sessionId = o.session_id;
      cb.onInit?.(o.session_id, o);
    } else if (o.type === 'system' && o.subtype === 'compact_boundary') {
      result.compacted = o.compact_metadata ?? {};
    } else if (o.type === 'assistant' && !o.parent_tool_use_id) {
      const u = o.message?.usage;
      if (u) result.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
      for (const c of o.message?.content ?? []) {
        if (c.type === 'tool_use') {
          const d = describeTool(c.name, c.input);
          result.steps.push({ tool: d.tool, detail: d.detail });
          cb.onTool?.(d, c);
        } else if (c.type === 'text' && c.text?.trim()) {
          lastText = c.text;
          cb.onText?.(c.text);
        }
      }
    } else if (o.type === 'user' && !o.parent_tool_use_id) {
      cb.onToolResult?.();
    } else if (o.type === 'rate_limit_event' && o.rate_limit_info) {
      cb.onRateLimit?.(o.rate_limit_info);
    } else if (o.type === 'result') {
      result.ok = o.subtype === 'success' && !o.is_error;
      result.text = typeof o.result === 'string' ? o.result : lastText;
      result.usage = o.usage ?? null;
      result.sessionId = o.session_id ?? result.sessionId;
      if (!result.ok) result.error = o.subtype === 'error_max_turns' ? 'max turns reached' : String(o.result || o.subtype || 'error');
    }
  };

  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        handle(JSON.parse(line));
      } catch {
        /* not JSON: ignore */
      }
    }
  });
  child.stderr.on('data', (d) => {
    result.stderr = (result.stderr + d.toString('utf8')).slice(-4000);
  });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  const done = new Promise((resolve) => {
    const timer = setTimeout(() => {
      result.error = `timed out after ${Math.round(timeoutMs / 60000)} min`;
      child.kill();
    }, timeoutMs);
    child.on('error', (err) => {
      result.error = err.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim().startsWith('{')) {
        try {
          handle(JSON.parse(buf.trim()));
        } catch {
          /* ignore */
        }
      }
      if (!result.text) result.text = lastText;
      if (!result.ok && !result.error) result.error = (result.stderr.trim().split('\n').pop() || `claude exited with code ${code}`).slice(0, 400);
      resolve(result);
    });
  });
  return { child, done };
}

/** Classify a failed turn so the GUI can tell the owner what to do. */
export function failureKind(r) {
  const s = `${r.error}\n${r.stderr}`.toLowerCase();
  if (/not logged in|login|authenticat|oauth|401|invalid api key|credit balance/.test(s)) return 'auth';
  if (/no conversation found|session.*not found|could not find session/.test(s)) return 'session';
  if (/rate.?limit|usage limit|429|overloaded/.test(s)) return 'limit';
  if (/unknown option|unrecognized|error: option/.test(s)) return 'flags';
  if (/not_found_error|model.*(not found|not available|does not exist|not supported)|no access to.*model/.test(s)) return 'model';
  return 'other';
}
