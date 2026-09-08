"""Client for the sandboxed Claude Code sidecar (see /exec-fn/claude-box/).

Claude Code cannot run in this container -- python:3.12-slim carries no node, no
`claude` binary and no credentials -- so it runs on the droplet HOST as its own
unprivileged user (cc-agent, cwd /srv/cc-sandbox) and we reach it over the
docker bridge, the same shape as the hosaka/emet/printer upstreams minus the SSH
tunnel. The bridge port is host-only, but every container on the box can reach
it, so each call carries a shared secret.

Everything here degrades instead of raising: the sidecar can be down (unit
stopped), busy (MAX_CONCURRENT is 1 -- a memory ceiling, not politeness), or
logged out (cc-agent's subscription OAuth expired). None of those are 500s --
the page renders the state and stays usable."""

import json
import os

import httpx

# Docker bridge gateway -> the host-side sidecar, matching emet/hosaka.
_CC_URL = os.environ.get("CC_SIDECAR_URL", "http://172.17.0.1:8129")
_TOKEN = os.environ.get("CC_SIDECAR_TOKEN", "")
# Health is a liveness probe and must fail fast; a query is an agent run and may
# legitimately think for minutes, so it gets no total cap here -- the sidecar's
# own idle timeout is the clamp, and nginx's proxy_read_timeout is 3600s.
_HEALTH_TIMEOUT = float(os.environ.get("CC_HEALTH_TIMEOUT", "3"))
_CONNECT_TIMEOUT = float(os.environ.get("CC_CONNECT_TIMEOUT", "3"))


def _headers() -> dict:
    return {"x-cc-token": _TOKEN, "content-type": "application/json"}


async def health() -> dict:
    """{ok, busy, active} -- or {ok: False, unreachable: True} when the unit is
    down. A bound port is not liveness (same rule as /api/hosaka/health), so this
    wants a real response body, not a successful connect."""
    if not _TOKEN:
        return {"ok": False, "unreachable": True, "detail": "CC_SIDECAR_TOKEN unset"}
    try:
        async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT) as client:
            r = await client.get(f"{_CC_URL}/health", headers=_headers())
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        return {"ok": False, "unreachable": True, "detail": str(exc)}


async def stream_query(prompt: str, session_id: str | None = None):
    """Yield already-encoded SSE frames from the sidecar, passed straight through.

    The sidecar's event vocabulary (session/text/thinking/tool/tool_result/done/
    error) is exactly what the browser renders, so relaying the frames verbatim
    keeps one schema instead of three. Failures are injected as an `error` frame
    rather than raised: the response has already begun streaming by then, so an
    exception would truncate the body with no explanation on the page."""
    if not _TOKEN:
        yield _frame({"type": "error", "detail": "CC_SIDECAR_TOKEN unset"})
        return

    body = {"prompt": prompt}
    if session_id:
        body["sessionId"] = session_id

    # connect fails fast; read is unbounded because an agent turn legitimately
    # runs long and the sidecar already enforces its own idle timeout.
    timeout = httpx.Timeout(None, connect=_CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", f"{_CC_URL}/query", headers=_headers(), json=body
            ) as r:
                if r.status_code == 429:
                    yield _frame({"type": "busy", "detail": "a run is already in flight"})
                    return
                if r.status_code != 200:
                    await r.aread()
                    yield _frame({"type": "error", "detail": f"sidecar {r.status_code}"})
                    return
                async for line in r.aiter_lines():
                    if line.startswith("data: "):
                        yield (line + "\n\n").encode()
    except Exception as exc:
        yield _frame({"type": "error", "detail": f"sidecar unreachable: {exc}"})


def _frame(event: dict) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()
