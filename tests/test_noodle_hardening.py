"""noodle's crypto/authorization hardening from the 2026-10-14 security audit:
hostile text never 500s, degenerate Ed25519 keys never verify, a key that left
a poll cannot be replayed back in, an unclaimed end-to-end poll cannot be
claimed by a slug-holder, plain orders stay unique, dates are YYYY-MM-DD only."""
import base64
import json
import os
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import config, drafts, e2e, host, sig, slots, store, votes  # noqa: E402
from noodle.votes import VoteError  # noqa: E402

NOW = 1_790_000_000_000
CREATOR = Ed25519PrivateKey.generate()
P = 2**255 - 19


def pub(k):
    return base64.b64encode(k.public_key().public_bytes_raw()).decode()


def b64u(k):
    return base64.urlsafe_b64encode(k.public_key().public_bytes_raw()).decode().rstrip("=")


def signed(slug, k, ts, kind, **f):
    msg = sig.canonical_action(poll=slug, ts=ts, kind=kind, **f)
    return {"pub": pub(k), "ts": ts, "sig": base64.b64encode(k.sign(msg)).decode(), **f}


def blob():
    return base64.b64encode(os.urandom(40)).decode()


def evote(slug, k, ts):
    claim = base64.b64encode(CREATOR.sign(sig.canonical_action(kind="e2e-claim", poll=slug, voter=pub(k)))).decode()
    return e2e.vote(slug, {**signed(slug, k, ts, "e2e-vote", ct=blob()), "claim": claim}, now=ts)


@pytest.fixture
def slug(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    d = drafts.new(b64u(CREATOR))
    drafts.ensure(d["slug"], {"draft": d["token"]})
    return d["slug"]


def fails(fn, *a, **kw):
    with pytest.raises(VoteError) as e:
        fn(*a, **kw)
    return e.value.status


def test_a_lone_surrogate_is_a_refusal_not_a_500(slug):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    evote(slug, h, NOW)
    evote(slug, g, NOW + 1)
    body = json.loads('{"target": "\\ud800"}')
    req = {"pub": pub(h), "ts": NOW + 2, "sig": base64.b64encode(bytes(64)).decode(), "target": body["target"]}
    assert fails(e2e.remove, slug, req, now=NOW + 2) == 403
    assert sig.canonical_action(kind="x", t=body["target"])   # encodes, no UnicodeEncodeError


def test_small_order_keys_never_verify():
    for raw in ((1).to_bytes(32, "little"), (P - 1).to_bytes(32, "little"), bytes(32),
                bytes.fromhex("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05"),
                bytes.fromhex("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a")):
        assert sig.small_order(raw) and not sig.valid_pub(base64.b64encode(raw).decode())
    identity = base64.b64encode((1).to_bytes(32, "little")).decode()
    forged = base64.b64encode((1).to_bytes(32, "little") + bytes(32)).decode()   # R = identity, S = 0
    assert not sig.verify(identity, forged, b"any message at all")
    for _ in range(50):
        assert not sig.small_order(Ed25519PrivateKey.generate().public_key().public_bytes_raw())


def test_a_key_that_moved_on_cannot_be_replayed_back_in(slug):
    old, new = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    first = {**signed(slug, old, NOW, "e2e-vote", ct=blob()),
             "claim": base64.b64encode(CREATOR.sign(sig.canonical_action(kind="e2e-claim", poll=slug, voter=pub(old)))).decode()}
    e2e.vote(slug, first, now=NOW)
    e2e.rekey(slug, signed(slug, old, NOW + 5, "e2e-rekey", newpub=pub(new), ct=blob()), now=NOW + 5)
    replay = signed(slug, old, NOW + 3, "e2e-vote", ct=blob())   # signed before the move
    assert fails(e2e.vote, slug, replay, now=NOW + 6) == 409
    assert list(store.load(slug)["voters"]) == [pub(new)]


def test_a_removed_voter_cannot_be_replayed_back_in(slug):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    evote(slug, h, NOW)
    gvote = signed(slug, g, NOW + 1, "e2e-vote", ct=blob())
    e2e.vote(slug, gvote, now=NOW + 1)
    e2e.remove(slug, signed(slug, h, NOW + 2, "e2e-remove", target=pub(g)), now=NOW + 2)
    assert fails(e2e.vote, slug, gvote, now=NOW + 3) == 409
    assert e2e.vote(slug, signed(slug, g, NOW + 4, "e2e-vote", ct=blob()), now=NOW + 4)["order"] == 1, \
        "a fresh vote may rejoin (the host can remove it again)"


def test_an_unclaimed_empty_e2e_poll_cannot_be_claimed(monkeypatch, tmp_path):
    # the 2026-10-09..12 shape: end-to-end, no claim, nobody voted yet
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    s = "AbCdEfGhIjKlMnOpQrStUv"
    store.try_create(s, "t", "2026-10-10T00:00:00", e2e=True)
    k = Ed25519PrivateKey.generate()
    assert fails(e2e.vote, s, signed(s, k, NOW, "e2e-vote", ct=blob()), now=NOW) == 403
    # but one that already has its voters goes on exactly as before
    with store.edit(s) as poll:
        poll["voters"][pub(k)] = {"pub": pub(k), "ts": NOW, "order": 0, "ct": blob()}
    g = Ed25519PrivateKey.generate()
    assert e2e.vote(s, signed(s, g, NOW + 1, "e2e-vote", ct=blob()), now=NOW + 1)["order"] == 1


def test_a_rekey_onto_a_degenerate_key_is_refused(slug):
    k = Ed25519PrivateKey.generate()
    evote(slug, k, NOW)
    bad = base64.b64encode((1).to_bytes(32, "little")).decode()
    assert fails(e2e.rekey, slug, signed(slug, k, NOW + 1, "e2e-rekey", newpub=bad, ct=blob()), now=NOW + 1) == 400


def test_plain_orders_stay_unique_after_a_removal(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    s = store.create("t", "2026-10-14T00:00:00")["slug"]
    keys = {n: Ed25519PrivateKey.generate() for n in ("h", "a", "b", "c")}

    def vote(name, ts):
        k = keys[name]
        votes.submit(s, {"name": name, "pub": pub(k), "slots": [], "ts": ts,
                         "sig": base64.b64encode(k.sign(sig.canonical(s, name, [], ts))).decode()}, now=ts)
    vote("h", NOW)
    vote("a", NOW + 1)
    vote("b", NOW + 2)
    msg = sig.canonical_action(name="h", poll=s, ts=NOW + 3, kind="remove", target="a")
    host.remove(s, {"name": "h", "pub": pub(keys["h"]), "ts": NOW + 3, "target": "a",
                    "sig": base64.b64encode(keys["h"].sign(msg)).decode()}, now=NOW + 3)
    vote("c", NOW + 4)
    orders = sorted(v["order"] for v in store.load(s)["voters"].values())
    assert len(orders) == len(set(orders)), orders


@pytest.mark.parametrize("bad", ["20261013", "2026-W42-1", "2026-10-1", " 2026-10-13", 7, None])
def test_dates_are_yyyy_mm_dd_only(bad):
    with pytest.raises(ValueError):
        slots.parse_window(bad, "2026-10-20")
    if isinstance(bad, str) and len(bad) == 10:
        with pytest.raises(ValueError):
            slots.parse_slot(bad + ":m")
    assert slots.parse_slot("2026-10-13:m")[1] == "m"
