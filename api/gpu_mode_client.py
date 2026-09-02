"""Owner-only client for the home-box gpu-mode service (port 8124, reached over
the SSH reverse tunnel at 172.17.0.1:8124). Pure guard logic + thin async
proxies; the route layer (routes_tts.py) owns auth + the active-audio-listener
count (who would actually be cut off by a hosaka-killing switch)."""

import httpx

_STOP_HOSAKA = {"emo", "idle"}  # actions that kill hosaka-server -> guard them


def effective_mode(reported: str, tts_live: bool) -> str:
    """The mode to actually REPORT, given what the box claims and whether its TTS
    is really answering.

    `/mode` reports the home box's own intent, which outlives reality: when
    hosaka-server dies or wedges, the box goes on saying "homo" long after it
    stopped serving a byte, and the strip lights the homo segment over a dead
    backend. Nothing is running, so the honest reading is `idle`.

    Only homo is second-guessed. `emo`/`idle` mean hosaka-server is deliberately
    stopped -- a failing TTS probe is the EXPECTED state there, not a
    contradiction -- and `gone` (box unreachable) already says everything."""
    if reported == "homo" and not tts_live:
        return "idle"
    return reported


def needs_user_confirm(action: str, presence_count: int, force: bool) -> bool:
    """True iff this switch would cut off connected users and the caller has not
    already confirmed. homo (which starts hosaka) never needs it."""
    return action in _STOP_HOSAKA and presence_count > 0 and not force


async def fetch_mode(upstream: str, token: str) -> str:
    """Current mode, or 'gone' if the home service / tunnel is unreachable."""
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(
                f"http://{upstream}/mode",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            return r.json()["mode"]
    except Exception:
        return "gone"


async def switch_mode(upstream: str, token: str, action: str) -> str:
    """Run an action; return the resulting mode, or 'gone' on failure."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"http://{upstream}/{action}",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            return r.json()["mode"]
    except Exception:
        return "gone"
