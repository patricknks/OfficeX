// OfficeX local server.
// Today: serves the built GUI (dist/) to this computer, the LAN and the tailnet.
// Later: the orchestrator (agent processes, WebSocket events) runs in this same process.
//
// No dependencies; needs Node.js 18+.
//   node server/serve.mjs
// Config: server.json in the app folder (created from server.example.json on first run).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffoldProject } from './scaffold-project.mjs';
import { createEngine } from './engine/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const LOGS = path.join(ROOT, 'logs');
const CONFIG = path.join(ROOT, 'server.json');
const EXAMPLE = path.join(ROOT, 'server.example.json');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

fs.mkdirSync(LOGS, { recursive: true });
const logFile = fs.createWriteStream(path.join(LOGS, 'server.log'), { flags: 'a' });
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  logFile.write(line + '\n');
}

if (!fs.existsSync(CONFIG) && fs.existsSync(EXAMPLE)) fs.copyFileSync(EXAMPLE, CONFIG);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); // tolerate a BOM from Windows editors
const cfg = { instanceName: 'OfficeX', host: '0.0.0.0', port: 80, basePath: '/OfficeX', password: '', companyRoot: '', python: process.platform === 'win32' ? 'python' : 'python3', ...(fs.existsSync(CONFIG) ? readJson(CONFIG) : {}) };

/** URL path the GUI lives under, e.g. "/OfficeX" -> http://localhost/OfficeX/. "" or "/" = site root. */
const BASE = (() => {
  const b = String(cfg.basePath ?? '').replace(/^\/+|\/+$/g, '');
  return b ? `/${b}` : '';
})();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const isLoopback = (addr = '') => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/** Other devices must log in when a password is set; this computer never has to. */
function authorized(req) {
  if (!cfg.password || isLoopback(req.socket.remoteAddress)) return true;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Basic ')) return false;
  const [, pass = ''] = Buffer.from(h.slice(6), 'base64').toString().split(/:(.*)/s);
  const a = Buffer.from(pass);
  const b = Buffer.from(String(cfg.password));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const urlFor = (ip) => `http://${ip}${Number(cfg.port) === 80 ? '' : `:${cfg.port}`}${BASE}/`;

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const started = Date.now();
let stopping = false;

const engine = createEngine({ cfg, appRoot: ROOT, log, port: Number(cfg.port) });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const redirect = (to) => {
    res.writeHead(302, { location: to });
    res.end();
  };

  if (!authorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="OfficeX", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Password required. Use any user name and the password from server.json.');
  }

  // ---- base path: the GUI and its API live under BASE (e.g. /OfficeX/ and /OfficeX/api/...) ----
  // Plain /api/... keeps working for the launcher on this computer.
  let route = url.pathname;
  if (BASE) {
    const low = route.toLowerCase();
    const base = BASE.toLowerCase();
    if (route.startsWith(BASE + '/')) route = route.slice(BASE.length);
    else if (low === base || low.startsWith(base + '/')) return redirect(`${BASE}${route.slice(BASE.length) || '/'}${url.search}`); // /officex -> /OfficeX/
    else if (!route.startsWith('/api/')) return redirect(`${BASE}/`);
  }

  // ---- API ----
  if (route === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000) });
  if (route === '/api/info') return sendJson(res, 200, { instanceName: cfg.instanceName, version: VERSION, basePath: BASE, urls: lanAddresses().map(urlFor), passwordProtected: !!cfg.password, companyRoot: cfg.companyRoot });
  if (route === '/api/shutdown') {
    if (req.method !== 'POST' || !isLoopback(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'Only this computer can stop the app.' });
    sendJson(res, 202, { stopping: true });
    return shutdown('stop requested');
  }
  if (route === '/api/projects' && req.method === 'POST') return createProject(req, res);
  if (route === '/api/projects' && req.method === 'DELETE') return archive(res, 'projects', url.searchParams.get('name'));
  if (route === '/api/teams' && req.method === 'DELETE') return archive(res, 'employees', url.searchParams.get('id'));
  if (route === '/api/uploads' && req.method === 'POST') return saveUpload(req, res);
  if (route === '/api/files' && req.method === 'GET') return serveCompanyFile(res, url.searchParams.get('path'));
  if (route === '/api/secretary/telegram') return telegram(req, res);
  if (route === '/api/secretary/telegram/find' && req.method === 'POST') return telegramFind(req, res);
  if (route.startsWith('/api/')) {
    if (await engine.handle(req, res, route, url, { loopback: isLoopback(req.socket.remoteAddress) })) return;
    return sendJson(res, 404, { error: 'Not found' });
  }

  // ---- static GUI ----
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('The GUI is not built yet. Run: npm run build');
  }
  let rel;
  try {
    rel = decodeURIComponent(route);
  } catch {
    rel = '/';
  }
  let file = path.normalize(path.join(DIST, rel));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(400);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // single-page app
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
});

