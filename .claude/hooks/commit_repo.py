#!/usr/bin/env python3
"""Shared helper for the commit hooks: WHICH repo did this `git commit` run in?

/exec-fn holds app submodules (apps/<name>, see apps/README.md), each its own
repo. A hook that just `cd`s to the project dir and reads `git diff --cached`
checks the PARENT's index for a commit made in a submodule: it passes silently,
or fires on another session's staged files. So resolve the target the way the
shell would, first match wins:

  1. `git -C <dir> commit`
  2. a leading `cd <dir> &&` / `cd <dir>;`
  3. the payload's `cwd` (the Bash tool keeps its cwd between calls)
  4. the project dir

then hand back that dir's `git rev-parse --show-toplevel`.

Usage: hook payload JSON on stdin, project dir as argv[1] -> toplevel on stdout
(empty if none; callers fall back to the project dir).
"""
import json
import os
import re
import subprocess
import sys

from cmdscan import command_of

_GIT_C = re.compile(r"\bgit\s+-C\s+(\"[^\"]+\"|'[^']+'|\S+)\s+commit\b")
_LEAD_CD = re.compile(r"^\s*cd\s+(\"[^\"]+\"|'[^']+'|[^\s;&]+)\s*(?:&&|;)")


def _unquote(s):
    return s[1:-1] if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"" else s


def target_dir(payload, project):
    cmd = command_of(payload)
    base = payload.get("cwd") or project
    m = _GIT_C.search(cmd) or _LEAD_CD.search(cmd)
    if m:
        d = os.path.expanduser(_unquote(m.group(1)))
        return d if os.path.isabs(d) else os.path.join(base, d)
    return base


def toplevel(d):
    r = subprocess.run(["git", "-C", d, "rev-parse", "--show-toplevel"],
                       capture_output=True, text=True, timeout=10)
    return r.stdout.strip() if r.returncode == 0 else ""


def main():
    project = sys.argv[1] if len(sys.argv) > 1 else "/exec-fn"
    try:
        payload = json.load(sys.stdin)
        sys.stdout.write(toplevel(target_dir(payload, project)))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
