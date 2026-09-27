"""Exec's card tools, callable by the Claude Code sidecar.

The merge of /cc and Exec (docs/plan-exec-cc-merge.md) puts Exec on the sidecar,
which runs on the droplet HOST. The tools themselves stay HERE, in Python, next
to rd.json and its lock -- the sidecar only relays a call: its in-process MCP
server (claude-box/exec-tools.mjs) POSTs each one to /api/exec/tool/{name}.

The routes live in routes_exec.py; this module stays router-free because
chat_passes imports it and routers.py imports the chat path (a cycle otherwise).

`run_tool` is the ONE place a tool call's side effects are decided (the monitor
debounce, and whether the board changed), shared with the in-container chat path, so the two callers
cannot drift apart on what a tool call does."""

import asyncio

from chat_tools import _handle_tool
from monitor import MONITORED_TOOLS, schedule_monitor


async def run_tool(name: str, input_: dict) -> tuple[dict, bool]:
    """Run one Exec tool; returns (result, board_changed).

    Never raises: a handler can throw on a malformed model-supplied argument,
    and an exception here would lose a mutation that already landed."""
    try:
        result = await asyncio.to_thread(_handle_tool, name, input_ or {})
    except Exception as e:
        result = {"error": f"tool failed: {e}"}
    ok = isinstance(result, dict) and result.get("ok")
    if ok and name in MONITORED_TOOLS:
        schedule_monitor()
    # Every tool but update_context writes rd.json.
    return result, bool(ok and name != "update_context")