// ---------- company folder helpers ----------
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
};
/** Absolute path inside companyRoot, or null when it would escape it. */
function inCompany(rel) {
  if (!cfg.companyRoot || typeof rel !== 'string') return null;
  const root = path.resolve(cfg.companyRoot);
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}
const safeName = (n) => n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^\.+/, '').slice(0, 120) || 'file';

function readBody(req, limit, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => cb(Buffer.concat(chunks)));
}

/** Owner uploads go to inbox/<date>/; the manager decides where they belong (usually project Knowledge References). */
function saveUpload(req, res) {
  if (!cfg.companyRoot) return sendJson(res, 409, { error: 'companyRoot is not set in server.json.' });
  const name = safeName(decodeURIComponent(String(req.headers['x-file-name'] || 'file')));
  readBody(req, 50 * 1024 * 1024, (buf) => {
    const day = stamp().slice(0, 10); // local date
    const dir = inCompany(path.join('inbox', day));
    fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, name);
    for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, name.replace(/(\.[^.]*)?$/, `-${i}$1`));
    fs.writeFileSync(file, buf);
    const rel = path.relative(path.resolve(cfg.companyRoot), file).split(path.sep).join('/');
    log(`Upload saved: ${rel} (${buf.length} bytes)`);
    sendJson(res, 201, { path: rel, url: `api/files?path=${encodeURIComponent(rel)}` });
  });
}

function serveCompanyFile(res, rel) {
  const abs = inCompany(rel);
  if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(abs).pipe(res);
}

