User ingin index research papers dan files dari `{{ATTACH}}/Knowledge References/`
ke `{{JOURNAL}}/RESEARCH.md`. Ini batch operation — run through semua unindexed files
otomatis tanpa nanya satu per satu.

---

## Step 1: Discover files

List semua files di `{{ATTACH}}/Knowledge References/` (recursive).
Supported types: `.pdf`, `.txt`, `.md`, `.html`, `.epub`
Skip: folders, hidden files, files starting dengan `_`

## Step 2: Check yang sudah di-index

Baca `{{JOURNAL}}/RESEARCH.md`.
File dianggap **sudah ter-index** kalau filename-nya muncul di file dalam pattern wikilink:
`[[Knowledge References/filename` atau filename di dalam `[[...]]`.

Build dua list:
- `already_indexed` — skip ini
- `to_index` — proses ini

Report ke user:
```
Found [N] files di Knowledge References/
  Already indexed: [n] files
  To index: [n] files — processing...
```

Kalau `to_index` kosong, kasih tahu user semua sudah ter-index dan stop.

## Step 3: Process tiap unindexed file

Untuk setiap file di `to_index`:

### 3a. Read file
- `.pdf`: read full text content. Focus on abstract, introduction, conclusions, section headers.
  Kalau PDF panjang (>50 halaman), prioritaskan abstract + conclusions + struktur section.
- `.txt` / `.md` / `.html`: read full content.

### 3b. Extract dari content:
1. **Title** — judul paper/document (dari content, bukan filename)
2. **Authors & year** — kalau available
3. **Core finding** — 2-4 kalimat: claim utama, hasil, atau kontribusi
4. **Relevance to this project** — koneksi ke domain project. Spesifik.
5. **Key concepts or terms introduced** — maksimum 5 terms yang worth knowing
6. **Quotable excerpt** — satu kalimat atau passage pendek yang capture core idea

### 3c. Append entry ke RESEARCH.md:

```
## {{DATE}} — [Paper Title atau Document Title]

**Finding:** [core finding 2-4 kalimat]
**Type:** `knowledge`
**Source:** [[Knowledge References/[filename]|[Paper Title]]]
**Authors/Year:** [authors, year] ← omit kalau tidak ditemukan
**Key concepts:** [comma-separated list maksimum 5 terms]
**Quote/evidence:** "[quotable excerpt]"
**Relevance to project:** [koneksi spesifik ke domain project]
**Impact on project:** TBD — needs review
**Related decision:** ← kosongkan, isi manual nanti kalau relevan

---
```

### 3d. Setelah tiap file, print status:
```
✓ Indexed: [filename] → "[[RESEARCH#paper-title-slug]]"
```

## Step 4: Summary report

Setelah semua processed:

```
Indexing complete.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Newly indexed : [n] files
Already existed: [n] files
Errors        : [n] files (list kalau ada)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next step: Review RESEARCH.md dan isi field "Impact on project: TBD" di entries
yang kamu punya opini lebih kuat dari summary Claude.
Jalankan /decision kalau ada findings yang memicu design decision.
```

## Important rules

- JANGAN overwrite atau modify existing entries di RESEARCH.md — append only.
- Kalau file tidak bisa di-read (corrupted, unsupported encoding), log sebagai error dan continue.
- JANGAN nanya user konfirmasi antara files — process full batch.
- Keep field "Finding" factual berdasarkan actual content, jangan fabricate.
- Kalau paper tidak directly relevant ke project, tetap index tapi tulis
  "Relevance to project: Indirect — [brief reason]" daripada paksa koneksi.
