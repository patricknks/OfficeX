// Project scaffolder: creates a project inside COMPANY_XXX/projects/ following the
// "new-project" skill (templates/skills/new-project.md). Deterministic, no Claude call needed.
//
// Differences from the skill, because projects live in a company folder instead of an Obsidian vault:
//   - root is COMPANY_XXX/projects/<Project Name>/ instead of 03 Projects/<Project Name>/
//   - paths inside commands are relative to the project folder (agents run with cwd = project folder)
//   - hooks use $CLAUDE_PROJECT_DIR so they work from any working directory
//   - templates/project/_claude/ is written as .claude/ in the new project
//   - step 11 (root CLAUDE.md of the vault) becomes: register the project in COMPANY_XXX/projects/index.json
//
// CLI:  node server/scaffold-project.mjs --root "D:\Companies\COMPANY_X" --answers answers.json [--dry-run]
// answers.json: { name, team, description, shipped, people, process: [..], rules: [..], role? }

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(APP_ROOT, 'templates', 'project');

const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date(); // local date, like the journal entries
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Folder names for a project, numbered input -> process -> output, then the utility folders. */
export function planFolders(process) {
  const steps = process && process.length ? process : ['Ideas', 'In Progress', 'Done'];
  const proc = steps.map((name, i) => `${pad(i)} ${name.trim()}`);
  const n = steps.length;
  return {
    process: proc,
    system: `${pad(n)} System`,
    skills: `${pad(n + 1)} Skills`,
    attach: `${pad(n + 2)} Attachments`,
    iteration: `${pad(n + 3)} Iteration Logs`,
    journal: `${pad(n + 4)} Journal`,
  };
}

/**
 * Claude Code keeps transcripts and auto memory in ~/.claude/projects/<dir>, where <dir> is the working
 * directory with every non-alphanumeric character replaced by "-" (case kept; names over 200 characters
 * are truncated with a hash appended, which we do not reproduce here).
 */
export function memorySlug(absProjectDir) {
  return absProjectDir.replace(/[^A-Za-z0-9]/g, '-');
}

