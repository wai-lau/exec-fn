"""The 4:30 AM morning route (`POST /api/morning`) and its error report into
the Exec chat. The pipeline itself is morning.py; this is the HTTP edge."""
import asyncio

from fastapi import HTTPException

from routers import protected
from morning import build_morning
import cc_client
from monitor_sse import push_to_monitor
from chat_store import append_monitor_comment


@protected.post("/api/morning")
async def api_morning():
    try:
        result = await asyncio.to_thread(build_morning)
    except Exception as e:
        await _post_morning_errors({"morning": str(e)})
        raise HTTPException(status_code=500, detail=str(e))
    # The Exec panel's thread lives in the cc sidecar, not chat.json — end it
    # too, or the panel never starts a fresh day. Sidecar /new archives first.
    cc = await cc_client.new_conversation()
    if not cc.get("ok", True):
        result.setdefault("errors", {})["cc_new"] = cc.get("detail", "failed")
    if result.get("errors"):
        await _post_morning_errors(result["errors"])
    # Tell any open board to refresh (rollover re-laid the day).
    await push_to_monitor({"cards_changed": True})
    return result


def _morning_error_fix(step: str, msg) -> str:
    """A tappable fix for a failure that only the owner can clear by hand."""
    if step == "gcal_import" and "invalid_grant" in str(msg):
        return " — [re-grant Google Calendar](https://wai-lau.net/api/gcal/auth)"
    return ""


async def _post_morning_errors(errors: dict) -> None:
    """Put the morning run's failures in the Exec chat (panel + Discord), so a
    broken step is seen the same day instead of only in /debug's cron log."""
    lines = "\n".join(f"- `{step}`: {msg}{_morning_error_fix(step, msg)}"
                      for step, msg in errors.items())
    text = f"**Morning run errors** ({len(errors)}):\n{lines}"
    try:
        append_monitor_comment(text)
        await push_to_monitor({"comment": text})
    except Exception:
        pass   # reporting a failure must never become the failure
