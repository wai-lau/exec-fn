"""Polls made BEFORE the 2026-10-14 rules keep the old ones (owner: "don't
break old polls, keep them as special cases"). A poll without the "v" stamp
(noodle/store.py RULES) is old: no seat or file-size cap, no per-poll write
limit, an end-to-end poll with no claim seats its first voter as host as it
always did, and its pages accept unsigned records. New polls get every rule."""
import base64
import os
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import config, e2e, limits, sig, store, votes  # noqa: E402

NOW = 1_790_000_000_000
SLUG = "AbCdEfGhIjKlMnOpQrStUv"


def pub(k):
    return base64.b64encode(k.public_key().public_bytes_raw()).decode()


def ebody(slug, k, ts, n=40):
    ct = base64.b64encode(os.urandom(n)).decode()
    msg = sig.canonical_action(poll=slug, ts=ts, kind="e2e-vote", ct=ct)
    return {"pub": pub(k), "ts": ts, "sig": base64.b64encode(k.sign(msg)).decode(), "ct": ct}


def make_old(e2e_poll=True):
    """A poll as it was stored before the stamp: same shape, no "v"."""
    store.try_create(SLUG, "old poll", "2026-10-10T00:00:00", e2e=e2e_poll)
    with store.edit(SLUG) as poll:
        poll.pop("v")
        poll.pop("claim", None)
    assert store.is_legacy(SLUG)


@pytest.fixture(autouse=True)
def data(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)


def test_new_polls_carry_the_rules_stamp():
    store.try_create(SLUG, "new", "2026-10-14T12:00:00", e2e=True, claim="x")
    assert not store.is_legacy(SLUG) and store.load(SLUG)["v"] == store.RULES
    assert not store.legacy(store.create("plain", "2026-10-14T12:00:00"))


def test_an_old_unclaimed_e2e_poll_seats_its_first_voter_as_before():
    make_old()
    k = Ed25519PrivateKey.generate()
    assert e2e.vote(SLUG, ebody(SLUG, k, NOW), now=NOW)["order"] == 0


def test_old_polls_have_no_seat_cap(monkeypatch):
    monkeypatch.setattr(config, "MAX_VOTERS", 2)
    make_old()
    for i in range(4):
        e2e.vote(SLUG, ebody(SLUG, Ed25519PrivateKey.generate(), NOW + i), now=NOW + i)
    assert len(store.load(SLUG)["voters"]) == 4


def test_an_old_plain_poll_has_no_seat_cap(monkeypatch):
    monkeypatch.setattr(config, "MAX_VOTERS", 1)
    make_old(e2e_poll=False)
    for i, name in enumerate(("ada", "bo")):
        k = Ed25519PrivateKey.generate()
        votes.submit(SLUG, {"name": name, "pub": pub(k), "slots": [], "ts": NOW + i,
                            "sig": base64.b64encode(k.sign(sig.canonical(SLUG, name, [], NOW + i))).decode()},
                     now=NOW + i)
    assert len(store.load(SLUG)["voters"]) == 2


def test_old_polls_have_no_size_cap(monkeypatch):
    monkeypatch.setattr(config, "POLL_FILE_MAX", 500)
    make_old()
    for i in range(5):
        e2e.vote(SLUG, ebody(SLUG, Ed25519PrivateKey.generate(), NOW + i, n=200), now=NOW + i)
    assert len(store.load(SLUG)["voters"]) == 5


def test_old_polls_are_not_write_limited(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from noodle import routes
    monkeypatch.setattr(config, "WRITE_IP_RATE", 1)
    limits._hits.clear()
    make_old()
    app = FastAPI()
    app.include_router(routes.router)
    c = TestClient(app)
    for _ in range(3):
        assert c.post(f"/api/noodle/{SLUG}/settings", json={}).status_code != 429
    new = "ZyXwVuTsRqPoNmLkJiHgFe"
    store.try_create(new, "t", "2026-10-14T12:00:00", e2e=True, claim="x")
    c.post(f"/api/noodle/{new}/settings", json={})
    assert c.post(f"/api/noodle/{new}/settings", json={}).status_code == 429, "new polls keep the limit"


def test_the_page_is_told_an_old_poll_is_old():
    make_old()
    assert e2e.public(store.load(SLUG))["legacy"] is True
    store.try_create("ZyXwVuTsRqPoNmLkJiHgFe", "t", "2026-10-14T12:00:00", e2e=True, claim="x")
    assert "legacy" not in e2e.public(store.load("ZyXwVuTsRqPoNmLkJiHgFe"))
