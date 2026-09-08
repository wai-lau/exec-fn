#!/usr/bin/env python3
"""Shared helper for the Bash hooks: hand back the command's real SYNTAX.

A hook that matches on substrings ("git commit", "docker compose up", "webpack")
fires on any command that merely MENTIONS the phrase — writing a script, echoing
a message, or feeding python a heredoc that documents the very rule the hook
enforces. That is not theoretical: on 2026-09-08 a heredoc annotating these hooks
tripped both the nightfall build guard and the deploy healthcheck.

So: strip heredoc BODIES (a heredoc is data, not commands the shell will run),
and with --strip-quotes strip quoted strings too. What is left is the unquoted
shell syntax — the only place a real invocation can live.

Quotes are NOT stripped by default because callers still need to see inside them:
the docs guard reads the [skip-docs] token out of a quoted commit message.

Usage: hook payload JSON on stdin -> cleaned command on stdout (empty if none).
Import instead as: from cmdscan import clean, command_of
"""
import json
import re
import sys

HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def clean(cmd, strip_quotes=False):
    """Remove heredoc bodies (and optionally quoted strings) from a command."""
    out, pos = [], 0
    while True:
        m = HEREDOC.search(cmd, pos)
        if not m:
            out.append(cmd[pos:])
            break
        out.append(cmd[pos:m.start()])
        marker = m.group(2)
        rest = cmd[m.end():]
        end = re.search(r"^\s*%s\s*$" % re.escape(marker), rest, re.M)
        pos = m.end() + (end.end() if end else len(rest))
    text = "".join(out)
    if strip_quotes:
        text = re.sub(r"'[^']*'", " ", text)
        text = re.sub(r'"[^"]*"', " ", text)
    return text


def command_of(payload, strip_quotes=False):
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    return clean(cmd, strip_quotes) if cmd else ""


def main():
    strip_quotes = "--strip-quotes" in sys.argv[1:]
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    try:
        sys.stdout.write(command_of(payload, strip_quotes))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
