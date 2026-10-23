---
name: office-files
description: Read, create or update Excel (.xlsx/.xlsm/.csv), Word and PowerPoint files, and drive the real Excel app on this PC when formulas, pivots or macros must be recalculated. Needs the "Excel and Office files" permission.
---

# Excel and Office files

Agents run on the owner's PC, so they work with Excel files directly. No remote desktop is needed.

| Need | Use |
|---|---|
| Read a sheet, analyse data | `pandas.read_excel(path, sheet_name=None)` |
| Write values, keep formatting and formulas | `openpyxl` (`load_workbook(path)`, never `data_only=True` when saving) |
| Recalculate formulas, refresh pivots/Power Query, run a macro | `xlwings` (opens the real Excel): `xw.Book(path)`, `app.calculate()`, `book.api.RefreshAll()`, `book.macro('Name')()` |
| Word / PowerPoint | `python-docx` / `python-pptx` |

Rules:
1. Never edit the owner's original in place. Copy to `<name> (agent edit YYYY-MM-DD).xlsx` next to it, or into the project's outputs folder, unless the owner asked to update the original.
2. Close the workbook when done (`book.close()`, `app.quit()` if you started Excel). Do not leave Excel windows open.
3. If the file is open by the owner (lock file `~$<name>.xlsx` exists), ask before writing.
4. After writing, re-open the file and check the cells you changed, then report what changed (sheet, range, old and new values).
5. Google Sheets only when the owner asks; that needs the Google Drive connector.

Install once, if missing: `pip install pandas openpyxl xlwings python-docx python-pptx`.
