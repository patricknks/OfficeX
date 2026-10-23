Jalankan siklus research otomatis: identifikasi gap dari knowledge yang ada,
analisis data asli, cari sumber baru di internet, simpan ke Attachments,
update RESEARCH.md, lalu berikan synthesis dan saran eksperimen berikutnya.

---

## Step 1: Identifikasi gap dari RESEARCH.md

Baca `{{JOURNAL}}/RESEARCH.md`.

Dari semua entries yang ada, identifikasi:

- **Knowledge gaps** — pertanyaan teknis yang muncul dari findings tapi belum dijawab.
  Ciri-cirinya: field "Impact on project: TBD", atau findings yang menyebut konsep
  tanpa ada follow-up entry yang membahasnya lebih dalam.
- **Asumsi yang belum divalidasi** — klaim di findings yang belum diuji dengan data asli.
- **Area yang belum tercakup** — topik yang logis berkaitan dengan domain project ini
  tapi belum ada entry-nya sama sekali.

Tulis daftar internal (jangan tampilkan ke user dulu):
```
GAP LIST:
- [gap 1]: [deskripsi singkat]
- [gap 2]: ...
```

## Step 2: Identifikasi open questions dari DECISIONS.md

Baca `{{JOURNAL}}/DECISIONS.md`.

Dari semua entries, identifikasi:

- Field "Open questions" yang belum terjawab
- Keputusan yang diambil dengan alasan "TBD" atau "perlu validasi"
- Keputusan yang mungkin perlu direvisi berdasarkan gap dari Step 1

Tambahkan ke daftar internal:
```
OPEN QUESTIONS:
- [question 1]: berasal dari [[DECISIONS#slug]]
- [question 2]: ...
```

## Step 3: Review material lokal yang relevan (kalau ada)

Cek material internal project yang bisa membantu jawab gap atau open questions dari Step 1–2.
Bentuk material tergantung tipe project:

- **Data/ML/Analytics project**: script analisis di `{{SYSTEM}}/`, dataset/output di
  process folder. Jalankan script dengan `python "{{SYSTEM}}/[script_name].py"` atau baca
  output langsung (CSV, JSON, log files).
- **Writing/Research project**: dokumen draft, notes, outline di process folder. Baca dan
  identifikasi area yang sudah dibahas vs yang masih kosong.
- **Design/Planning project**: blueprint, mockup, spec di `Project References/`. Review
  konsistensi vs gap baru.
- **Skill/Learning project**: progress log, exercises, attempts di process folder.

Untuk setiap material relevan, ekstrak temuan konkret. Catat:
```
LOCAL FINDINGS:
- [observasi/metric/insight 1]: [detail]
- [observasi/metric/insight 2]: ...
```

Kalau tidak ada material lokal yang relevan (project masih awal, atau jenis project tidak
generate output yang reviewable), catat:
```
LOCAL FINDINGS: tidak ada material lokal yang relevan saat ini — langsung ke web search
```

## Step 4: WebSearch untuk setiap gap dan open question

Untuk setiap item di GAP LIST dan OPEN QUESTIONS, buat query pencarian spesifik.

**Panduan query:**
- Kombinasikan topik teknis + konteks: `"[topik] [domain project]"` lebih baik dari topik saja
- Validasi findings: tambah `"empirical"`, `"study"`, `"results"`, `"benchmark"`
- Method baru: tambah `"2022 OR 2023 OR 2024 OR 2025"` untuk paper terbaru
- Maksimal 2 query per gap — pilih yang paling spesifik

Jalankan WebSearch untuk setiap query. Pilih maksimal **3 sumber terbaik** per gap.
Prioritaskan:
1. Paper akademik (arxiv, IEEE, Springer, Elsevier)
2. Dokumentasi teknis resmi
3. Artikel teknis mendalam

Hindari: forum diskusi umum, artikel SEO, berita pasar.

## Step 5: WebFetch dan simpan ke Knowledge References

Untuk setiap sumber yang dipilih:

### 5a. Fetch konten
WebFetch URL. Ekstrak: judul lengkap, penulis & tahun, abstract/ringkasan utama,
metodologi utama (kalau paper), temuan/kesimpulan utama, URL asli.

### 5b. Simpan summary
Buat file di `{{ATTACH}}/Knowledge References/` dengan nama:
`[YYYY-MM-DD]-[slugified-title].md`

