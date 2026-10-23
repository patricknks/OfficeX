Baca seluruh research dan keputusan yang ada, lalu tulis implementation brief
ke `{{SYSTEM}}/IMPLEMENTATION_BRIEF.md`.

Brief ini adalah **single source of truth** untuk keputusan teknis/strategis project.
Pekerjaan dan eksperimen selanjutnya harus konsisten dengan brief ini.

---

## Step 1: Load semua knowledge sources

Baca file-file berikut (parallel reads kalau bisa):

1. `{{JOURNAL}}/RESEARCH.md` — seluruh research findings
2. `{{JOURNAL}}/DECISIONS.md` — seluruh keputusan yang sudah dibuat
3. Semua file di `{{ATTACH}}/Project References/` — internal blueprint, spec, schema, design outline (apapun yang spesifik project)
4. `CLAUDE.md` — untuk memahami scope dan goals project

## Step 2: Analisis dan sintesis

Sebelum menulis, lakukan analisis internal:

- Identifikasi semua keputusan teknis yang sudah final di DECISIONS.md
- Identifikasi semua findings di RESEARCH.md yang punya implikasi langsung ke pelaksanaan
  (bukan yang masih "TBD" atau "Indirect")
- Petakan struktur internal dari Project References (schema, blueprint, spec, outline — tergantung domain project)
- Identifikasi gap: hal yang perlu di-execute tapi belum ada keputusan eksplisit

## Step 3: Tulis IMPLEMENTATION_BRIEF.md

Buat atau overwrite `{{SYSTEM}}/IMPLEMENTATION_BRIEF.md`. Isi setiap section berdasarkan
yang benar-benar ada di knowledge sources — JANGAN mengarang. Tandai dengan
`<!-- TODO: belum ada keputusan -->` kalau suatu section tidak bisa diisi.

```markdown
---
title: Implementation Brief — {{PROJECT_NAME}}
type: implementation-brief
project: "[{{PROJECT_NAME}}]"
created: {{DATE}}
related:
  - "[[RESEARCH]]"
  - "[[DECISIONS]]"
  - "[[CLAUDE]]"
tags:
  - implementation
  - reference
---

# Implementation Brief — {{PROJECT_NAME}}

Dokumen ini adalah **single source of truth** untuk keputusan teknis implementasi.
Dibuat dari [[RESEARCH]] dan [[DECISIONS]]. Update dokumen ini setiap ada keputusan
arsitektur baru dengan jalankan `/build-brief` lagi.

> **Dibuat:** [today's date]
> **Terakhir diupdate:** [today's date]

---

## 1. Project Goal & Scope

[Satu paragraf: apa yang dibangun, input apa, output apa, untuk keperluan apa.
Berdasarkan CLAUDE.md dan DECISIONS.md.]

---

## 2. Inputs & Resources

### Apa yang dibutuhkan project ini
[List input/resource utama. Tergantung domain:
- Data project: dataset, database, API
- Writing project: research material, source documents, style guide
- Design project: brief, brand assets, reference material
- Learning project: course material, exercises, mentor
- Building project: BOM, tools, suppliers]

### Source / asal
[Dari mana input ini didapat — berdasarkan DECISIONS atau RESEARCH]

### Struktur / format
[Bentuk input: tabel/dokumen/file/skema. Wikilink ke `[[Project References/filename|Reference]]`
kalau ada blueprint internal yang sudah didokumentasikan.]

<!-- TODO: belum ada keputusan -->

---

## 3. Core Approach / Methodology

[Section untuk pendekatan/metode utama project. Isi sesuai domain:
- Data/ML project: algoritma yang dipilih, library, parameter
- System project: arsitektur high-level, pattern yang dipakai
- Writing project: narrative structure, voice, tone guidelines
- Design project: design philosophy, principles, decision framework
- Learning project: study method (spaced repetition, project-based, dll)
- Planning project: framework yang dipakai (OKR, SWOT, dll)

Sertakan wikilink ke decision yang menetapkan: `[[DECISIONS#nama-decision]]`]

<!-- TODO: belum ada keputusan -->

---

## 4. Outputs & Deliverables

### Apa yang akan dihasilkan
[List output dengan deskripsi singkat. Berdasarkan RESEARCH dan DECISIONS.]

| Output | Deskripsi | Dasar | Status |
|---|---|---|---|
| [nama] | [deskripsi] | [[RESEARCH#slug]] | planned / in progress / done |

### Naming / convention
[Konvensi penamaan file/chapter/section/identifier — berdasarkan Project References atau DECISIONS]

### Post-processing / quality bar
[Standar finishing: review, editing, validation, testing — apapun yang relevan untuk domain]

<!-- TODO: belum ada keputusan -->

---

## 5. Process Architecture

### Urutan kerja
[Step-by-step dari input awal sampai output akhir. Berdasarkan DECISIONS dan folder structure.]

```
[Tulis sebagai diagram teks. Contoh untuk data project:]
Input (00 Folder/)
    ↓
Process 1 (01 Folder/)
    ↓
Process 2 (02 Folder/)
    ↓
Output (03 Folder/)

[Contoh untuk writing project:]
Research notes (00 Research/)
    ↓
Outline (01 Outline/)
    ↓
Draft (02 Draft/)
    ↓
Final (03 Final/)
```

### Komponen utama
[Nama-nama komponen kerja utama, tanggung jawab masing-masing — bisa script, dokumen, atau workflow step.]

### Config & parameter (kalau applicable)
[Parameter yang di-externalize ke config file — relevan untuk technical project, skip kalau tidak applicable]

---

## 6. Constraints & Assumptions

[List hal-hal yang diasumsikan benar atau batasan yang harus dipatuhi. Berdasarkan RESEARCH dan DECISIONS.]

- [constraint 1] — sumber: [[DECISIONS#slug]] atau [[RESEARCH#slug]]
- [constraint 2]
- ...

---

## 7. Open Questions

[Hal-hal yang belum diputuskan dan perlu di-resolve sebelum atau selama implementasi.
Berdasarkan entries "TBD" di RESEARCH atau open questions di DECISIONS.]

- [ ] [pertanyaan 1]
- [ ] [pertanyaan 2]

---

## 8. Wikilink Index

[[RESEARCH]] · [[DECISIONS]] · [[SESSIONS]] · [[MAP]] · [[CLAUDE]]
```

## Step 4: Konfirmasi ke user

Setelah file dibuat, tampilkan ringkasan:

```
IMPLEMENTATION_BRIEF.md dibuat/diupdate di {{SYSTEM}}/.

Terisi dari knowledge yang ada:
  ✓ [section yang berhasil diisi]

Perlu dilengkapi (belum ada keputusan):
  ⚠ [section yang di-TODO]

Saran: review section yang ber-TODO dan jalankan /decision untuk setiap item yang perlu
keputusan eksplisit. Setelah ada decision baru, jalankan /build-brief lagi untuk refresh.
```
