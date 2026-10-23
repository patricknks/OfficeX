Skill ini meng-checkpoint diskusi yang sedang berjalan ke Research Journey journal,
sehingga session bisa di-close dengan aman dan di-resume cold oleh future Claude
(setelah window close, PC shutdown, atau context loss).

Update 4 hal sekaligus:
1. `{{JOURNAL}}/DECISIONS.md` (untuk setiap decision baru)
2. `{{JOURNAL}}/RESEARCH.md` (untuk setiap finding baru)
3. `{{JOURNAL}}/SESSIONS.md` (session summary checkpoint)
4. Memory file di `~/.claude/projects/<slug>/memory/project_<slug>_status.md`

Equivalent dengan `/decision` + `/research` + `/journal` + memory sync dalam satu workflow,
dengan emphasis tambahan pada **session resumability**.

**Penting:** JANGAN tanya user apapun. JANGAN minta konfirmasi. Auto-derive semua dari
conversation history. User sudah tahu apa yang dia lakukan — skill ini hanya capture
kemajuan ke journal.

---

## Step 1: Inventory conversation

Baca seluruh conversation. Ekstrak:
- **Decisions**: pilihan arsitektur / strategi / pendekatan / metodologi yang membentuk arah kerja ke depan
- **Research findings**: hasil eksperimen, pengukuran, observasi, insight, referensi baru
- **File changes**: file baru, refactor, fix, schema/spec update, dokumen edit (catat path eksak)
- **Background jobs / running state**: proses long-running, validation script, sweep, DB job, render, build pipeline — apapun yang masih jalan
- **Open questions / pending decisions**: hal yang menunggu input user atau defer-until-X
- **Verified facts**: hal yang dikonfirmasi selama session (tests passing, integrity checks, review approved, dll)

Baca `{{JOURNAL}}/DECISIONS.md` dan `{{JOURNAL}}/RESEARCH.md` dulu untuk hindari
duplikat dari entry yang sudah di-log earlier dalam session yang sama.

## Step 2: Tulis ke DECISIONS.md

Untuk setiap decision BARU yang belum ada di file, append di TOP file (newest-first,
antara `> **Project started:**` dan entry terbaru yang sudah ada):

```
## [current datetime] — [judul singkat]

**Decision:** [apa yang diputuskan — konkret]
**Rationale:** [kenapa — include reasoning chain, bukan hanya kesimpulan]
**Alternatives considered:** [apa yang ditolak dan kenapa, atau "N/A"]
**Open questions:** [yang masih uncertain atau pending, atau "None"]
**Related research:** [[RESEARCH#[slugified-finding-title]]] ← hanya kalau applicable

---
```

## Step 3: Tulis ke RESEARCH.md

Untuk setiap finding BARU, append di AKHIR file (chronological, oldest-first):

```
## [current datetime] — [judul singkat]

**Finding:** [core insight dalam 1-3 kalimat]
**Type:** `knowledge` atau `project-reference` atau `experiment`
**Source:** [[Knowledge References/filename|Title]] | [[Project References/filename|Title]] | [URL Title](url) | deskripsi eksperimen/observasi
**Quote/evidence:** "[kutipan, data point, observasi konkret, atau measurement yang relevan]"
**Impact on project:** [bagaimana ini mengubah arah atau design]
**Related decision:** [[DECISIONS#[slugified-decision-title]]] ← hanya kalau applicable

---
```

## Step 4: Append checkpoint ke SESSIONS.md

Append di TOP (newest-first), dengan format CHECKPOINT comprehensive. Field `What we worked on`
dan `Next steps` harus cukup detail supaya future Claude yang baca cold bisa langsung resume
tanpa nanya user.

```
## [current datetime] SESSION — [one-line summary]

**What we worked on:**
- [bullet detail — narasikan kerja aktual termasuk attempts yang gagal dan iterasi,
  supaya future Claude paham journey, bukan hanya outcome]

**Decisions made:**
- [[DECISIONS#title]] - [gist satu baris]
- ... atau "None"

**Research logged:**
- [[RESEARCH#title]] - [gist satu baris]
- ... atau "None"

**Files changed:**
- `path/to/file` - [sifat perubahan: NEW / refactor / fix / config / dll]
- ... atau "None"

**Background jobs / running state:**
- [nama job + cara monitor / kapan check + estimasi completion]
- ... atau "None"

**Open questions / pending decisions:**
- [yang menunggu input user, defer until X, atau unresolved]
- ... atau "None"

**Next steps (resume here):**
- [item actionable spesifik — "Run X command", "Verify Y output", "Continue Z at file:line"]
- Include cukup context supaya kerja langsung resume tanpa re-derive state

---
```

Lalu **trim SESSIONS.md ke maksimum 5 entries** dengan menghapus entry tertua.

## Step 5: Update memory file di Claude home

Lokasi memory: `~/.claude/projects/<project-slug>/memory/` (path lengkap ada di assistant's
system prompt di awal session — cek section "auto memory").

Update `project_<slug>_status.md`. Yang di-update:

- **Status line** — refresh tanggal + 1-baris summary state terkini
- **Pending / next steps section** — sync dengan field `Next steps` di SESSIONS yang baru ditulis
- **Background jobs section** — kalau ada job running, tambah/update info
- **Section lain** — hanya kalau ada perubahan fundamental yang sudah di-decide (architecture, scope)

Kalau file memory belum ada, buat baru dengan frontmatter standar:
```
---
name: project-<slug>-status
description: "[1-baris deskripsi tujuan memory]"
metadata:
  type: project
---

**Status per [tanggal]:** [summary state]

## Pending / Next steps
- [list]

## Background jobs
- [list, atau "None"]

## Recent decisions yang affect global state
- [list, atau "None"]
```

Juga update `MEMORY.md` index di lokasi yang sama kalau perlu (kalau ada memory file baru
yang ditambah). Format index:
```
# Memory Index — {{PROJECT_NAME}}

- [Project Status](project_<slug>_status.md) — [1-baris hook]
- [Other memory](filename.md) — [1-baris hook]
```

Jangan update memory file lain (user preferences, philosophy, reference) kecuali ada
perubahan signifikan yang sudah di-decide dan di-log di DECISIONS.

## Step 6: Output ringkas

Tulis ke user **maksimum 6 baris**, formatnya:
```
Checkpoint commit:
- DECISIONS: N entries baru ([judul ringkas])
- RESEARCH: N entries baru ([judul ringkas])
- SESSIONS: 1 entry baru ([X] total)
- Memory: project_<slug>_status.md updated
- Background: [singkat — kalau ada job running, sebutkan]
Session aman ditutup. Resume via `/start` atau `claude --resume`.
```

JANGAN tanya pertanyaan. JANGAN minta konfirmasi. JANGAN saran next step di luar yang
sudah di-log di SESSIONS. Skill ini selesai setelah output ringkas di atas.