function fill(text, vars) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function claudeMd(a, f, vars) {
  const processSteps = (a.process?.length ? a.process : ['Ideas', 'In Progress', 'Done']).map((s, i) => `${i + 1}. **${s}** → \`${f.process[i]}/\``).join('\n');
  const folderRows = [
    ...f.process.map((p, i) => `| \`${p}/\` | ${i === 0 ? 'Input' : i === f.process.length - 1 ? 'Output' : 'Proses'}: ${p.slice(3)} |`),
    `| \`${f.system}/\` | Scripts, config, proses reusable, **IMPLEMENTATION_BRIEF.md** |`,
    `| \`${f.system}/hooks/\` | Hook scripts untuk update journal otomatis |`,
    `| \`${f.skills}/\` | Skill lokal dalam markdown (BUKAN Claude Code slash command) |`,
    `| \`${f.attach}/Knowledge References/\` | Material EKSTERNAL: paper, buku, teori, transcript, dokumentasi pihak ketiga |`,
    `| \`${f.attach}/Project References/\` | Material INTERNAL: blueprint, schema, spec, arsitektur, template |`,
    `| \`${f.iteration}/\` | Catatan apa yang perlu diperbaiki |`,
    `| \`${f.journal}/\` | Research journey: DECISIONS, RESEARCH, SESSIONS |`,
    `| \`${f.journal}/code-log/\` | Log perubahan kode otomatis (write-only) |`,
  ].join('\n');
  const rules = (a.rules || []).filter(Boolean).map((r) => `- ${r}`).join('\n');
  const people = a.people && !/^(just me|hanya saya|saya sendiri|solo)$/i.test(a.people.trim()) ? `## Key People\n\n${a.people.trim()}\n\n` : '';
  return `---
title: ${a.name}
type: instructions
project: "[[${a.name}]]"
created: ${vars.DATE}
tags:
  - instructions
  - project/${vars.SLUG}
---

# ${a.name}

${a.description?.trim() || '<!-- TODO: isi deskripsi project -->'}

## Peran Claude

${a.role?.trim() || `Tim ${a.team || ''} mengerjakan project ini lewat OfficeX. Manajer tim memecah pekerjaan, agent mengeksekusi, dan semua keputusan serta temuan dicatat di journal.`}

**Prime directive:** ${a.shipped?.trim() || '<!-- TODO: isi definisi "shipped" -->'}
Kalau sesi mulai drift tanpa kemajuan ke arah output di atas, nudge kembali: "Apakah ini membawa kita lebih dekat ke ${a.shipped ? 'target shipped' : 'output akhir'}?"

## Proses Kerja

${processSteps}
${a.process?.length ? '' : '\n<!-- TODO: proses default, sesuaikan saat alurnya lebih jelas -->\n'}
${people}## Folder Structure

| Folder | Isi |
|---|---|
${folderRows}

## Rules & Conventions

- **\`(C)\` prefix** — File yang dibuat Claude di-prefix \`(C)\` supaya jelas AI-generated.
- **Editing rule** — Sebelum edit file tanpa prefix \`(C)\`, minta izin dulu.
- **Skills** — Reusable scripts/automations disimpan sebagai markdown di folder Skills, BUKAN sebagai Claude Code skill.
- **Wikilinks** — Pakai \`[[wikilinks]]\` untuk cross-reference antar file project. Pakai backtick path untuk lokasi file yang Claude Code harus action.
- **Knowledge vs Project References** — Material EKSTERNAL masuk \`${f.attach}/Knowledge References/\`. Material INTERNAL masuk \`${f.attach}/Project References/\`.
- **Proyektor** — Chart atau gambar yang perlu dilihat owner ditampilkan dengan tool \`show_on_projector\`, simpan filenya di folder output project.
${rules}

## Skills Inventory

Project ini punya 9 slash commands. Daftar lengkap dan kapan dipakai ada di [[COMMANDS]].

| Phase | Command | Kapan dipakai |
|---|---|---|
| Discovery | \`/index-reference\` | Setelah drop file referensi baru ke Knowledge References |
| Discovery | \`/auto-research\` | Stuck atau perlu cari gap baru via web search |
| Discovery | \`/research\` | Log finding manual (single insight) |
| Decision | \`/decision\` | Setelah pilih arah teknis, strategis, atau metodologis |
| Decision | \`/build-brief\` | Setelah keputusan-keputusan terkumpul, sebelum eksekusi/build |
| Build | \`/start\` | Awal setiap sesi kerja (resume context) |
| Checkpoint | \`/journal\` | Akhir sesi ringan |
| Checkpoint | \`/commit-discussion\` | Akhir sesi penting (auto-capture + memory sync) |
| Setup | \`/setup-journal\` | Setelah upgrade scaffold atau re-init |

## Project Map

Lihat [[MAP]] untuk file relationship lengkap dan when-to-read-what guide.

## Research Journal

- Decisions: \`${f.journal}/DECISIONS.md\` → [[DECISIONS]]
- Research findings: \`${f.journal}/RESEARCH.md\` → [[RESEARCH]]
- Recent sessions: \`${f.journal}/SESSIONS.md\` → [[SESSIONS]]
- Implementation brief: \`${f.system}/IMPLEMENTATION_BRIEF.md\` (dibuat via \`/build-brief\`)
- Code change log (\`${f.journal}/code-log/\`) bersifat write-only — hanya dibaca kalau diminta eksplisit.

## Memory System

Claude punya memory persistent di:
\`\`\`
~/.claude/projects/${vars.MEMORY_SLUG}/memory/
\`\`\`

File \`MEMORY.md\` di lokasi tersebut adalah index yang auto-loaded ke context setiap session start. \`/commit-discussion\` akan otomatis update \`project_${vars.SLUG}_status.md\` di lokasi tersebut.

## Current Status

> **Last updated:** ${vars.DATE}
> **Status:** Baru dibuat — getting started.

<!-- TODO: Update section ini saat project berkembang -->
`;
}

