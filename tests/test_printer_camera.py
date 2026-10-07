"""The printer camera hub (api/printer_camera.py): guest pacing and the pull API.

Regressions this pins, all measured on the live page 2026-09-26:
  - "5fps" guests got 3.3fps: a strict `gap < interval` throttle skipped the
    frame landing at 199ms of a 200ms interval, so every other gap was 300ms.
  - a slow guest fell seconds behind: pushed MJPEG queues in socket buffers the
    hub cannot see. Guests now pull one frame per request (`next_frame`), which
    cannot queue, and share ONE server-side sample however fast they ask.
  - still laggy on an iPhone (Safari and Chrome): guests were capped at 5fps
    against the owner's 10, and one pull at a time capped a phone at
    1/(RTT + transfer). Guests now get the full rate with PULL_DEPTH pulls in
    flight; the live test below runs AS A GUEST at a phone's round trip, and
    skips (not fails) when the camera itself is delivering under the bar.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import printer_camera  # noqa: E402
from printer_camera import GUEST_FRAME_INTERVAL, PULL_DEPTH, _Camera  # noqa: E402

UPSTREAM_FPS = 10  # what the Centauri Carbon pushes


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(printer_camera, "monotonic", c)
    return c


@pytest.fixture
def cam():
    c = _Camera()
    c._ensure_running = lambda: None  # never dial a printer from a test
    return c


def _jittered_gaps(n, seed=7):
    """Upstream gaps: 100ms +-5ms, the jitter measured off the real camera."""
    import random
    rng = random.Random(seed)
    return [1 / UPSTREAM_FPS + rng.uniform(-0.005, 0.005) for _ in range(n)]


def _promoted(cam, clock, n=200):
    out = []
    for i, gap in enumerate(_jittered_gaps(n)):
        clock.t += gap
        before = cam._guest_seq
        cam._publish(b"f%d" % i)
        if cam._guest_seq != before:
            out.append(clock.t)
    return out


def test_guests_get_every_upstream_frame(cam, clock):
    """The guest sample is the printer's full rate, not a fraction of it."""
    promoted = _promoted(cam, clock)
    assert len(promoted) == 200


def test_guest_ceiling_under_jitter_skips_no_extra_frame(cam, clock, monkeypatch):
    """Were the ceiling ever to bite (interval 2x the upstream's), it must
    pass every other frame and never leave a 3-frame hole."""
    monkeypatch.setattr(printer_camera, "GUEST_FRAME_INTERVAL", 0.2)
    promoted = _promoted(cam, clock)
    gaps = [b - a for a, b in zip(promoted, promoted[1:])]
    fps = len(gaps) / (promoted[-1] - promoted[0])
    assert 4.75 <= fps <= 5.25
    assert max(gaps) < 0.25


def test_mjpeg_throttle_is_a_true_5fps_under_jitter(cam, clock):
    """The pushed body's own throttle carries the same slack."""
    async def run():
        gen = cam.frames(min_interval=0.2)
        sent = []
        first = asyncio.ensure_future(gen.__anext__())
        await asyncio.sleep(0)
        for i, gap in enumerate(_jittered_gaps(120)):
            clock.t += gap
            cam._publish(b"f%d" % i)
            await asyncio.sleep(0)
            if first is not None and first.done():
                sent.append(clock.t)
                first = asyncio.ensure_future(gen.__anext__())
                await asyncio.sleep(0)
        first.cancel()
        try:
            await first
        except (asyncio.CancelledError, StopAsyncIteration):
            pass
        return sent

    sent = asyncio.run(run())
    gaps = [b - a for a, b in zip(sent, sent[1:])]
    assert max(gaps) < 0.25
    assert len(sent) >= 55  # 12s of upstream at 5fps, less the first frame


def test_first_pull_gets_the_current_frame_at_once(cam, clock):
    cam._publish(b"jpeg-1")
    seq, frame = asyncio.run(cam.next_frame(after=0, wait=0.01))
    assert frame == b"jpeg-1" and seq == 1


def test_pull_waits_for_a_newer_frame(cam, clock):
    async def run():
        cam._publish(b"old")
        waiter = asyncio.ensure_future(cam.next_frame(after=1, wait=5))
        await asyncio.sleep(0)
        assert not waiter.done()  # nothing newer than what the caller holds
        clock.t += GUEST_FRAME_INTERVAL
        cam._publish(b"new")
        return await waiter

    assert asyncio.run(run()) == (2, b"new")


def test_pull_times_out_to_none_not_a_stale_repeat(cam, clock):
    cam._publish(b"only")
    assert asyncio.run(cam.next_frame(after=1, wait=0.01)) is None


def test_polling_fast_cannot_beat_the_guest_rate(cam, clock, monkeypatch):
    """A guest asking as fast as it likes still sees only the shared sample."""
    monkeypatch.setattr(printer_camera, "GUEST_FRAME_INTERVAL", 0.2)

    async def run():
        seen, seq = [], 0
        for i in range(40):
            clock.t += 1 / UPSTREAM_FPS
            cam._publish(b"f%d" % i)
            got = await cam.next_frame(after=seq, wait=0.001)
            if got:
                seq = got[0]
                seen.append(got[1])
        return seen

    assert len(asyncio.run(run())) == 20


