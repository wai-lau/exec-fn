"""Owner-only client for the home-box gpu-mode service (port 8124, reached over
the SSH reverse tunnel at 172.17.0.1:8124). Pure guard logic + thin async
proxies; the route layer (routes_tts.py) owns auth + the active-audio-listener
count (who would actually be cut off by a hosaka-killing switch)."""

import os

import httpx

# Home-box gpu-mode switch, over the same SSH tunnel as the TTS upstream. Here
# rather than in routes_tts.py because the nightly /tarot voice check
# (tarot/openings_loop.py) reports the mode alongside its probe and must reach
# the service without importing the route module to find out where it is.
GPU_MODE_UPSTREAM = os.environ.get("GPU_MODE_UPSTREAM", "172.17.0.1:8124")
GPU_MODE_TOKEN = os.environ.get("GPU_MODE_TOKEN", "")

# The two actions the strip offers (Wai, 2026-11-26: "the toggle only has two
# modes, lomo and homo"). The home box keeps emo/idle for its own shell use.
ACTIONS = ("homo", "lomo")


def effective_mode(reported: str, tts_live: bool) -> str:
    """The mode to show: `homo`, `lomo` or `unavailable`.

    nicole is always on at the home box, so every box mode but homo serves
    nicole + glados without Charlie, which is what lomo means: emo and idle read
    as lomo. `/mode` reports the box's INTENT, which outlives reality (the
    server dies, the box still says homo), so a box whose TTS is not answering,
    or that is not reachable at all (`gone`), reads `unavailable`."""
    if reported == "gone" or not tts_live:
        return "unavailable"
    return "homo" if reported == "homo" else "lomo"


def needs_user_confirm(action: str, presence_count: int, force: bool) -> bool:
    """True iff this switch would cut off connected users and the caller has not
    already confirmed. Both actions restart hosaka-server (homo loads Charlie,
    lomo drops it), so both cut every open stream for the restart."""
    return action in ACTIONS and presence_count > 0 and not force


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


class UnsupportedMode(Exception):
    """The home box answered but has no endpoint for this action (404) -- e.g.
    lomo before the box learns it. Not `gone`: the box is up and unchanged."""


async def switch_mode(upstream: str, token: str, action: str) -> str:
    """Run an action; return the resulting mode, or 'gone' on failure. Raises
    UnsupportedMode when the box is reachable but lacks the action."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"http://{upstream}/{action}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code == 404:
                raise UnsupportedMode(action)
            r.raise_for_status()
            return r.json()["mode"]
    except UnsupportedMode:
        raise
    except Exception:
        return "gone"
