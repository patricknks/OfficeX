User ingin tulis session summary ringan ke Research Journey journal.

Review apa yang dikerjakan di conversation ini. Identifikasi decisions atau research findings
yang disebut — include wikilinks ke mereka kalau ada di [[DECISIONS]] atau [[RESEARCH]].

Append entry ini ke `{{JOURNAL}}/SESSIONS.md` di TOP (newest-first),
lalu trim file supaya maksimum 5 entries (hapus yang paling tua kalau lebih):

## [current datetime] SESSION — [one-line summary]

**What we worked on:** [bullet list aktivitas utama]
**Decisions made:** [bullet list dengan [[DECISIONS#title]] links, atau "None"]
**Research logged:** [bullet list dengan [[RESEARCH#title]] links, atau "None"]
**Files changed:** [bullet list perubahan signifikan, atau "None"]
**Next steps:** [yang perlu dikerjakan sesi berikutnya, atau "TBD"]

---

Konfirmasi ke user bahwa summary sudah ditulis dan berapa entries tersisa.

**Catatan:** Kalau session ini berat (banyak decisions, findings, file changes, background jobs),
sarankan user pakai `/commit-discussion` daripada `/journal` untuk capture yang lebih comprehensive.