function mapMd(a, f, vars) {
  const proc = f.process.map((p) => `| \`${p}/\` | ${p.slice(3)} |`).join('\n');
  return `---
title: Map — ${a.name}
type: map
project: "[[${a.name}]]"
created: ${vars.DATE}
related:
  - "[[CLAUDE]]"
  - "[[COMMANDS]]"
tags:
  - map
  - navigation
---

# Map — ${a.name}

Navigation guide untuk project ini. Update file ini saat ada file baru atau relationship berubah.

## Core Files

| File | Purpose | Link |
|---|---|---|
| \`CLAUDE.md\` | Project instructions, peran Claude, conventions | [[CLAUDE]] |
| \`COMMANDS.md\` | Available slash commands per lifecycle phase | [[COMMANDS]] |
| \`MAP.md\` | File ini — navigation dan file relationships | [[MAP]] |

## Journal Files

| File | Purpose | Kapan dibaca | Link |
|---|---|---|---|
| \`${f.journal}/DECISIONS.md\` | Semua keputusan: what, why, alternatives | "Kenapa X diputuskan?" | [[DECISIONS]] |
| \`${f.journal}/RESEARCH.md\` | Research findings dan impact ke project | "Apa yang kita tahu tentang Y?" | [[RESEARCH]] |
| \`${f.journal}/SESSIONS.md\` | Last 5 sessions (rolling) | Awal setiap sesi baru | [[SESSIONS]] |
| \`${f.journal}/code-log/\` | Auto code change log per bulan | Hanya kalau diminta eksplisit | — |

## System & Implementation

| File | Purpose | Link |
|---|---|---|
| \`${f.system}/IMPLEMENTATION_BRIEF.md\` | Single source of truth keputusan teknis | [[IMPLEMENTATION_BRIEF]] |
| \`${f.system}/hooks/log_change.py\` | PostToolUse hook → code-log | — |
| \`${f.system}/hooks/log_session.py\` | Stop hook → SESSIONS heartbeat | — |

## Attachments

| Sub-folder | Isi | Wikilink pattern |
|---|---|---|
| \`${f.attach}/Knowledge References/\` | Material eksternal: paper, theory, book, video summary, third-party docs | \`[[Knowledge References/filename\\|Title]]\` |
| \`${f.attach}/Project References/\` | Material internal project: blueprint, schema, spec, design outline, template | \`[[Project References/filename\\|Title]]\` |

## Process Folders

| Folder | Isi |
|---|---|
${proc}

## How Files Relate

- [[DECISIONS]] ← backed by findings in → [[RESEARCH]]
- [[RESEARCH]] ← may lead to decisions in → [[DECISIONS]]
- [[SESSIONS]] ← summarizes work referencing → [[DECISIONS]] dan [[RESEARCH]]
- [[IMPLEMENTATION_BRIEF]] ← synthesizes both → [[DECISIONS]] + [[RESEARCH]]
- [[CLAUDE]] → points ke semua file yang Claude perlu tahu
- [[MAP]] → adalah index dari semua di atas

## When to Read What

- **Mulai sesi baru** → jalankan \`/start\` (auto-loads [[SESSIONS]], [[RESEARCH]], [[DECISIONS]], [[IMPLEMENTATION_BRIEF]])
- **"Kenapa X diputuskan?"** → baca [[DECISIONS]]
- **"Apa yang kita tahu tentang Y?"** → baca [[RESEARCH]]
- **"Apa keputusan teknis final?"** → baca [[IMPLEMENTATION_BRIEF]]
- **"Apa yang berubah di code?"** → baca \`${f.journal}/code-log/[YYYY-MM].md\` (tanya dulu)
- **"Struktur project apa?"** → kamu sudah di sini di [[MAP]]

## Wikilink Index

[[CLAUDE]] · [[COMMANDS]] · [[MAP]] · [[DECISIONS]] · [[RESEARCH]] · [[SESSIONS]] · [[IMPLEMENTATION_BRIEF]]
`;
}

