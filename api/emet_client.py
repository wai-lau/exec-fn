"""Owner-only client for Wai's "emet" knowledge-graph MCP server.

emet runs a FastMCP server on Wai's home box, reverse-tunnelled to the droplet
docker bridge exactly like the hosaka TTS upstream. It speaks the streamable-
http MCP transport at http://172.17.0.1:8125/mcp. The reverse-tunnel port stays
bound even when the home box is down, so every call is wrapped in a hard
timeout; ANY failure (tunnel down, box off, dep missing) resolves to
{"unreachable": True} -- the routes never 500.

The `mcp` SDK import is deferred inside the call (mirrors discord_bot's deferred
`import discord`) so the app still boots if the dep isn't installed yet -- the
routes just report unreachable until the image is rebuilt with the dep."""

import asyncio
import json
import os

# Docker bridge gateway -> host loopback :8125 (the SSH reverse tunnel to the
# home box), matching the hosaka TTS/gpu-mode pattern.
_EMET_URL = os.environ.get("EMET_MCP_URL", "http://172.17.0.1:8125/mcp")
# recall/scope are fast graph reads (warm < 4s) -> a short cap fails fast when the
# home box is down. `ask` runs an LLM generation on the home GPU and must tolerate
# a COLD model load (ollama pulling the model into VRAM on first hit after an
# idle/mode-switch), which stacks tens of seconds on top of the ~9s warm ceiling
# -- so it gets its own, much longer timeout. nginx proxy_read_timeout is 3600s,
# so this asyncio cap is the only clamp. Both env-overridable.
_TIMEOUT = float(os.environ.get("EMET_MCP_TIMEOUT", "10"))  # recall/scope round-trip
_ASK_TIMEOUT = float(os.environ.get("EMET_MCP_ASK_TIMEOUT", "90"))  # ask (cold load + gen)


def _unwrap(data):
    """FastMCP wraps a SCALAR tool return in {"result": x}; a dict return passes
    through untouched. All three emet tools return dicts, so unwrap only a lone
    "result" dict and otherwise hand back the structured content as-is."""
    if isinstance(data, dict) and set(data) == {"result"} and isinstance(data["result"], dict):
        return data["result"]
    return data


async def _call(name: str, args: dict) -> dict:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(_EMET_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            res = await session.call_tool(name, args)
            if res.structuredContent is not None:
                return _unwrap(res.structuredContent)
            # Fallback: first text content block parsed as JSON.
            for block in res.content:
                text = getattr(block, "text", None)
                if text:
                    return json.loads(text)
            return {}


async def call_tool(name: str, args: dict, timeout: float | None = None) -> dict:
    """Run one emet MCP tool under a hard timeout. Returns the tool's dict, or
    {"unreachable": True} when the tunnel / home box / dep is unavailable.

    Timeout defaults per tool: the long `_ASK_TIMEOUT` for `ask` (LLM gen + cold
    model load), the short `_TIMEOUT` for the fast reads. Pass `timeout` to
    override (used by latency tests)."""
    if timeout is None:
        timeout = _ASK_TIMEOUT if name == "ask" else _TIMEOUT
    try:
        return await asyncio.wait_for(_call(name, args), timeout=timeout)
    except Exception:
        return {"unreachable": True}
