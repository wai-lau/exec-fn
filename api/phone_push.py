"""Phone notifications through Wai's own ntfy server (her `notify` repo, ntfy.wai-lau.net).

Two things go to the phone (Wai, 2026-11-24: "I'm thinking Exec should send me notifications",
"Also any debug errors on the site"):

- Every exec-bubble comment (nudges and monitor comments), topic NTFY_TOPIC (default `exec`),
  read off the same fan-out the Discord bridge uses, so no nudge or monitor site changes.
- Unhandled server errors, topic `errors`: grouped to at most one alert per route every
  ERROR_GROUP_S, and no more than ERROR_DAY_MAX error alerts a day buzz the phone (the iPhone
  relay allows 250 wake-ups a day for everything), so a burst can't use them up.

Off unless NTFY_URL and NTFY_TOKEN are set (the droplet's .env; never committed). A failed send
is dropped: notifications never break a request or the loop.
"""
import asyncio
import os
import time

import httpx

ERROR_GROUP_S = 15 * 60
ERROR_DAY_MAX = 20
SITE = "https://wai-lau.net"

_errors_by_route: dict[str, float] = {}
_error_day: dict[str, int] = {"day": 0, "count": 0}


def _config():
    url, token = os.environ.get("NTFY_URL", "").rstrip("/"), os.environ.get("NTFY_TOKEN", "")
    return (url, token) if url and token else (None, None)


async def send(topic: str, message: str, title: str = "", priority: str = "default",
               tags: str = "", click: str = "") -> bool:
    """Publish one message. True when the server took it; never raises."""
    url, token = _config()
    if not url:
        return False
    headers = {"Authorization": f"Bearer {token}", "Priority": priority}
    for name, value in (("Title", title), ("Tags", tags), ("Click", click)):
        if value:
            headers[name] = value.encode("utf-8", "replace").decode("latin-1", "replace")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{url}/{topic}", content=message.encode("utf-8"), headers=headers)
        return r.status_code < 300
    except (httpx.HTTPError, OSError):
        return False


def _error_allowed(route: str, now: float) -> bool:
    day = int(now // 86400)
    if _error_day["day"] != day:
        _error_day.update(day=day, count=0)
    if now - _errors_by_route.get(route, 0) < ERROR_GROUP_S or _error_day["count"] >= ERROR_DAY_MAX:
        return False
    _errors_by_route[route] = now
    _error_day["count"] += 1
    return True


def report_error(method: str, route: str, exc: BaseException) -> None:
    """Schedule an `errors` alert for an unhandled exception, within the grouping and the cap."""
    if _config()[0] is None or not _error_allowed(route, time.time()):
        return
    text = f"{method} {route}: {type(exc).__name__}: {str(exc)[:300]}"
    try:
        asyncio.get_running_loop().create_task(
            send("errors", text, title="Exec error", priority="high", tags="warning", click=SITE))
    except RuntimeError:
        pass  # no running loop: nowhere to send from


async def run_phone_push() -> None:
    """Lifespan task: forward every exec-bubble comment to the phone. No-op when unconfigured."""
    if _config()[0] is None:
        return
    from monitor_sse import _monitor_subscribers
    queue: asyncio.Queue = asyncio.Queue()
    _monitor_subscribers.append(queue)
    topic = os.environ.get("NTFY_TOPIC", "exec")
    try:
        while True:
            payload = await queue.get()
            comment = payload.get("comment") if isinstance(payload, dict) else None
            if comment:  # {thinking}, {cards_changed} and the like stay off the phone
                await send(topic, comment[:4000], title="Exec", click=SITE)
    finally:
        if queue in _monitor_subscribers:
            _monitor_subscribers.remove(queue)
