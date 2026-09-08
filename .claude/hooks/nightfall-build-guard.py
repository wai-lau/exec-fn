#!/usr/bin/env python3
"""PreToolUse(Bash) guard: nightfall webpack builds need NODE_ENV=production and
must run in the background.

Two standing rules, both learned by failing:
  - memory feedback_nightfall_webpack_node_env: webpack.config.js reads
    process.env.NODE_ENV at CONFIG-LOAD time to pick staticPublicPath and
    AUDIO_BASE_URL. Without it the bundle's asset URLs come out as /static/ and
    /audio/, which 404 in prod (FastAPI serves the game under /nightfall-game/).
    The symptom is a SILENT black screen with no JS error. The webpack `mode`
    default does not set NODE_ENV early enough for the config's own conditional.
  - memory feedback_webpack_bg: the build takes 40-50s; foreground blocks Wai.

Matches an INVOCATION, not a mention: heredoc bodies and quoted strings are
stripped first, so a script or a message that merely contains the word "webpack"
is not a build. (The first cut of this guard denied a python heredoc that quoted
the correct build command in prose.)

Fail-open: any parse problem exits 0. Never block on a hook bug.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmdscan import clean  # noqa: E402  (path must be set first)

INVOKE = re.compile(
    r"(?:^|[;&|]|\s)(?:(?:npx|yarn|pnpm|bunx)\s+webpack\b"
    r"|node_modules/\.bin/webpack\b"
    r"|npm\s+run\s+build\b)"
)
INFO = re.compile(r"--version\b|--help\b|\s-v(?:\s|$)")


def main():
    try:
        payload = json.load(sys.stdin)
        tool_input = payload.get("tool_input") or {}
        cmd = tool_input.get("command") or ""
        background = tool_input.get("run_in_background") is True
    except Exception:
        return 0
    if not cmd:
        return 0
    try:
        text = clean(cmd, strip_quotes=True)
    except Exception:
        return 0
    if not INVOKE.search(text) or INFO.search(text):
        return 0

    problems = []
    if "NODE_ENV=production" not in text:
        problems.append(
            "NODE_ENV=production is missing — the bundle's asset URLs come out as "
            "/static/ and /audio/, which 404 under /nightfall-game/ and render a "
            "silent black screen with no JS error."
        )
    if not background:
        problems.append(
            "The build must run with run_in_background: true — it takes 40-50s and "
            "blocks the session otherwise."
        )
    if not problems:
        return 0

    reason = (
        "Nightfall build rejected.\n- " + "\n- ".join(problems)
        + "\n\nCorrect form:\n  cd /exec-fn/nightfall-incident/nightfall-src && "
        "NODE_ENV=production npx webpack\nwith run_in_background: true."
    )
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
