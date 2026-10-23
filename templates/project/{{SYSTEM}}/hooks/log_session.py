#!/usr/bin/env python3
"""
Stop hook — writes a session heartbeat to SESSIONS.md each time Claude finishes
a response turn, then trims the file to keep only the last MAX_SESSIONS entries.

Writes to: [project root]/{{JOURNAL}}/SESSIONS.md
Claude auto-reads this file every session — the rolling window keeps it small.
"""
import sys
import json
from datetime import datetime
from pathlib import Path

JOURNAL_FOLDER = "{{JOURNAL}}"  # e.g. "05 Journal"
PROJECT_ROOT   = Path(__file__).parent.parent.parent
SESSIONS_PATH  = PROJECT_ROOT / JOURNAL_FOLDER / "SESSIONS.md"
MAX_SESSIONS   = 5

def parse_entries(text):
    """Split SESSIONS.md into header and a list of entry strings."""
    lines    = text.split("\n")
    header   = []
    entries  = []
    current  = []
    in_entries = False

    for line in lines:
        if line.startswith("## ") and not in_entries:
            in_entries = True
        if in_entries:
            if line.startswith("## ") and current:
                entries.append("\n".join(current))
                current = []
            current.append(line)
        else:
            header.append(line)

    if current:
        entries.append("\n".join(current))

    return "\n".join(header), entries

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    now        = datetime.now().strftime("%Y-%m-%d %H:%M")
    session_id = payload.get("session_id", "unknown")[:8]

    new_entry = (
        f"## {now} — heartbeat (session {session_id})\n\n"
        f"_Claude finished a response turn. "
        f"Run `/journal` or `/commit-discussion` to replace this with a full session summary._\n\n"
        f"---"
    )

    try:
        if SESSIONS_PATH.exists():
            raw = SESSIONS_PATH.read_text(encoding="utf-8")
        else:
            raw = (
                f"# Recent Sessions\n\n"
                f"Rolling log — last {MAX_SESSIONS} entries only.\n\n"
                f"---\n"
            )

        header, entries = parse_entries(raw)

        trimmed = entries[-(MAX_SESSIONS - 1):] if len(entries) >= MAX_SESSIONS else entries
        trimmed.append(new_entry)

        rebuilt = header.rstrip("\n") + "\n\n" + "\n\n".join(trimmed) + "\n"
        SESSIONS_PATH.write_text(rebuilt, encoding="utf-8")

    except Exception as e:
        print(f"[log_session] Warning: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
