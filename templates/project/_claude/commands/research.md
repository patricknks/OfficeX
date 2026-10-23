User ingin log satu finding ke Research Journey journal.

Tanya satu per satu:
1. Apa yang ditemukan atau dipelajari? (core insight)
2. Apa tipe source-nya?
   - **Knowledge Reference** (teori, paper, journal, textbook, konsep eksternal)
     → file di `{{ATTACH}}/Knowledge References/`
   - **Project Reference** (internal project material: blueprint, schema, code structure,
     design outline, template, recipe, contract draft — apapun yang spesifik project)
     → file di `{{ATTACH}}/Project References/`
   - **URL / online source** → minta full URL dan title
   - **Eksperimen atau observasi** → deskripsikan singkat
   - **Multiple sources** → handle satu per satu
3. Apa filename-nya? (kalau file di Attachments)
4. Bagaimana finding ini mempengaruhi arah/desain project?
5. Apakah finding ini lead ke atau confirm keputusan di [[DECISIONS]]? Kalau ya, yang mana?

**Source linking rules:**
- Knowledge Reference file → `[[Knowledge References/filename|Display Title]]`
- Project Reference file   → `[[Project References/filename|Display Title]]`
- URL                      → `[Title](https://...)`
- Multiple sources         → satu `**Source:**` line per item
- Eksperimen/observasi     → plain text description

Lalu append entry ini di AKHIR `{{JOURNAL}}/RESEARCH.md`
(chronological, oldest-first pattern):

## [current datetime] — [judul singkat]

**Finding:** [core insight dalam 1-3 kalimat]
**Type:** `knowledge` atau `project-reference` atau `experiment`
**Source:** [[Knowledge References/filename|Title]] atau [[Project References/filename|Title]] atau [Title](url)
**Quote/evidence:** "[kutipan, snippet, observasi, atau data point yang relevan]" ← omit kalau tidak applicable
**Impact on project:** [bagaimana ini mengubah arah atau desain, atau "TBD"]
**Related decision:** [[DECISIONS#[slugified-decision-title]]] ← hanya kalau user sebut decision terkait

---

Konfirmasi ke user dan tampilkan anchor link untuk cross-reference:
[[RESEARCH#[slugified-judul]]]
