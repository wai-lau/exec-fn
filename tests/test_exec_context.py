"""exec_context.wrap: the per-turn block the sidecar agent reads the board from.

The tag is a contract with claude-box/exec-tools.mjs (stripExecContext), which
removes the block from the replayed transcript -- pinned here from the Python
side so a rename on one end fails a test instead of leaking the board into /cc.
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import exec_context  # noqa: E402

# Same pattern as CONTEXT_BLOCK in claude-box/exec-tools.mjs.
_STRIP = re.compile(r"^\s*<exec-context>[\s\S]*?</exec-context>\s*")


def test_wrap_puts_the_board_before_the_message():
    out = asyncio.run(exec_context.wrap("did the dishes"))
    assert out.startswith("<exec-context>\nTODAY: ")
    assert "CURRENTLY SELECTED TASKS:" in out
    assert out.endswith("</exec-context>\n\ndid the dishes")


def test_strip_pattern_recovers_what_wai_typed():
    out = asyncio.run(exec_context.wrap("line one\n<exec-context>quoted</exec-context>"))
    assert _STRIP.sub("", out) == "line one\n<exec-context>quoted</exec-context>"
