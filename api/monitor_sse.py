"""Exec-bubble SSE fan-out — shared by the monitor (main) and the nudge loop."""
import asyncio

_monitor_subscribers: list[asyncio.Queue] = []


async def push_to_monitor(payload: dict) -> None:
    """Push a payload to all exec-bubble SSE subscribers."""
    for q in list(_monitor_subscribers):
        await q.put(payload)
