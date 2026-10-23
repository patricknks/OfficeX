#!/usr/bin/env python3
"""
PostToolUse hook — logs every file write/edit by Claude to a monthly code-log file.
Receives a JSON payload via stdin from Claude Code.

Writes to: [project root]/{{JOURNAL}}/code-log/YYYY-MM.md
This file is write-only and never auto-read by Claude.
Read it explicitly only when a full audit of code changes is needed.
"""
import sys
import json
from datetime import datetime
from pathlib import Path

JOURNAL_FOLDER = "{{JOURNAL}}"  # e.g. "05 Journal"
PROJECT_ROOT   = Path(__file__).parent.parent.parent
CODE_LOG_DIR   = PROJECT_ROOT / JOURNAL_FOLDER / "code-log"

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool = payload.get("tool_name", "")
    if tool not in ("Write", "Edit", "MultiEdit", "Create"):
        sys.exit(0)

    tool_input = payload.get("tool_input", {})
    file_path  = tool_input.get("file_path") or tool_input.get("path", "unknown file")
    now        = datetime.now()
    month_key  = now.strftime("%Y-%m")
    timestamp  = now.strftime("%Y-%m-%d %H:%M")

    entry = (
        f"\n## {timestamp} — {tool}: {file_path}\n\n"
        f"**Tool:** `{tool}`  \n"
        f"**File:** `{file_path}`\n\n"
        f"---\n"
    )

    try:
        CODE_LOG_DIR.mkdir(parents=True, exist_ok=True)
        month_file = CODE_LOG_DIR / f"{month_key}.md"
        if not month_file.exists():
            month_file.write_text(
                f"# Code Log — {month_key}\n\n"
                f"Auto-generated. Read only when explicitly requested.\n\n---\n",
                encoding="utf-8"
            )
        with open(month_file, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception as e:
        print(f"[log_change] Warning: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
