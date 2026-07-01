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
_TIMEOUT = float(os.environ.get("EMET_MCP_TIMEOUT", "10"))  # whole round-trip


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


async def call_tool(name: str, args: dict) -> dict:
    """Run one emet MCP tool under a hard timeout. Returns the tool's dict, or
    {"unreachable": True} when the tunnel / home box / dep is unavailable."""
    try:
        return await asyncio.wait_for(_call(name, args), timeout=_TIMEOUT)
    except Exception:
        return {"unreachable": True}
