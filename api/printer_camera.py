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

GUESTS PULL, THEY ARE NOT PUSHED TO (2026-09-26). A pushed MJPEG body is only
as fresh as the slowest buffer between here and the screen, and the one-frame
queue above only bounds OUR side: once a frame is written it sits in uvicorn's
transport, nginx and two kernel socket buffers, none of which drop anything.
On a link a little slower than the stream (measured: a client reading at
100KB/s against ~185KB/s of guest frames) latency grew without bound — 3.5s
median, 7s and climbing after 25s — which is what "the printer page is super
laggy" was. `next_frame()` serves ONE frame per request, and the client asks
for the next only once the last has arrived, so nothing can queue: latency is
one transfer plus a round trip however slow the link, and a slow link simply
gets fewer frames. Guests share ONE server-side sample of the stream
(`_promote`), so however fast a guest polls it can never see more than
GUEST_FRAME_INTERVAL allows. The MJPEG body stays for the owner's vendor SPA,
which binds an <img> to it.
"""

import asyncio
import re
from time import monotonic

import httpx

# Our own part boundary (the upstream's is "--foo"); viewers get a body we
# generate, so the two never have to agree.
BOUNDARY = "printerframe"
CONTENT_TYPE = f"multipart/x-mixed-replace; boundary={BOUNDARY}"

# Bounded so a public page can't turn the droplet into a broadcast station.
MAX_VIEWERS = 16
# Guests get ~5fps; the owner watches at whatever the printer pushes (~10).
#
# It was 2fps (0.5s) and read as broken rather than thrifty — a print head moves
# far enough in half a second that the picture reads as a slideshow of
# unrelated stills, which is the one thing a camera on a machine is for. 5fps is
# where motion reads as motion. The cost is bandwidth and it is bounded twice
# over: ~34KB a frame, so ~170KB/s per guest against the owner's ~340KB/s, and
# MAX_VIEWERS caps the whole page at 16 streams however many people find it.
GUEST_FRAME_INTERVAL = 0.2

_CONNECT_TIMEOUT = httpx.Timeout(10.0, connect=4.0, read=30.0)
_BACKOFF_MAX = 15.0
# Keep the upstream open briefly after the last viewer leaves: a page reload
# reuses the same stream instead of re-dialling the printer.
_IDLE_STOP_S = 10.0
# A viewer whose response never gets a frame ends rather than hanging open.
_FIRST_FRAME_TIMEOUT = 8.0
# How long one pull may wait for a new frame before answering "nothing yet".
PULL_WAIT_S = 5.0
# A throttle compares a gap against the interval, and the upstream's own gaps
# jitter around 100ms. With a strict `gap < interval` test the frame landing at
# 199ms of a 200ms interval is skipped and the next one goes out at 300ms, so
# "5fps" measured 3.3. Accepting a frame from 3/4 of the interval on lets the
# second-next frame through however it jitters.
_SLACK = 0.75
_LEN_RE = re.compile(rb"Content-Length:\s*(\d+)", re.I)


class _Camera:
    """One upstream MJPEG stream, fanned out to every current viewer."""

    def __init__(self) -> None:
        self._upstream = ""
        self._subs: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self._latest: bytes | None = None
        # The guests' shared sample of the stream: every frame promoted here
        # is at least GUEST_FRAME_INTERVAL (less slack) after the one before.
        self._guest: bytes | None = None
        self._guest_seq = 0
        self._guest_at = 0.0
        self._guest_evt = asyncio.Event()
        self._pulling = 0
        # Last time anyone watched; the upstream outlives it by _IDLE_STOP_S so
        # a reload, or the gap between two pulls, reuses the same stream.
        self._seen_at = 0.0

    def configure(self, upstream: str) -> None:
        self._upstream = upstream

    @property
    def viewers(self) -> int:
        return len(self._subs) + self._pulling

    def _wanted(self) -> bool:
        return bool(self._subs) or monotonic() - self._seen_at < _IDLE_STOP_S

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
                if not self._wanted():
                    return  # nobody watching: hang up rather than read on

    def _publish(self, frame: bytes) -> None:
        self._latest = frame
        self._promote(frame)
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

    def _promote(self, frame: bytes) -> None:
        """Offer a frame to the guests' shared sample, at most one per
        GUEST_FRAME_INTERVAL. Waking the waiters is swapping the event: every
        pull parked on the old one returns, new pulls park on the new one."""
        now = monotonic()
        if self._guest is not None and now - self._guest_at < GUEST_FRAME_INTERVAL * _SLACK:
            return
        self._guest, self._guest_at = frame, now
        self._guest_seq += 1
        evt, self._guest_evt = self._guest_evt, asyncio.Event()
        evt.set()

    async def _run(self) -> None:
        """Hold the upstream open while anyone is watching; reconnect with
        backoff when the printer drops it (tunnel restart, camera pause)."""
        backoff = 1.0
        while self._wanted():
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
            self._guest = None  # a stale still must not outlive the stream
            if not self._wanted():
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _BACKOFF_MAX)
        self._task = None

    def _ensure_running(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    # ── viewers ─────────────────────────────────────────────────────────────
    def can_admit(self) -> bool:
        return self.viewers < MAX_VIEWERS

    async def next_frame(self, after: int, wait: float = PULL_WAIT_S) -> tuple[int, bytes] | None:
        """One guest frame newer than `after` (the seq the caller already has),
        waiting up to `wait` for it. None = nothing new yet (ask again). A
        first request passes after=0 and gets the current frame at once."""
        self._seen_at = monotonic()
        self._ensure_running()
        self._pulling += 1
        try:
            deadline = monotonic() + wait
            while self._guest is None or self._guest_seq <= after:
                left = deadline - monotonic()
                if left <= 0:
                    return None
                try:
                    await asyncio.wait_for(self._guest_evt.wait(), timeout=left)
                except asyncio.TimeoutError:
                    return None
            return self._guest_seq, self._guest
        finally:
            self._pulling -= 1
            self._seen_at = monotonic()

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
                sent_at = monotonic()
            waited = 0.0
            while True:
                try:
                    frame = await asyncio.wait_for(q.get(), timeout=2.0)
                except asyncio.TimeoutError:
                    waited += 2.0
                    if sent_at == 0.0 and waited >= _FIRST_FRAME_TIMEOUT:
                        return  # printer/camera never answered: end the response
                    continue
                now = monotonic()
                if min_interval and sent_at and now - sent_at < min_interval * _SLACK:
                    continue
                sent_at = now
                yield _part(frame)
        finally:
            self._subs.discard(q)
            # Let a reload re-subscribe before the upstream is dropped.
            self._seen_at = monotonic()
            if not self._subs and self._task is not None:
                asyncio.get_event_loop().call_later(_IDLE_STOP_S + 0.5, self._stop_if_idle)

    def _stop_if_idle(self) -> None:
        """A stalled upstream never reaches the check in _read_stream, so the
        last viewer out still arms this."""
        if not self._wanted() and self._task is not None and not self._task.done():
            self._task.cancel()
            self._task = None


def _part(frame: bytes) -> bytes:
    return (
        f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
        f"Content-Length: {len(frame)}\r\n\r\n"
    ).encode() + frame + b"\r\n"


camera = _Camera()