def test_a_pipelined_guest_counts_once_against_the_cap(cam, clock, monkeypatch):
    monkeypatch.setattr(printer_camera, "MAX_VIEWERS", 2)

    async def run():
        one_guest = [asyncio.ensure_future(cam.next_frame(after=0, wait=5))
                     for _ in range(PULL_DEPTH)]
        await asyncio.sleep(0)
        room_for_second = cam.can_admit()
        second = asyncio.ensure_future(cam.next_frame(after=0, wait=5))
        await asyncio.sleep(0)
        full = not cam.can_admit()
        for f in one_guest + [second]:
            f.cancel()
        await asyncio.sleep(0)
        return room_for_second, full

    assert asyncio.run(run()) == (True, True)
    assert cam.can_admit()  # cancelled pulls release their slots


def test_upstream_stays_wanted_between_pulls_then_lets_go(cam, clock):
    cam._publish(b"x")
    asyncio.run(cam.next_frame(after=0, wait=0.01))
    clock.t += 1.0
    assert cam._wanted()  # the gap between two pulls must not hang up
    clock.t += printer_camera._IDLE_STOP_S
    assert not cam._wanted()


# ── the route, against the live container (conftest `client`) ─────────────
def test_frame_route_refuses_anonymous(client):
    assert client.get("/printer/frame").status_code == 401


def _printer_up(client, guest_cookie):
    r = client.get("/api/printer/health", headers=guest_cookie)
    if r.status_code != 200:
        pytest.skip("printer / home tunnel offline — no camera to measure")


def test_frame_route_serves_a_guest_one_jpeg_with_its_seq(client, guest_cookie):
    """Also proves /printer/frame is not shadowed by the owner-only
    /printer/{path} catch-all, which would bounce a guest to the admin login."""
    _printer_up(client, guest_cookie)
    r = client.get("/printer/frame?after=0", headers=guest_cookie)
    assert r.status_code == 200, r.text[:200]
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content[:2] == b"\xff\xd8"
    assert int(r.headers["x-frame-seq"]) > 0
    assert r.headers["cache-control"] == "no-store"
    assert "content-encoding" not in r.headers  # a JPEG is never re-gzipped


def test_guest_on_a_phone_round_trip_gets_the_full_rate(guest_cookie):
    """What web/printer.js does, AS A GUEST, over the public edge, with a
    phone's round trip added (150ms, split either side of each request):
    PULL_DEPTH pulls in flight, each asking for the frame after the last one
    asked for. Must hold near the camera's ~10fps with no visible hole, and
    every frame must arrive fresh."""
    import threading
    import time

    import httpx
    from conftest import BASE_URL
    RTT = 0.15
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as c:
        if c.get("/api/printer/health", headers=guest_cookie).status_code != 200:
            pytest.skip("printer / home tunnel offline — no camera to measure")
        lock = threading.Lock()
        state = {"asked": 0, "shown": 0}
        got, t0 = [], time.monotonic()

        def worker():
            while time.monotonic() - t0 < 5.0:
                with lock:
                    after = state["asked"]
                    if after:
                        state["asked"] += 1
                time.sleep(RTT / 2)
                r = c.get(f"/printer/frame?after={after}", headers=guest_cookie)
                time.sleep(RTT / 2)
                with lock:
                    if r.status_code != 200:
                        state["asked"] = state["shown"]
                        continue
                    seq = int(r.headers["x-frame-seq"])
                    state["asked"] = max(state["asked"], seq)
                    if seq > state["shown"]:
                        state["shown"] = seq
                        got.append((time.monotonic(), seq))

        threads = [threading.Thread(target=worker) for _ in range(PULL_DEPTH)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    got = got[3:]  # the first pulls both take the frame already there
    span = got[-1][0] - got[0][0]
    # The guest seq advances once per frame the hub PROMOTED, so its span over
    # the run is the rate the camera actually delivered. A slow home uplink or
    # camera (measured 6.6fps for minutes on 2026-10-07) is not a regression
    # here and must not block unrelated commits: skip, don't fail.
    hub_fps = (got[-1][1] - got[0][1]) / span
    if hub_fps < 1 / GUEST_FRAME_INTERVAL * 0.8:
        pytest.skip(f"camera upstream slow ({hub_fps:.2f}fps) — nothing to measure the pull against")
    times = [t for t, _ in got]
    gaps = [b - a for a, b in zip(times, times[1:])]
    fps = len(gaps) / span
    assert fps >= 1 / GUEST_FRAME_INTERVAL * 0.8, f"{fps:.2f}fps"
    assert max(gaps) < 0.3, f"max gap {max(gaps) * 1000:.0f}ms"