function commandsMd(a, f, vars) {
  return `---
title: Commands — ${a.name}
type: commands
project: "[[${a.name}]]"
created: ${vars.DATE}
related:
  - "[[MAP]]"
  - "[[CLAUDE]]"
tags:
  - commands
  - reference
---

# Commands & Skills

Quick reference untuk semua slash commands di project ini, diurutkan berdasarkan lifecycle phase.
Lihat [[MAP]] untuk full file map.

---

## Lifecycle Phases

\`\`\`
[1. Bootstrap]  →  [2. Discovery]  →  [3. Decision]  →  [4. Build]  →  [5. Checkpoint]
                        ↑                                                       │
                        └───────────────── loop kembali ──────────────────────┘
\`\`\`

---

## Phase 1: Bootstrap

| Command | Purpose |
|---|---|
| \`new-project\` (OfficeX) | Create project baru (dipakai untuk scaffold project ini) |
| \`/setup-journal\` | Re-init atau upgrade journal infrastructure |

## Phase 2: Discovery

| Command | Purpose | Output |
|---|---|---|
| \`/index-reference\` | Batch-index semua PDF/paper di \`Knowledge References/\` ke RESEARCH.md | Entries baru di RESEARCH.md |
| \`/auto-research\` | Identifikasi gap → analisis data → web search → fetch → save → update RESEARCH.md → synthesis | Findings baru + saran eksperimen |
| \`/research\` | Log satu finding manual (paper, eksperimen, observasi) | 1 entry di RESEARCH.md |

## Phase 3: Decision

| Command | Purpose | Output |
|---|---|---|
| \`/decision\` | Log satu keputusan (teknis, strategis, atau metodologis) dengan rationale | 1 entry di DECISIONS.md |
| \`/build-brief\` | Synthesize semua DECISIONS + RESEARCH ke implementation/execution brief | \`${f.system}/IMPLEMENTATION_BRIEF.md\` |

## Phase 4: Build

| Command | Purpose | Behavior |
|---|---|---|
| \`/start\` | Resume sesi sebelumnya seperti \`claude --resume\` — load context, briefing, surface pending items | Session briefing ke chat |

(Pekerjaan aktual dilakukan inline tanpa command khusus. Pakai \`/research\` untuk log hasil signifikan.)

## Phase 5: Checkpoint

| Command | Purpose | Output |
|---|---|---|
| \`/journal\` | Session summary ringan ke SESSIONS.md (rolling 5) | 1 entry di SESSIONS.md |
| \`/commit-discussion\` | Heavy checkpoint: auto-extract decisions/findings/files/jobs, update 3 journal files + memory file | Multi-file update, session safe ditutup |

**Kapan pakai mana?**
- \`/journal\` — sesi singkat, manual, kamu tahu apa yang penting dicatat
- \`/commit-discussion\` — sesi panjang, banyak yang terjadi, mau auto-capture comprehensive

---

## Project-Specific Skills (di \`${f.skills}/\`)

_Belum ada skill project-specific. Tambahkan markdown file di \`${f.skills}/\` saat ada workflow berulang yang perlu di-formalize._
`;
}