/** Delete = move to <area>/_archive/<name> (deleted <time>). Nothing is erased. */
function archive(res, area, name) {
  if (!cfg.companyRoot) return sendJson(res, 409, { error: 'companyRoot is not set in server.json.' });
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.') || name.startsWith('_')) return sendJson(res, 400, { error: 'Bad name' });
  const src = inCompany(path.join(area, name));
  if (!src || !fs.existsSync(src)) return sendJson(res, 200, { archived: false, reason: 'no folder' });
  const destDir = inCompany(path.join(area, '_archive'));
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${name} (deleted ${stamp()})`);
  fs.renameSync(src, dest);
  if (area === 'projects') {
    const indexFile = inCompany('projects/index.json');
    if (fs.existsSync(indexFile)) {
      const index = readJson(indexFile);
      index.projects = (index.projects || []).filter((p) => p.name !== name);
      fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
    }
  }
  log(`Archived ${area}/${name} -> ${path.relative(cfg.companyRoot, dest)}`);
  engine.changed(area === 'employees' ? 'team-archived' : 'projects', name);
  sendJson(res, 200, { archived: true, to: path.relative(cfg.companyRoot, dest).split(path.sep).join('/') });
}

// ---------- secretary: Telegram ----------
const TELEGRAM_SCRIPT = path.join(ROOT, 'scripts', 'telegram_send.py');
const telegramFile = () => inCompany(path.join('office', 'secretary', 'telegram.json'));
function runTelegram(args, cb) {
  execFile(cfg.python, [TELEGRAM_SCRIPT, ...args], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
    try {
      cb(JSON.parse(String(stdout).trim().split('\n').pop()));
    } catch {
      cb({ ok: false, error: err ? `${cfg.python}: ${err.message}` : 'no output from telegram_send.py' });
    }
  });
}

function telegram(req, res) {
  if (!cfg.companyRoot) return sendJson(res, 409, { error: 'companyRoot is not set in server.json.' });
  const file = telegramFile();
  const current = fs.existsSync(file) ? readJson(file) : {};
  if (req.method === 'GET') return sendJson(res, 200, { configured: !!(current.token && current.chat_id), chatId: current.chat_id ?? '', notify: current.notify ?? null });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  readBody(req, 16_000, (buf) => {
    let body;
    try {
      body = JSON.parse(buf.toString() || '{}');
    } catch {
      return sendJson(res, 400, { error: 'Bad JSON' });
    }
    const next = { ...current, token: body.token?.trim() || current.token || '', chat_id: String(body.chatId ?? current.chat_id ?? '').trim(), notify: body.notify ?? current.notify ?? { input: true, report: true, digest: '07:00' } };
    if (!next.token || !next.chat_id) return sendJson(res, 400, { error: 'Token and chat ID are required.' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
    log('Secretary Telegram settings saved.');
    engine.changed('telegram');
    if (!body.test) return sendJson(res, 200, { ok: true, configured: true });
    runTelegram(['--config', file, '--text', body.testText || 'OfficeX: test message from your secretary.'], (r) => sendJson(res, r.ok ? 200 : 502, { ...r, configured: true }));
  });
}

function telegramFind(req, res) {
  readBody(req, 16_000, (buf) => {
    let body = {};
    try {
      body = JSON.parse(buf.toString() || '{}');
    } catch {
      /* empty body */
    }
    const file = telegramFile();
    const token = body.token?.trim() || (file && fs.existsSync(file) ? readJson(file).token : '');
    if (!token) return sendJson(res, 400, { error: 'Token is required.' });
    runTelegram(['--token', token, '--find-chat'], (r) => sendJson(res, r.ok ? 200 : 502, r));
  });
}

/** Scaffold a real project folder (new-project skill) inside companyRoot from server.json. */
function createProject(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 64_000) req.destroy();
  });
  req.on('end', () => {
    if (!cfg.companyRoot) return sendJson(res, 409, { error: 'companyRoot is not set in server.json, so no folder was created.' });
    try {
      const result = scaffoldProject(cfg.companyRoot, JSON.parse(body || '{}'));
      log(`Project created: ${result.dir}`);
      engine.changed('projects');
      sendJson(res, 201, { dir: result.dir, files: result.files.length, memoryDir: result.memoryDir });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  log(`Stopping (${reason}).`);
  // agents finish their current turn (their session is saved by Claude Code), then the server closes
  engine.stop().then(() => server.close(() => {
    try {
      fs.unlinkSync(path.join(LOGS, 'server.pid'));
    } catch {
      /* already gone */
    }
    log('Stopped.');
    logFile.end(() => process.exit(0));
  }));
  setTimeout(() => process.exit(0), 32_000).unref();
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') log(`Port ${cfg.port} is already in use. Close the other program or change "port" in server.json.`);
  else if (err.code === 'EACCES') log(`No permission to use port ${cfg.port}. Change "port" in server.json (for example 8080).`);
  else log('Server error:', err.message);
  logFile.end(() => process.exit(1));
});

server.listen(Number(cfg.port), cfg.host, () => {
  fs.writeFileSync(path.join(LOGS, 'server.pid'), String(process.pid));
  engine.start();
  log(`${cfg.instanceName} ${VERSION} is running.`);
  log(`  Company folder: ${cfg.companyRoot || '(not set: projects are created in the app only)'}`);
  log(`  This computer: ${urlFor('localhost')}`);
  lanAddresses().forEach((ip) => log(`  Network:       ${urlFor(ip)}`));
  log(cfg.password ? '  Other devices need the password from server.json.' : '  No password set: anyone on your LAN or tailnet can open it.');
});

process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
