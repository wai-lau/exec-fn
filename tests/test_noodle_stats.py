"""Polls created per day (noodle/stats.py), for the owner's chart on /noodle:
counted as polls are created -- the sealed polls cannot say when they were --
once per poll, never for the test suite's own requests, owner-only to read."""
import base64
import sys
from datetime import date
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import config, drafts, stats, store  # noqa: E402


@pytest.fixture(autouse=True)
def data(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    return tmp_path


def _claim():
    raw = Ed25519PrivateKey.generate().public_key().public_bytes_raw()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def test_counts_add_up_per_day_and_hold_nothing_else(data):
    assert stats.per_day() == {}
    stats.record(date(2026, 10, 8))
    stats.record(date(2026, 10, 8))
    stats.record(date(2026, 10, 13))
    assert stats.per_day() == {"2026-10-08": 2, "2026-10-13": 1}
    assert (data / "created.json").read_text() == '{"2026-10-08": 2, "2026-10-13": 1}'


def test_a_broken_file_reads_as_no_counts(data):
    (data / "created.json").write_text("{not json")
    assert stats.per_day() == {}


def test_ensure_says_created_once_per_poll():
    d = drafts.new(_claim())
    body = {"draft": d["token"]}
    assert drafts.ensure(d["slug"], body) is True
    assert drafts.ensure(d["slug"], body) is False, "a second first commit creates nothing"
    assert drafts.ensure(drafts.new(_claim())["slug"], {"draft": "nope"}) is False
    assert store.try_create(d["slug"], "t", "2026-10-13T00:00:00") is False


def _client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from noodle import routes
    monkeypatch.setattr(routes, "_RL_EXEMPT", "the-suite")
    app = FastAPI()
    app.include_router(routes.router)
    app.include_router(routes.owner_router)
    return TestClient(app)


def test_the_routes_count_real_creations_and_skip_the_suites(monkeypatch):
    c = _client(monkeypatch)
    today = date.today().isoformat()
    c.post("/api/noodle-polls", json={"title": "real"})
    c.post("/api/noodle-polls", json={"title": "test"}, headers={"x-ratelimit-exempt": "the-suite"})
    d = drafts.new(_claim())
    for _ in range(2):   # a draft's first commit creates it (the vote itself fails: unsigned)
        c.post(f"/api/noodle/{d['slug']}/vote", json={"draft": d["token"]})
    assert store.exists(d["slug"])
    assert c.get("/api/noodle-polls/created").json() == {"days": {today: 2}}
