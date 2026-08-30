"""Shared MJPEG hub for the printer's camera.

The printer serves its camera as `multipart/x-mixed-replace` on :3031 and
accepts only ~4 concurrent streams, so a 1:1 relay stops scaling the moment
/printer is public: five viewers wedge the camera for everyone, the owner
included. This module keeps exactly ONE upstream stream open no matter how
many browsers are watching: it demuxes the upstream parts into whole JPEG
frames, holds the latest, and re-muxes a fresh multipart body per viewer (own
boundary) starting from that frame, so a viewer joining mid-stream paints
immediately instead of catching half a frame.

Read-only by construction: the hub only ever GETs the stream — nothing a
viewer sends can reach the printer, which is what lets guests watch (see
routes_printer's tier split).

A slow viewer never backs up the upstream: each has a one-frame queue and
drops what it can't keep up with. Guests are additionally throttled to a lower
frame interval (the full stream is ~10fps / ~340KB/s — fine for the owner, not
something to serve to the whole internet).
"""

import asyncio
import re
import time

import httpx

# Our own part boundary (the upstream's is "--foo"); viewers get a body we
# generate, so the two never have to agree.
BOUNDARY = "printerframe"
CONTENT_TYPE = f"multipart/x-mixed-replace; boundary={BOUNDARY}"

# Bounded so a public page can't turn the droplet into a broadcast station.
MAX_VIEWERS = 16
# Guests get ~2fps; the owner watches at whatever the printer pushes.
GUEST_FRAME_INTERVAL = 0.5

_CONNECT_TIMEOUT = httpx.Timeout(10.0, connect=4.0, read=30.0)
_BACKOFF_MAX = 15.0
# Keep the upstream open briefly after the last viewer leaves: a page reload
# reuses the same stream instead of re-dialling the printer.
_IDLE_STOP_S = 10.0
# A viewer whose response never gets a frame ends rather than hanging open.
_FIRST_FRAME_TIMEOUT = 8.0
_LEN_RE = re.compile(rb"Content-Length:\s*(\d+)", re.I)


class _Camera:
    """One upstream MJPEG stream, fanned out to every current viewer."""

    def __init__(self) -> None:
        self._upstream = ""
        self._subs: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self._latest: bytes | None = None

    def configure(self, upstream: str) -> None:
        self._upstream = upstream

    @property
    def viewers(self) -> int:
        return len(self._subs)

    # ── upstream ────────────────────────────────────────────────────────────
    async def _read_stream(self, r: httpx.Response) -> None:
        """Demux one upstream response into whole frames, publishing each."""
        buf = bytearray()
        async for chunk in r.aiter_bytes():
            buf += chunk
            while True:
                head_end = buf.find(b"\r\n\r\n")
                if head_end < 0:
                    break
                m = _LEN_RE.search(bytes(buf[:head_end]))
                if not m:
                    # Not a part header we understand: drop it and resync.
                    del buf[:head_end + 4]
                    continue
                start = head_end + 4
                end = start + int(m.group(1))
                if len(buf) < end:
                    break
                self._publish(bytes(buf[start:end]))
                del buf[:end]

    def _publish(self, frame: bytes) -> None:
        self._latest = frame
        for q in self._subs:
            if q.full():
                # Slow viewer: drop the frame it never picked up, keep the new
                # one. The upstream read is never blocked by a viewer.
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(frame)
            except asyncio.QueueFull:
                pass

    async def _run(self) -> None:
        """Hold the upstream open while anyone is watching; reconnect with
        backoff when the printer drops it (tunnel restart, camera pause)."""
        backoff = 1.0
        while self._subs:
            try:
                async with httpx.AsyncClient(timeout=_CONNECT_TIMEOUT) as client:
                    req = client.build_request("GET", f"http://{self._upstream}/video")
                    r = await client.send(req, stream=True)
                    try:
                        if r.status_code == 200:
                            backoff = 1.0
                            await self._read_stream(r)
                    finally:
                        await r.aclose()
            except (httpx.HTTPError, asyncio.IncompleteReadError):
                pass
            self._latest = None
            if not self._subs:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _BACKOFF_MAX)
        self._task = None

    def _ensure_running(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    # ── viewers ─────────────────────────────────────────────────────────────
    def can_admit(self) -> bool:
        return len(self._subs) < MAX_VIEWERS

    async def frames(self, min_interval: float = 0.0):
        """Yield a fresh multipart body for one viewer. Frames older than
        `min_interval` apart are skipped (guest throttle)."""
        q: asyncio.Queue = asyncio.Queue(maxsize=1)
        self._subs.add(q)
        self._ensure_running()
        try:
            latest = self._latest
            sent_at = 0.0
            if latest is not None:
                yield _part(latest)
                sent_at = time.monotonic()
            waited = 0.0
            while True:
                try:
                    frame = await asyncio.wait_for(q.get(), timeout=2.0)
                except asyncio.TimeoutError:
                    waited += 2.0
                    if sent_at == 0.0 and waited >= _FIRST_FRAME_TIMEOUT:
                        return  # printer/camera never answered: end the response
                    continue
                now = time.monotonic()
                if min_interval and sent_at and now - sent_at < min_interval:
                    continue
                sent_at = now
                yield _part(frame)
        finally:
            self._subs.discard(q)
            if not self._subs and self._task is not None:
                # Let a reload re-subscribe before the upstream is dropped.
                asyncio.get_event_loop().call_later(_IDLE_STOP_S, self._stop_if_idle)

    def _stop_if_idle(self) -> None:
        if not self._subs and self._task is not None and not self._task.done():
            self._task.cancel()
            self._task = None


def _part(frame: bytes) -> bytes:
    return (
        f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
        f"Content-Length: {len(frame)}\r\n\r\n"
    ).encode() + frame + b"\r\n"


camera = _Camera()
