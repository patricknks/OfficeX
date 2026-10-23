User ingin initialize atau re-initialize Research Journey journal infrastructure untuk
project ini. Skill ini idempotent — aman dijalankan berkali-kali, hanya tambah yang missing.

---

## Step 1: Check & create journal files

Di dalam `{{JOURNAL}}/`:

1. `DECISIONS.md` — create dengan frontmatter standar dan blank header kalau missing
2. `RESEARCH.md` — create dengan frontmatter standar dan blank header kalau missing
3. `SESSIONS.md` — create dengan frontmatter standar dan blank header kalau missing
4. `code-log/` directory — create kalau missing

## Step 2: Check & create slash commands

Di dalam `.claude/commands/`, check ada-tidaknya:
- `decision.md`
- `research.md`
- `journal.md`
- `start.md`
- `commit-discussion.md`
- `auto-research.md`
- `build-brief.md`
- `index-reference.md`
- `setup-journal.md`

Create yang missing pakai template dari `new-project` skill.

## Step 3: Check & create hooks

Check `.claude/settings.json` punya PostToolUse dan Stop hooks.
Add kalau missing, pointing ke hook scripts di `{{SYSTEM}}/hooks/`.

Check `{{SYSTEM}}/hooks/` punya:
- `log_change.py`
- `log_session.py`

Create yang missing pakai template dari `new-project` skill.

## Step 4: Check & create memory folder

Lokasi: `~/.claude/projects/<project-slug>/memory/`.

Check ada-tidaknya:
- `MEMORY.md` (index)
- `project_<slug>_status.md` (status file)

Create yang missing pakai template dari `new-project` skill (Step 8).

## Step 5: Check & update MAP.md

Cek `MAP.md` punya:
- Journal Files section dengan 4 entries (DECISIONS, RESEARCH, SESSIONS, code-log)
- System & Implementation section dengan IMPLEMENTATION_BRIEF dan hooks
- Attachments section dengan Knowledge References dan Project References
- Wikilink Index yang complete

Update section yang missing.

## Step 6: Check & update CLAUDE.md

Cek `CLAUDE.md` punya:
- Skills Inventory section dengan 9 commands
- Research Journal section dengan path ke 3 journal files + IMPLEMENTATION_BRIEF
- Memory System section dengan path ke `~/.claude/projects/<slug>/memory/`

Update section yang missing.

## Step 7: Report

Report ke user apa yang baru dibuat vs yang sudah ada:
```
Setup-journal complete.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Journal files:
  ✓ [file] (created / already existed)
Slash commands:
  ✓ [file] (created / already existed)
Hooks:
  ✓ [file] (created / already existed)
Memory:
  ✓ [file] (created / already existed)
MAP.md & CLAUDE.md: [updated / no changes needed]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next step: jalankan /start untuk verify semua loaded dengan benar.
```
