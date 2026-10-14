"""noodle's abuse bounds on writes: a seat cap per poll, a sealed-file size cap,
per-IP and per-poll write rate limits -- and reads never wait on the store's
write lock. A slug alone used to be enough to add junk seats without end."""
import base64
import os
import sys
import threading
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import config, drafts, e2e, limits, sig, store, votes  # noqa: E402
from noodle.votes import VoteError  # noqa: E402

NOW = 1_790_000_000_000
CREATOR = Ed25519PrivateKey.generate()


def b64u(k):
    return base64.urlsafe_b64encode(k.public_key().public_bytes_raw()).decode().rstrip("=")


def pub(k):
    return base64.b64encode(k.public_key().public_bytes_raw()).decode()


@pytest.fixture
def slug(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    d = drafts.new(b64u(CREATOR))
    drafts.ensure(d["slug"], {"draft": d["token"]})
    return d["slug"]


def evote(slug, k, ts, n=40):
    ct = base64.b64encode(os.urandom(n)).decode()
    msg = sig.canonical_action(poll=slug, ts=ts, kind="e2e-vote", ct=ct)
    body = {"pub": pub(k), "ts": ts, "sig": base64.b64encode(k.sign(msg)).decode(), "ct": ct}
    claim = sig.canonical_action(kind="e2e-claim", poll=slug, voter=pub(k))
    return e2e.vote(slug, {**body, "claim": base64.b64encode(CREATOR.sign(claim)).decode()}, now=ts)


def test_an_end_to_end_poll_seats_at_most_max_voters(slug, monkeypatch):
    monkeypatch.setattr(config, "MAX_VOTERS", 3)
    keys = [Ed25519PrivateKey.generate() for _ in range(4)]
    for i, k in enumerate(keys[:3]):
        evote(slug, k, NOW + i)
    with pytest.raises(VoteError) as e:
        evote(slug, keys[3], NOW + 10)
    assert e.value.status == 409 and "full" in e.value.msg
    assert evote(slug, keys[1], NOW + 11)["order"] == 1, "a seat already there can always re-vote"


def test_a_plain_poll_seats_at_most_max_voters(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "MAX_VOTERS", 2)
    s = store.create("t", "2026-10-14T00:00:00")["slug"]
    for i, name in enumerate(("ada", "bo", "cy")):
        k = Ed25519PrivateKey.generate()
        body = {"name": name, "pub": pub(k), "slots": [], "ts": NOW + i,
                "sig": base64.b64encode(k.sign(sig.canonical(s, name, [], NOW + i))).decode()}
        if i < 2:
            votes.submit(s, body, now=NOW + i)
        else:
            with pytest.raises(VoteError) as e:
                votes.submit(s, body, now=NOW + i)
            assert e.value.status == 409


def test_a_poll_file_never_grows_past_the_cap(slug, monkeypatch):
    monkeypatch.setattr(config, "POLL_FILE_MAX", 3000)
    evote(slug, Ed25519PrivateKey.generate(), NOW)
    with pytest.raises(store.TooBig):
        for i in range(1, 20):
            evote(slug, Ed25519PrivateKey.generate(), NOW + i, n=400)
    assert len(store.load(slug)["voters"]) < 20, "the write that would pass the cap stored nothing"


def test_writes_are_rate_limited_per_ip_and_per_poll(monkeypatch):
    monkeypatch.setattr(config, "WRITE_IP_RATE", 2)
    monkeypatch.setattr(config, "WRITE_POLL_RATE", 3)
    limits._hits.clear()
    limits.take_write("A" * 22, "203.0.113.1", now=0)
    limits.take_write("A" * 22, "203.0.113.1", now=1)
    with pytest.raises(limits.Limited) as e:
        limits.take_write("B" * 22, "203.0.113.1", now=2)
    assert e.value.retry_after >= 1
    limits.take_write("A" * 22, "203.0.113.2", now=2)   # another address: the poll's 3rd
    with pytest.raises(limits.Limited):
        limits.take_write("A" * 22, "203.0.113.3", now=3)
    limits.take_write("A" * 22, "203.0.113.3", now=config.WRITE_POLL_WINDOW_S + 1)   # windows roll


def test_the_routes_throttle_writes_but_never_the_suite(monkeypatch, slug):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from noodle import routes
    monkeypatch.setattr(routes, "_RL_EXEMPT", "the-suite")
    monkeypatch.setattr(config, "WRITE_IP_RATE", 1)
    limits._hits.clear()
    app = FastAPI()
    app.include_router(routes.router)
    c = TestClient(app)
    assert c.post(f"/api/noodle/{slug}/vote", json={}).status_code != 429
    r = c.post(f"/api/noodle/{slug}/settings", json={})
    assert r.status_code == 429 and r.headers["retry-after"] and "wait" in r.json()["error"]
    assert c.post(f"/api/noodle/{slug}/remove", json={}, headers={"x-ratelimit-exempt": "the-suite"}).status_code != 429


def test_a_read_never_waits_for_the_write_lock(slug):
    got = []
    with store._LOCK:   # another poll's long write, say
        t = threading.Thread(target=lambda: got.append(store.load(slug)))
        t.start()
        t.join(timeout=2)
    assert got, "store.load blocked on the write lock"


def test_a_bad_slug_never_reaches_the_legacy_path(slug, tmp_path):
    outside = tmp_path.parent / "outside.json"
    outside.write_text("{}")
    with pytest.raises(KeyError):
        store.delete("../outside")
    assert outside.exists()
