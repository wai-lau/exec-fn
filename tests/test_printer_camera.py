"""The printer camera hub (api/printer_camera.py): guest pacing and the pull API.

Two regressions this pins, both measured on the live page 2026-09-26:
  - "5fps" guests got 3.3fps: a strict `gap < interval` throttle skipped the
    frame landing at 199ms of a 200ms interval, so every other gap was 300ms.
  - a slow guest fell seconds behind: pushed MJPEG queues in socket buffers the
    hub cannot see. Guests now pull one frame per request (`next_frame`), which
    cannot queue, and share ONE server-side 5fps sample however fast they ask.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import printer_camera  # noqa: E402
from printer_camera import GUEST_FRAME_INTERVAL, _Camera  # noqa: E402

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


def test_guest_sample_is_a_true_5fps_under_jitter(cam, clock):
    promoted = []
    for i, gap in enumerate(_jittered_gaps(200)):
        clock.t += gap
        before = cam._guest_seq
        cam._publish(b"f%d" % i)
        if cam._guest_seq != before:
            promoted.append(clock.t)
    gaps = [b - a for a, b in zip(promoted, promoted[1:])]
    fps = len(gaps) / (promoted[-1] - promoted[0])
    assert 1 / GUEST_FRAME_INTERVAL * 0.95 <= fps <= 1 / GUEST_FRAME_INTERVAL * 1.05
    # Every other upstream frame, never every third: no 300ms hole.
    assert max(gaps) < GUEST_FRAME_INTERVAL + 0.05


def test_mjpeg_guest_throttle_is_a_true_5fps_under_jitter(cam, clock):
    """The pushed body's own throttle carries the same slack."""
    async def run():
        gen = cam.frames(min_interval=GUEST_FRAME_INTERVAL)
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
    assert max(gaps) < GUEST_FRAME_INTERVAL + 0.05
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


def test_polling_fast_cannot_beat_the_guest_rate(cam, clock):
    """Upstream at 10fps, a guest asking as fast as it likes: it still sees
    only the shared sample, i.e. every other frame."""
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


def test_pullers_count_against_the_viewer_cap(cam, clock, monkeypatch):
    monkeypatch.setattr(printer_camera, "MAX_VIEWERS", 1)

    async def run():
        waiter = asyncio.ensure_future(cam.next_frame(after=0, wait=5))
        await asyncio.sleep(0)
        full = not cam.can_admit()
        waiter.cancel()
        return full

    assert asyncio.run(run())
    assert cam.can_admit()  # a cancelled pull releases its slot


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


def test_guest_pull_loop_is_smooth(client, guest_cookie):
    """What the page does, for 4s: ask for the next frame the moment the last
    lands. Must hold ~5fps with no hole a moving print head would show, and
    every frame must be fresh (the pull loop cannot queue)."""
    import time
    _printer_up(client, guest_cookie)
    seq, got, t0 = 0, [], time.monotonic()
    while time.monotonic() - t0 < 4.0:
        r = client.get(f"/printer/frame?after={seq}", headers=guest_cookie)
        if r.status_code == 200:
            seq = int(r.headers["x-frame-seq"])
            got.append(time.monotonic())
    gaps = [b - a for a, b in zip(got, got[1:])]
    fps = len(gaps) / (got[-1] - got[0])
    assert fps >= 1 / GUEST_FRAME_INTERVAL * 0.85, f"{fps:.2f}fps"
    assert max(gaps) < GUEST_FRAME_INTERVAL * 1.75, f"max gap {max(gaps) * 1000:.0f}ms"
