Persiapkan context untuk sesi kerja baru di project {{PROJECT_NAME}}. Goal: kasih user
experience seperti `claude --resume` — full context restoration, surface pending items,
ready to continue dari titik berhenti tanpa friction.

---

## Step 1: Load core context (parallel reads)

Baca file-file berikut secara PARALLEL untuk efisiensi (satu message, multiple Read calls):

1. `CLAUDE.md` — project instructions, conventions, folder structure
2. `{{SYSTEM}}/IMPLEMENTATION_BRIEF.md` — keputusan teknis final
   - Kalau file belum ada, catat: "IMPLEMENTATION_BRIEF.md belum dibuat. Jalankan `/build-brief` setelah ada cukup decisions."
3. `{{JOURNAL}}/SESSIONS.md` — last 5 sessions
4. `{{JOURNAL}}/RESEARCH.md` — semua findings
5. `{{JOURNAL}}/DECISIONS.md` — semua keputusan

Memory file dari `~/.claude/projects/<slug>/memory/` sudah auto-loaded oleh Claude Code,
tidak perlu Read manual. Tapi kalau ada `MEMORY.md` di sana, baca untuk lihat index lengkap.

## Step 2: Detect state changes & pending items

Setelah load context, scan untuk hal-hal berikut:

### 2a. Files changed since last session
Cek timestamp `Last updated` di CLAUDE.md vs current date. Kalau ada gap > 2 hari,
sebutkan: "Last session [N] hari yang lalu — perlu re-check kondisi data/file kalau ada."

### 2b. Background jobs / running state
Cek entry SESSIONS.md terbaru di field `Background jobs / running state`. Kalau ada job
yang disebut masih running, surface ke briefing dengan instruksi cara verify status.

### 2c. Open questions / pending decisions
Scan field `Open questions / pending decisions` di SESSIONS terbaru DAN field `Open questions`
di DECISIONS.md. Kompilasi jadi 1 list.

### 2d. Next steps dari sesi sebelumnya
Ambil dari field `Next steps (resume here)` di SESSIONS.md entry terbaru.

### 2e. Implementation Brief staleness check

Cek apakah `{{SYSTEM}}/IMPLEMENTATION_BRIEF.md` masih sinkron dengan DECISIONS terbaru:

1. Dari `IMPLEMENTATION_BRIEF.md`, ambil tanggal di baris `> **Terakhir diupdate:** [tanggal]`.
   - Kalau file masih placeholder (ada string `STATUS: PLACEHOLDER`), catat sebagai "brief belum dibuat".
2. Dari `DECISIONS.md`, hitung berapa entries yang punya datetime LEBIH BARU dari
   tanggal "Terakhir diupdate" brief.
3. Klasifikasi staleness:
   - **Fresh**: 0 decisions baru — tidak perlu warning.
   - **Stale**: 1-3 decisions baru — sebut di briefing sebagai info ringan.
   - **Very stale**: 4+ decisions baru ATAU gap > 30 hari — sebut sebagai warning kuat.
   - **Missing**: brief masih placeholder dan DECISIONS sudah punya ≥ 3 entries — suggest
     buat brief pertama kali.

Hasil staleness check di-surface di briefing (Step 3) di section `Implementation Brief Status`.

## Step 3: Buat session briefing ke chat

Format briefing supaya user bisa langsung tahu di mana mereka berhenti dan apa yang
perlu di-resume. Tulis ke chat (BUKAN ke file):

```
## Session Briefing — [tanggal hari ini]

**Project phase:** [Discovery / Decision / Build / Checkpoint — infer dari SESSIONS terbaru]
**Last session:** [tanggal dari SESSIONS terbaru] — [N] hari lalu

### Yang sudah selesai (dari last sessions)
- [bullet 3-5 item paling impactful dari SESSIONS terakhir]

### Pending / Open Questions
- [list dari Step 2c, atau "Tidak ada"]

### Background jobs / running state
- [list dari Step 2b dengan instruksi verify, atau "Tidak ada job berjalan"]

### Next steps (resume here)
- [bullet detail dari field "Next steps" SESSIONS terbaru]
- [include cukup context supaya kerja langsung resume tanpa re-derive state]

### Implementation Brief Status
[Pilih salah satu berdasarkan hasil Step 2e:]
- **Fresh** — "✓ IMPLEMENTATION_BRIEF.md sinkron dengan keputusan terbaru."
- **Stale** — "ℹ️ Ada N decisions baru sejak brief terakhir diupdate ([tanggal]). Pertimbangkan jalankan `/build-brief` setelah sesi ini kalau decisions itu affect arsitektur."
- **Very stale** — "⚠️ IMPLEMENTATION_BRIEF.md sudah outdated — N decisions baru sejak [tanggal] ([X] hari lalu). Disarankan jalankan `/build-brief` SEBELUM mulai pekerjaan aktual supaya tidak ambil keputusan berbasis info usang."
- **Missing** — "⚠️ IMPLEMENTATION_BRIEF.md belum dibuat tapi sudah ada N decisions. Jalankan `/build-brief` untuk synthesize jadi single source of truth."

### File yang kemungkinan relevan untuk sesi ini
- [list file paths based on next steps — JANGAN load dulu, hanya sebutkan]
```

## Step 4: Tunggu instruksi user

Setelah briefing, tanya satu pertanyaan saja:

"Lanjut dari Next Steps di atas, atau ada yang mau dikerjakan duluan?"

JANGAN mulai action apapun, JANGAN load file tambahan, JANGAN tulis code atau dokumen,
sampai user respons. Tujuan `/start` adalah hand off context dengan rapi, bukan auto-execute.

---

## Catatan implementation

- Step 1 harus PARALLEL Read calls dalam satu message untuk speed.
- Kalau salah satu file belum ada (project masih awal), skip dengan note di briefing
  bukan error keras. Project baru mungkin belum punya RESEARCH/DECISIONS isi.
- Briefing harus self-contained — user (atau future Claude) yang baca briefing harus
  bisa langsung tahu kondisi project tanpa baca file lain.
- Staleness check (Step 2e) hanya **menyarankan**, JANGAN auto-jalankan `/build-brief`.
  User pegang kontrol kapan rebuild — `/start` adalah baca-only.
- Kalau IMPLEMENTATION_BRIEF.md masih placeholder ATAU DECISIONS.md kosong, skip
  staleness check tanpa warning.
