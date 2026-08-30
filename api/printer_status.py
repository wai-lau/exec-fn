"""Read-only SDCP status listener for the printer.

The printer PUSHES a `sdcp/status/<mainboard-id>` frame on its control socket
about once a second without being asked, so a status read needs no command at
all: this module opens one socket, sends NOTHING, ever, and keeps the latest
push cached. That is what makes status safe to expose to guests — a guest can
read the machine's state but has no path to it (the SDCP relay in
routes_printer, the only channel that carries browser->printer frames, stays
full-session only).

One shared socket serves every reader (the printer's connection budget is
small), started on the first read and dropped after `_IDLE_STOP_S` with no
readers.

`public_status()` returns a WHITELIST of fields — progress, layers, temps,
timings. Identifiers and anything naming what is being printed (MainboardID,
TaskId, Filename) are deliberately not in it: the page is public.
"""

import asyncio
import json
import time

import websockets

_CONNECT_TIMEOUT = 5.0
_IDLE_STOP_S = 60.0
# A cached push older than this is stale — report unknown rather than a state
# the machine may have left minutes ago.
_STALE_AFTER_S = 15.0
_BACKOFF_MAX = 15.0

# ELEGOO SDCP machine states (Status.CurrentStatus[0]) mapped to plain words.
_MACHINE_STATES = {0: "idle", 1: "printing", 2: "file transfer", 3: "exposure test", 4: "device test"}
# PrintInfo.Status — the print job's own phase.
_PRINT_STATES = {
    0: "idle", 1: "homing", 2: "dropping", 3: "exposuring", 4: "lifting",
    5: "pausing", 6: "paused", 7: "stopping", 8: "stopped", 9: "complete",
    12: "file checking", 13: "printing", 15: "paused", 16: "stopped", 19: "printing",
}


class _Status:
    """One shared read-only socket; latest push cached for every reader."""

    def __init__(self) -> None:
        self._upstream = ""
        self._latest: dict | None = None
        self._latest_at = 0.0
        self._task: asyncio.Task | None = None
        self._last_read = 0.0

    def configure(self, upstream: str) -> None:
        self._upstream = upstream

    async def _run(self) -> None:
        """Listen for pushes until nobody has read for _IDLE_STOP_S."""
        backoff = 1.0
        while time.monotonic() - self._last_read < _IDLE_STOP_S:
            try:
                async with websockets.connect(
                    f"ws://{self._upstream}/websocket", open_timeout=_CONNECT_TIMEOUT, max_size=None,
                ) as up:
                    backoff = 1.0
                    while time.monotonic() - self._last_read < _IDLE_STOP_S:
                        msg = await asyncio.wait_for(up.recv(), timeout=30.0)
                        if isinstance(msg, (bytes, bytearray)):
                            continue
                        try:
                            data = json.loads(msg)
                        except ValueError:
                            continue
                        if isinstance(data.get("Status"), dict):
                            self._latest = data["Status"]
                            self._latest_at = time.monotonic()
            except Exception:
                # Printer off, tunnel down, socket dropped: retry while anyone
                # is still asking, then let the task end.
                self._latest = None
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, _BACKOFF_MAX)
        self._task = None

    def _ensure_running(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def read(self) -> dict | None:
        """Latest cached push, or None while the printer is unreachable. Waits
        briefly on the first call, when the socket is still being dialled."""
        self._last_read = time.monotonic()
        self._ensure_running()
        for _ in range(30):  # ~3s: connect + first push
            if self._latest is not None:
                break
            await asyncio.sleep(0.1)
        if self._latest is None or time.monotonic() - self._latest_at > _STALE_AFTER_S:
            return None
        return self._latest


def public_status(raw: dict | None) -> dict:
    """Whitelist the pushed status down to what a public page may show. No
    identifiers, no filename — just the machine's observable state."""
    if not raw:
        return {"online": False}
    info = raw.get("PrintInfo") or {}
    total_layer = info.get("TotalLayer") or 0
    current_layer = info.get("CurrentLayer") or 0
    total_ticks = info.get("TotalTicks") or 0
    current_ticks = info.get("CurrentTicks") or 0
    state = _MACHINE_STATES.get((raw.get("CurrentStatus") or [None])[0], "unknown")
    job_state = _PRINT_STATES.get(info.get("Status"), "unknown")
    printing = state == "printing" or job_state in ("printing", "homing", "lifting", "dropping")
    return {
        "online": True,
        "state": state,
        "job_state": job_state,
        "printing": printing,
        "layer": int(current_layer),
        "total_layers": int(total_layer),
        # The firmware's own Progress lags on some jobs; layers are the honest
        # signal, with ticks as the fallback for a job that reports no layers.
        "progress": round(
            100 * (current_layer / total_layer if total_layer
                   else current_ticks / total_ticks if total_ticks else 0), 1),
        "elapsed_s": int(current_ticks),
        "total_s": int(total_ticks),
        "nozzle": round(raw.get("TempOfNozzle") or 0, 1),
        "nozzle_target": round(raw.get("TempTargetNozzle") or 0, 1),
        "bed": round(raw.get("TempOfHotbed") or 0, 1),
        "bed_target": round(raw.get("TempTargetHotbed") or 0, 1),
        "chamber": round(raw.get("TempOfBox") or 0, 1),
    }


status = _Status()
