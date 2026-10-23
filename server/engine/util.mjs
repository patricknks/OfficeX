// Small helpers shared by the OfficeX engine. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let seq = 0;
export const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}${crypto.randomBytes(2).toString('hex')}`;
export const uuid = () => crypto.randomUUID();
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pad2 = (n) => String(n).padStart(2, '0');
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function localStamp(d = new Date()) {
  return `${localDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function slugify(s, fallback = 'item') {
  return (
    String(s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback
  );
}
/** Folder-safe id: lowercase letters, digits, "_" and "-". */
export const safeId = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s);

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return fallback;
  }
}
/** Write JSON through a temp file so a crash never leaves half a file behind. */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
export function writeText(file, text, { keep = false } = {}) {
  if (keep && fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
/** Last `n` JSON lines of a file, read from the end so big chat logs stay cheap. */
export function readJsonlTail(file, n) {
  if (!fs.existsSync(file)) return [];
  const size = fs.statSync(file).size;
  const want = Math.min(size, Math.max(64 * 1024, n * 2048));
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(want);
  fs.readSync(fd, buf, 0, want, size - want);
  fs.closeSync(fd);
  let lines = buf.toString('utf8').split('\n');
  if (want < size) lines = lines.slice(1); // first line may be cut
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip a damaged line */
    }
  }
  return out.slice(-n);
}

export const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/** Absolute path inside root, or null when it would escape it. */
export function inside(root, p) {
  if (!root || typeof p !== 'string' || !p) return null;
  const r = path.resolve(root);
  const abs = path.resolve(r, p);
  return abs === r || abs.startsWith(r + path.sep) ? abs : null;
}

export function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