function journalFile(kind, a, vars) {
  const meta = {
    DECISIONS: ['journal/decisions', 'Decisions', 'Keputusan terbaru di atas (newest-first).'],
    RESEARCH: ['journal/research', 'Research Findings', 'Findings kronologis (oldest-first).'],
    SESSIONS: ['journal/sessions', 'Recent Sessions', 'Rolling log — last 5 entries only.'],
  }[kind];
  return `---
title: ${meta[1]} — ${a.name}
type: ${meta[0]}
project: "[[${a.name}]]"
created: ${vars.DATE}
related:
  - "[[MAP]]"
tags:
  - journal
---

# ${meta[1]}

${meta[2]}

> **Project started:** ${vars.DATE}

---
`;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/**
 * Create the project. Returns { dir, files, memoryDir }.
 * Never overwrites an existing project folder.
 */
export function scaffoldProject(companyRoot, answers, { dryRun = false, home = os.homedir(), python = process.platform === 'win32' ? 'python' : 'python3' } = {}) {
  if (!answers?.name?.trim()) throw new Error('Project name is required.');
  const name = answers.name.trim().replace(/[<>:"/\\|?*]/g, '-');
  const dir = path.join(companyRoot, 'projects', name);
  if (fs.existsSync(dir)) throw new Error(`Project folder already exists: ${dir}`);

  const f = planFolders(answers.process);
  const slug = slugify(name);
  const vars = {
    PROJECT_NAME: name,
    DATE: today(),
    SLUG: slug,
    MEMORY_SLUG: memorySlug(path.resolve(dir)),
    SYSTEM: f.system,
    SKILLS: f.skills,
    ATTACH: f.attach,
    ITERATION: f.iteration,
    JOURNAL: f.journal,
    PYTHON: python,
  };
  const a = { ...answers, name };

  const files = new Map(); // relative path -> content
  const dirs = [
    ...f.process,
    f.system,
    `${f.system}/hooks`,
    f.skills,
    `${f.attach}/Knowledge References`,
    `${f.attach}/Project References`,
    f.iteration,
    f.journal,
    `${f.journal}/code-log`,
    '.claude/commands',
  ];
  files.set('CLAUDE.md', claudeMd(a, f, vars));
  files.set('MAP.md', mapMd(a, f, vars));
  files.set('COMMANDS.md', commandsMd(a, f, vars));
  for (const k of ['DECISIONS', 'RESEARCH', 'SESSIONS']) files.set(`${f.journal}/${k}.md`, journalFile(k, a, vars));
  for (const abs of walk(TEMPLATES)) {
    // templates keep .claude as _claude so editors and sync tools never treat them as live Claude config
    const rel = fill(path.relative(TEMPLATES, abs).split(path.sep).join('/'), vars).replace(/^_claude\//, '.claude/');
    files.set(rel, fill(fs.readFileSync(abs, 'utf8'), vars));
  }
  files.set(
    'project.json',
    JSON.stringify(
      {
        name,
        slug,
        team: answers.team ?? null,
        created: vars.DATE,
        phase: 'bootstrap',
        folders: f,
        description: answers.description ?? '',
        shipped: answers.shipped ?? '',
        people: answers.people ?? '',
        rules: answers.rules ?? [],
        scaffold: 'new-project skill (OfficeX)',
      },
      null,
      2,
    ) + '\n',
  );

  const memoryDir = path.join(home, '.claude', 'projects', vars.MEMORY_SLUG, 'memory');
  const memory = new Map([
    ['MEMORY.md', `# Memory Index — ${name}\n\n- [Project Status](project_${slug}_status.md) — status terkini, pending items, background jobs\n`],
    [
      `project_${slug}_status.md`,
      `---
name: project-${slug}-status
description: "Status terkini project ${name} — pending items, next steps, background jobs"
metadata:
  type: project
---

**Status per ${vars.DATE}:** Baru dibuat. Project structure di-scaffold oleh OfficeX (new-project skill).

## Pending / Next steps

- Lengkapi \`CLAUDE.md\` di bagian yang masih TODO
- Mulai phase Discovery: drop file referensi ke \`${f.attach}/Knowledge References/\` lalu jalankan \`/index-reference\`
- Atau langsung mulai kerja di folder process yang relevan

## Background jobs

None.

## Recent decisions yang affect global state

None — project baru dibuat.
`,
    ],
  ]);

  if (!dryRun) {
    for (const d of dirs) fs.mkdirSync(path.join(dir, d), { recursive: true });
    for (const [rel, body] of files) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body, 'utf8');
    }
    fs.mkdirSync(memoryDir, { recursive: true });
    for (const [rel, body] of memory) {
      const p = path.join(memoryDir, rel);
      if (!fs.existsSync(p)) fs.writeFileSync(p, body, 'utf8');
    }
    // company-level index of projects (replaces the skill's "update root CLAUDE.md" step)
    const indexFile = path.join(companyRoot, 'projects', 'index.json');
    const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { projects: [] };
    index.projects.push({ name, slug, team: answers.team ?? null, created: vars.DATE, path: `projects/${name}` });
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n', 'utf8');
  }

  return { dir, folders: f, files: [...files.keys()].sort(), dirs, memoryDir };
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const root = arg('--root');
  const answersFile = arg('--answers');
  if (!root || !answersFile) {
    console.error('Usage: node server/scaffold-project.mjs --root <company folder> --answers <answers.json> [--dry-run]');
    process.exit(1);
  }
  let res;
  try {
    res = scaffoldProject(root, JSON.parse(fs.readFileSync(answersFile, 'utf8')), { dryRun: process.argv.includes('--dry-run') });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Project: ${res.dir}`);
  res.dirs.forEach((d) => console.log(`  [dir]  ${d}/`));
  res.files.forEach((p) => console.log(`  [file] ${p}`));
  console.log(`Memory: ${res.memoryDir}`);
}
