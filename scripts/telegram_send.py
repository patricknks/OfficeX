#!/usr/bin/env python3
"""
Send a Telegram message from the secretary agent. Standard library only.

  python telegram_send.py --config office/secretary/telegram.json --text "Report ready"
  echo "long report" | python telegram_send.py --config telegram.json
  python telegram_send.py --token <bot token> --find-chat      # list chat ids that messaged the bot

telegram.json: {"token": "123:ABC", "chat_id": "123456789"}
Prints a JSON result; exit code 0 on success.
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.telegram.org/bot{token}/{method}"
LIMIT = 4000  # Telegram allows 4096 characters per message


def call(token, method, params):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(API.format(token=token, method=method), data=data)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            return {"ok": False, "description": f"HTTP {e.code}"}
    except Exception as e:  # network down, DNS, timeout
        return {"ok": False, "description": str(e)}


def chunks(text):
    while text:
        if len(text) <= LIMIT:
            yield text
            return
        cut = text.rfind("\n", 0, LIMIT)
        cut = cut if cut > LIMIT // 2 else LIMIT
        yield text[:cut]
        text = text[cut:].lstrip("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="JSON file with token and chat_id")
    ap.add_argument("--token")
    ap.add_argument("--chat-id")
    ap.add_argument("--text", help="message text; read from stdin when omitted")
    ap.add_argument("--markdown", action="store_true", help="send with Telegram Markdown formatting")
    ap.add_argument("--find-chat", action="store_true", help="list chats that recently messaged the bot")
    a = ap.parse_args()

    cfg = {}
    if a.config:
        with open(a.config, encoding="utf-8-sig") as f:
            cfg = json.load(f)
    token = a.token or cfg.get("token")
    chat_id = a.chat_id or cfg.get("chat_id")
    if not token:
        print(json.dumps({"ok": False, "error": "missing bot token"}))
        return 2

    if a.find_chat:
        res = call(token, "getUpdates", {"limit": 50})
        if not res.get("ok"):
            print(json.dumps({"ok": False, "error": res.get("description", "unknown error")}))
            return 1
        chats = {}
        for u in res.get("result", []):
            msg = u.get("message") or u.get("edited_message") or {}
            c = msg.get("chat")
            if c:
                chats[str(c["id"])] = c.get("username") or c.get("first_name") or c.get("title") or ""
        print(json.dumps({"ok": True, "chats": [{"id": k, "name": v} for k, v in chats.items()]}))
        return 0

    if not chat_id:
        print(json.dumps({"ok": False, "error": "missing chat id"}))
        return 2
    if a.text is None and hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    text = a.text if a.text is not None else sys.stdin.read()
    if not text.strip():
        print(json.dumps({"ok": False, "error": "empty message"}))
        return 2

    sent = 0
    for part in chunks(text):
        params = {"chat_id": chat_id, "text": part, "disable_web_page_preview": "true"}
        if a.markdown:
            params["parse_mode"] = "Markdown"
        res = call(token, "sendMessage", params)
        if not res.get("ok"):
            print(json.dumps({"ok": False, "error": res.get("description", "unknown error"), "sent_parts": sent}))
            return 1
        sent += 1
    print(json.dumps({"ok": True, "sent_parts": sent}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
