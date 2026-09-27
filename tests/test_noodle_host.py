"""The host's signed actions (noodle/host.py): claiming a fresh poll, splitting
or unsplitting its days, and removing guests.

The host is whoever acts first on a fresh poll (a vote, or saving the
settings); after that only the same key can act. There are no dates to set --
the calendar is endless. Actions are signed over a canonical form with
a `kind` field, so a vote signature can never be replayed as an action.
"""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
pytest.importorskip("cryptography")
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

NOW = 1_790_000_000_000


@pytest.fixture
def m(monkeypatch, tmp_path):
    from noodle import config, host, sig, store, votes
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    slug = store.create("fresh", "2026-09-27T00:00:00")["slug"]
    return {"slug": slug, "host": host, "sig": sig, "store": store, "votes": votes}


def _b64(b):
    return base64.b64encode(b).decode()


def pub(k):
    return _b64(k.public_key().public_bytes_raw())


def settings(m, k, name, halves, ts=NOW):
    msg = m["sig"].canonical_action(name=name, poll=m["slug"], ts=ts, kind="settings", halves=halves)
    return {"name": name, "pub": pub(k), "ts": ts, "sig": _b64(k.sign(msg)), "halves": halves}


def remove(m, k, name, target, ts):
    msg = m["sig"].canonical_action(name=name, poll=m["slug"], ts=ts, kind="remove", target=target)
    return {"name": name, "pub": pub(k), "ts": ts, "sig": _b64(k.sign(msg)), "target": target}


def vote(m, k, name, slots, ts):
    msg = m["sig"].canonical(m["slug"], name, sorted(slots), ts)
    return {"name": name, "pub": pub(k), "slots": slots, "ts": ts, "sig": _b64(k.sign(msg))}


def fails(fn, *a, **kw):
    from noodle.votes import VoteError
    with pytest.raises(VoteError) as e:
        fn(*a, **kw)
    return e.value.status


def test_a_fresh_poll_is_unsplit_and_the_first_vote_hosts(m):
    poll = m["store"].load(m["slug"])
    assert poll["halves"] is False and "start" not in poll
    k = Ed25519PrivateKey.generate()
    m["votes"].submit(m["slug"], vote(m, k, "a", ["2027-03-04:d"], NOW), now=NOW)
    assert m["votes"].host_of(m["store"].load(m["slug"]))[0] == "a"


def test_first_to_save_settings_hosts(m):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    m["host"].settings(m["slug"], settings(m, h, "Host", True), now=NOW)
    poll = m["store"].load(m["slug"])
    assert poll["halves"] is True and poll["voters"]["host"]["order"] == 0
    # someone else cannot change it, even with a valid signature of their own
    assert fails(m["host"].settings, m["slug"],
                 settings(m, g, "guest", True, NOW + 1), now=NOW + 1) == 403
    # the host can, with a newer timestamp only
    m["host"].settings(m["slug"], settings(m, h, "host", True, NOW + 2), now=NOW + 2)
    assert fails(m["host"].settings, m["slug"],
                 settings(m, h, "host", True, NOW + 2), now=NOW + 2) == 409


def test_bad_settings_are_refused(m):
    h = Ed25519PrivateKey.generate()
    body = settings(m, h, "h", False)
    body["halves"] = "yes"
    assert fails(m["host"].settings, m["slug"], body, now=NOW) == 400
    body = settings(m, h, "h", False)
    body["halves"] = True   # tampered after signing
    assert fails(m["host"].settings, m["slug"], body, now=NOW) == 403


def test_unsplit_polls_take_whole_days_only(m):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    m["host"].settings(m["slug"], settings(m, h, "h", False), now=NOW)
    assert fails(m["votes"].submit, m["slug"], vote(m, h, "h", ["2026-10-02:m"], NOW + 1), now=NOW + 1) == 400
    m["votes"].submit(m["slug"], vote(m, h, "h", ["2026-10-02:d", "2026-10-03:d"], NOW + 2), now=NOW + 2)
    rec = m["votes"].submit(m["slug"], vote(m, g, "g", ["2026-10-03:d"], NOW + 3), now=NOW + 3)
    assert rec["slots"] == ["2026-10-03:d"]


def test_splitting_and_unsplitting_convert_everyones_picks(m):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    m["host"].settings(m["slug"], settings(m, h, "h", False), now=NOW)
    m["votes"].submit(m["slug"], vote(m, h, "h", ["2026-10-02:d", "2026-10-03:d"], NOW + 1), now=NOW + 1)
    m["votes"].submit(m["slug"], vote(m, g, "g", ["2026-10-03:d"], NOW + 2), now=NOW + 2)
    m["host"].settings(m["slug"], settings(m, h, "h", True, NOW + 3), now=NOW + 3)
    v = m["store"].load(m["slug"])["voters"]
    assert v["h"]["slots"] == ["2026-10-02:m", "2026-10-02:n", "2026-10-03:m", "2026-10-03:n"]
    assert v["g"]["slots"] == ["2026-10-03:m", "2026-10-03:n"]
    m["votes"].submit(m["slug"], vote(m, g, "g", ["2026-10-03:m"], NOW + 4), now=NOW + 4)
    m["host"].settings(m["slug"], settings(m, h, "h", False, NOW + 5), now=NOW + 5)
    v = m["store"].load(m["slug"])["voters"]
    assert v["h"]["slots"] == ["2026-10-02:d", "2026-10-03:d"]
    assert v["g"]["slots"] == [], "midday alone is not the whole day"


def test_the_host_removes_a_guest_and_only_the_host_can(m):
    h, g, x = (Ed25519PrivateKey.generate() for _ in range(3))
    m["host"].settings(m["slug"], settings(m, h, "h", False), now=NOW)
    m["votes"].submit(m["slug"], vote(m, g, "g", [], NOW + 1), now=NOW + 1)
    m["votes"].submit(m["slug"], vote(m, x, "x", [], NOW + 2), now=NOW + 2)
    assert fails(m["host"].remove, m["slug"], remove(m, g, "g", "x", NOW + 3), now=NOW + 3) == 403
    assert fails(m["host"].remove, m["slug"], remove(m, h, "h", "h", NOW + 4), now=NOW + 4) == 400
    assert fails(m["host"].remove, m["slug"], remove(m, h, "h", "nobody", NOW + 5), now=NOW + 5) == 404
    m["host"].remove(m["slug"], remove(m, h, "h", "X", NOW + 6), now=NOW + 6)
    assert set(m["store"].load(m["slug"])["voters"]) == {"h", "g"}
    replay = remove(m, h, "h", "g", NOW + 6)
    assert fails(m["host"].remove, m["slug"], replay, now=NOW + 6) == 409


def test_a_vote_signature_is_not_an_action_signature(m):
    h = Ed25519PrivateKey.generate()
    m["host"].settings(m["slug"], settings(m, h, "h", False), now=NOW)
    v = vote(m, h, "h", [], NOW + 1)
    body = dict(v, target="h")
    assert fails(m["host"].remove, m["slug"], body, now=NOW + 1) == 403
