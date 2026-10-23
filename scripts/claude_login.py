#!/usr/bin/env python3
"""
Sign OfficeX in to a Claude account from the GUI, without a terminal.

Runs `claude setup-token` in a pseudo terminal (it needs one), and talks to OfficeX in JSON lines:
  stdout  {"event": "url", "url": "https://claude.com/cai/oauth/authorize?..."}
  stdin   the code shown by claude.ai after signing in (one line)
  stdout  {"event": "token", "token": "sk-ant-oat01-..."}   or   {"event": "error", "message": "..."}
The token also arrives without a code when the sign-in finishes in a browser on this computer (localhost callback).

Windows needs pywinpty (python -m pip install pywinpty); macOS and Linux use the standard pty module.
"""
import json
import os
import re
import sys
import threading
import time

OSC8 = re.compile(r"\x1b\]8;[^;]*;(https://[^\x07\x1b]+)")
URL = re.compile(r"https://claude\.(?:com|ai)/[^\s\x07\x1b\"']*oauth/authorize\?[^\s\x07\x1b\"']+")
TOKEN = re.compile(r"sk-ant-oat01-[A-Za-z0-9_\-]{20,}")
ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f]")
FAIL = re.compile(r"(OAuth error[^\n]*|Invalid code[^\n]*|error[: ][^\n]{0,160})", re.I)


LOG = os.environ.get("OFFICEX_LOGIN_LOG")  # what the terminal showed, for diagnosis (codes and tokens are hidden)


def transcript(raw, note=""):
    if not LOG:
        return
    try:
        text = ANSI.sub("\n", raw)
        text = TOKEN.sub("sk-ant-oat01-<hidden>", text)
        text = re.sub(r"[A-Za-z0-9_\-]{30,}#[A-Za-z0-9_\-]+", "<code>", text)
        text = "\n".join(l.rstrip() for l in text.splitlines() if l.strip())
        with open(LOG, "w", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + note + "\n" + text[-6000:] + "\n")
    except Exception:
        pass


def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


class Term:
    """Minimal cross-platform pseudo terminal around one command."""

    def __init__(self, argv):
        self.buf = ""
        self.lock = threading.Lock()
        self.alive = True
        if os.name == "nt":
            from winpty import PtyProcess  # pywinpty

            self.proc = PtyProcess.spawn(argv, dimensions=(40, 1000))
            self._read = lambda: self.proc.read(4096)
            self._write = self.proc.write
            self._isalive = self.proc.isalive
            self._kill = lambda: self.proc.terminate(force=True)
        else:
            import fcntl
            import pty
            import struct
            import subprocess
            import termios

            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 1000, 0, 0))
            self.proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, close_fds=True, start_new_session=True)
            os.close(slave)
            self._read = lambda: os.read(master, 4096).decode("utf-8", "replace")
            self._write = lambda s: os.write(master, s.encode())
            self._isalive = lambda: self.proc.poll() is None
            self._kill = self.proc.kill
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        while True:
            try:
                chunk = self._read()
            except Exception:
                break
            if not chunk:
                if not self._isalive():
                    break
                time.sleep(0.05)
                continue
            with self.lock:
                self.buf += chunk
        self.alive = False

    def text(self):
        with self.lock:
            return self.buf

    def write(self, s):
        self._write(s)

    def kill(self):
        try:
            self._kill()
        except Exception:
            pass


def wait_for(term, find, timeout):
    end = time.time() + timeout
    while time.time() < end:
        hit = find(term.text())
        if hit:
            return hit
        if not term.alive:
            return find(term.text())
        time.sleep(0.2)
    return None


def last_lines(raw, n=4):
    lines = [l.strip() for l in ANSI.sub("", raw).replace("\r", "\n").split("\n") if l.strip()]
    return " ".join(lines[-n:])[:300]


def main():
    claude = sys.argv[1] if len(sys.argv) > 1 else "claude"
    try:
        term = Term([claude, "setup-token"])
    except ImportError:
        say({"event": "error", "message": "pywinpty is missing: run  python -m pip install pywinpty"})
        return 2
    except Exception as e:
        say({"event": "error", "message": f"could not start claude: {e}"})
        return 2

    def find_url(raw):
        m = OSC8.search(raw) or URL.search(ANSI.sub("", raw))
        return m.group(1) if m and m.re is OSC8 else (m.group(0) if m else None)

    url = wait_for(term, find_url, 45)
    if not url:
        say({"event": "error", "message": "no sign-in link from claude setup-token: " + last_lines(term.text())})
        term.kill()
        return 1
    say({"event": "url", "url": url})

    # Two ways to finish: the owner pastes the code from claude.ai (any device), or claude setup-token's own browser
    # tab on this computer completes through its localhost callback and the token simply appears on the screen.
    codes = []

    def read_stdin():
        for line in sys.stdin:
            if line.strip():
                codes.append(line.strip())

    threading.Thread(target=read_stdin, daemon=True).start()

    def find_token(raw):
        # escape sequences (colors, cursor moves a Windows console uses instead of spaces) and line ends separate words
        hits = TOKEN.findall(ANSI.sub("\n", raw))
        return max(hits, key=len) if hits else None

    start = None
    sent = 0.0
    enter_again = False
    end = time.time() + 15 * 60
    while time.time() < end:
        raw = term.text()
        if find_token(raw):
            time.sleep(1.0)  # let the full token reach the screen
            transcript(term.text(), "token received")
            say({"event": "token", "token": find_token(term.text())})
            term.kill()
            return 0
        if codes:
            code = codes.pop(0)
            start = len(raw)
            # type the code, then press Enter separately: on Windows a single write is taken as pasted text and
            # its Enter is not a key press
            term.write(code)
            time.sleep(0.6)
            term.write("\r")
            sent = time.time()
            enter_again = True
        elif start is not None and enter_again and time.time() - sent > 6 and len(term.text()) - start < 40:
            term.write("\r")  # the screen did not react: press Enter once more
            enter_again = False
        elif start is not None and time.time() - sent > 90:
            transcript(term.text(), "no answer after the code")
            say({"event": "error", "message": "Claude did not answer after the code: " + last_lines(term.text())})
            term.kill()
            return 1
        elif start is not None:
            fail = FAIL.search(ANSI.sub("", raw[start:]).replace("\r", "\n"))
            if fail:
                time.sleep(0.5)
                if not find_token(term.text()):
                    transcript(term.text(), "error")
                    say({"event": "error", "message": fail.group(1).strip()[:300]})
                    term.kill()
                    return 1
        if not term.alive and not find_token(term.text()):
            transcript(term.text(), "claude exited")
            say({"event": "error", "message": "sign-in did not finish: " + last_lines(term.text())})
            return 1
        time.sleep(0.2)
    say({"event": "error", "message": "sign-in timed out"})
    term.kill()
    return 1

if __name__ == "__main__":
    sys.exit(main())