Isi:
```markdown
---
title: [Judul lengkap]
type: web-reference
source_url: [URL asli]
authors: [penulis, tahun — atau "N/A"]
fetched: [tanggal fetch YYYY-MM-DD]
related_gap: [gap dari Step 1 yang memicu pencarian ini]
project: "[{{PROJECT_NAME}}]"
tags:
  - web-reference
  - [topik relevan]
---

# [Judul lengkap]

**Source:** [URL asli]
**Authors/Year:** [atau N/A]
**Fetched:** [tanggal]

## Abstract / Summary
[ringkasan 3-5 kalimat]

## Key Methods
[bullet list metode/teknik utama]

## Key Findings / Conclusions
[bullet list temuan utama]

## Relevant to This Project
[koneksi spesifik ke project — 2-3 kalimat]

## Direct Quotes
> "[kutipan paling relevan]"

---
*Auto-fetched by /auto-research*
```

### 5c. Kalau sumber adalah PDF langsung (URL .pdf)
Download:
```bash
curl -L "[URL]" -o "{{ATTACH}}/Knowledge References/[YYYY-MM-DD]-[slug].pdf"
```
Lalu buat file summary `.md` dengan nama sama.

## Step 6: Tulis findings baru ke RESEARCH.md

Untuk setiap sumber yang sudah di-fetch, tulis satu entry baru ke RESEARCH.md:

```
## [current datetime] — [short title deskriptif]

**Finding:** [core insight 2-4 kalimat]
**Type:** `knowledge`
**Source:** [[Knowledge References/[filename]|[Judul singkat]]]
**Authors/Year:** [atau N/A]
**Quote/evidence:** "[kutipan paling relevan]"
**Gap addressed:** [gap dari Step 1 yang dijawab]
**Impact on project:** [implikasi konkret, atau "TBD" kalau belum jelas]
**Related decision:** [[DECISIONS#slug]] ← hanya kalau ada

---
```

Juga tulis entry untuk setiap temuan dari local material review (Step 3) yang signifikan:
```
## [current datetime] — [short title]

**Finding:** [temuan, observasi, atau insight]
**Type:** `experiment`
**Source:** Local material review — `[path ke script/dokumen/output]`
**Quote/evidence:** "[output, kutipan dokumen, metric, atau observasi konkret]"
**Gap addressed:** [gap yang dijawab]
**Impact on project:** [implikasi konkret]
**Related decision:** ← kosongkan kalau belum ada

---
```

## Step 7: Synthesis report ke chat

Setelah semua entries ditulis, buat laporan ke chat (BUKAN ke file):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUTO-RESEARCH REPORT — [tanggal]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Gap yang ditemukan
[list gap dari Step 1-2]

## Sumber baru yang ditemukan
[list file yang disimpan di Knowledge References]

## Findings baru yang ditambahkan
[list judul entry yang ditulis ke RESEARCH.md]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Synthesis & Insight Baru

[Tulis 3-5 paragraf. Gabungkan:
- Apa yang sudah diketahui dari RESEARCH/DECISIONS sebelumnya
- Apa yang baru ditemukan dari web search dan Python analysis
- Pola atau koneksi baru yang muncul
- Apakah ada keputusan yang perlu direvisi?]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Saran Eksperimen Berikutnya

Berdasarkan eksperimen terakhir di SESSIONS dan findings hari ini, urut prioritas:

**1. [Nama eksperimen]**
Hipotesis: [apa yang ingin dibuktikan]
Metode: [langkah konkret — apa yang harus dilakukan, dengan tools/material apa, dengan parameter atau scope seperti apa]
Dasar: [[RESEARCH#slug]] + [[DECISIONS#slug]]
Estimasi effort: [rendah / sedang / tinggi]

**2. [Nama eksperimen]**
...

**3. [Nama eksperimen]**
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Action Items

- [ ] Review findings baru di RESEARCH.md
- [ ] Kalau ada findings yang memicu keputusan arsitektur → jalankan `/decision`
- [ ] Update IMPLEMENTATION_BRIEF.md kalau ada perubahan teknis (jalankan `/build-brief` lagi)
- [ ] Pilih eksperimen berikutnya dan jalankan `/start` di sesi berikutnya
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
