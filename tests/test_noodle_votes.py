"""Noodle's signed votes: first submission binds a name to a public key; every
later one must be signed by that key and newer than the last.

Covers the required rejections -- unsigned edit, wrong key, tampered slots,
replay -- plus clock skew, out-of-window slots, name normalization, the
owner's key reset, and that a rejected vote never changes the file.
"""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from noodle_helpers import make_poll  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
pytest.importorskip("cryptography")
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

NOW = 1_790_000_000_000


@pytest.fixture
def mods(monkeypatch, tmp_path):
    from noodle import config, sig, slots, store, votes
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    return {"slug": make_poll(store, "t", "2026-10-01", "2026-10-10"), "sig": sig, "slots": slots, "store": store, "votes": votes}


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def signed(m, key, name, slots, ts, slug=None):
    slug = slug or m["slug"]
    msg = m["sig"].canonical(slug, name, sorted(set(slots)), ts)
    return {"name": name, "pub": _b64(key.public_key().public_bytes_raw()),
            "slots": slots, "ts": ts, "sig": _b64(key.sign(msg))}


def submit(m, body, now=NOW):
    return m["votes"].submit(m["slug"], body, now=now)


def err(m, body, now=NOW):
    with pytest.raises(m["votes"].VoteError) as e:
        submit(m, body, now)
    return e.value.status


def test_first_vote_binds_and_same_key_edits(mods):
    k = Ed25519PrivateKey.generate()
    rec = submit(mods, signed(mods, k, "Ada", ["2026-10-02:n", "2026-10-01:m"], NOW))
    assert rec["slots"] == ["2026-10-01:m", "2026-10-02:n"]
    rec = submit(mods, signed(mods, k, "ada ", ["2026-10-03:m"], NOW + 5), now=NOW + 5)
    assert rec["slots"] == ["2026-10-03:m"] and rec["name"] == "ada" and rec["order"] == 0
    assert len(mods["store"].load(mods["slug"])["voters"]) == 1


def test_unsigned_edit_rejected(mods):
    k = Ed25519PrivateKey.generate()
    submit(mods, signed(mods, k, "Ada", ["2026-10-01:m"], NOW))
    body = signed(mods, k, "Ada", ["2026-10-02:m"], NOW + 1)
    body.pop("sig")
    assert err(mods, body, NOW + 1) == 403
    body["sig"] = ""
    assert err(mods, body, NOW + 1) == 403


def test_wrong_key_rejected(mods):
    submit(mods, signed(mods, Ed25519PrivateKey.generate(), "Ada", ["2026-10-01:m"], NOW))
    other = Ed25519PrivateKey.generate()
    assert err(mods, signed(mods, other, "ADA", ["2026-10-05:n"], NOW + 1), NOW + 1) == 403
    assert mods["store"].load(mods["slug"])["voters"]["ada"]["slots"] == ["2026-10-01:m"]


def test_signature_by_other_key_than_claimed_pub_rejected(mods):
    a, b = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    body = signed(mods, a, "Ada", ["2026-10-01:m"], NOW)
    body["pub"] = _b64(b.public_key().public_bytes_raw())
    assert err(mods, body) == 403


def test_tampered_slots_rejected(mods):
    k = Ed25519PrivateKey.generate()
    body = signed(mods, k, "Ada", ["2026-10-01:m"], NOW)
    body["slots"] = ["2026-10-01:m", "2026-10-02:n"]
    assert err(mods, body) == 403
    for field, val in (("name", "Eve"), ("ts", NOW + 1)):
        b2 = signed(mods, k, "Ada", ["2026-10-01:m"], NOW)
        b2[field] = val
        assert err(mods, b2) == 403, field


def test_signature_for_another_poll_rejected(mods):
    k = Ed25519PrivateKey.generate()
    other = make_poll(mods["store"], "u", "2026-10-01", "2026-10-10")
    assert err(mods, signed(mods, k, "Ada", ["2026-10-01:m"], NOW, slug=other)) == 403


def test_replay_rejected(mods):
    k = Ed25519PrivateKey.generate()
    first = signed(mods, k, "Ada", ["2026-10-01:m"], NOW)
    submit(mods, first)
    assert err(mods, first, NOW + 10) == 409            # exact replay
    older = signed(mods, k, "Ada", ["2026-10-04:m"], NOW - 1)
    assert err(mods, older, NOW + 10) == 409            # older than the last accepted


def test_clock_skew_rejected(mods):
    from noodle import config
    k = Ed25519PrivateKey.generate()
    assert err(mods, signed(mods, k, "Ada", [], NOW - config.TS_SKEW_MS - 1)) == 400
    assert err(mods, signed(mods, k, "Ada", [], NOW + config.TS_SKEW_MS + 1)) == 400


def test_malformed_and_absurd_slots_rejected(mods):
    """No window any more -- the calendar is endless -- but a slot must be well
    formed, of the poll's kind, and not absurdly far out."""
    k = Ed25519PrivateKey.generate()
    for bad in (["2019-12-31:m"], ["2099-10-11:n"], ["2026-10-01:x"], ["2026-10-1:m"], "nope",
                ["2026-10-01:d"]):   # a split poll takes m/n, never whole days
        body = signed(mods, k, "Ada", ["2026-10-01:m"], NOW)
        body["slots"] = bad
        assert err(mods, body) == 400, bad
    ok = signed(mods, k, "Ada", ["2027-06-30:n", "2026-12-01:m"], NOW)   # far ahead is fine
    assert submit(mods, ok)["slots"] == ["2026-12-01:m", "2027-06-30:n"]


def test_bad_name_and_unknown_poll(mods):
    k = Ed25519PrivateKey.generate()
    assert err(mods, signed(mods, k, "   ", [], NOW)) == 400
    assert err(mods, signed(mods, k, "a​b", [], NOW)) == 400     # format char
    assert err(mods, signed(mods, k, "x" * 41, [], NOW)) == 400
    with pytest.raises(mods["votes"].VoteError) as e:
        mods["votes"].submit("A" * 22, signed(mods, k, "Ada", [], NOW), now=NOW)
    assert e.value.status == 404


def test_name_normalization():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
    from noodle.slots import normalize_name
    assert normalize_name("  Ada   LOVELACE ") == "ada lovelace"
    assert normalize_name("Ａda") == "ada"                        # fullwidth A, NFKC


def test_owner_reset_lets_a_new_key_bind(mods):
    a, b = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    submit(mods, signed(mods, a, "Ada", ["2026-10-01:m"], NOW))
    assert err(mods, signed(mods, b, "Ada", ["2026-10-02:m"], NOW + 1), NOW + 1) == 403
    assert mods["votes"].reset_voter(mods["slug"], "ADA") is True
    rec = submit(mods, signed(mods, b, "Ada", ["2026-10-02:m"], NOW + 2), now=NOW + 2)
    assert rec["slots"] == ["2026-10-02:m"] and rec["order"] == 0
    assert mods["votes"].reset_voter(mods["slug"], "nobody") is False


def test_slug_shape_guards_the_filesystem(mods):
    store = mods["store"]
    for bad in ("../../etc/passwd", "a" * 21, "a" * 23, "a/b" + "c" * 19, "", None):
        assert not store.valid_slug(bad)
        with pytest.raises(KeyError):
            store.load(bad)


# ── the host: whoever commits first; their halves are the only ones on offer ──
def test_first_voter_hosts_and_others_pick_only_what_they_offered(mods):
    host, guest = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    submit(mods, signed(mods, host, "Host", ["2026-10-01:m", "2026-10-02:n"], NOW))
    assert err(mods, signed(mods, guest, "Guest", ["2026-10-01:n"], NOW + 1), NOW + 1) == 400
    rec = submit(mods, signed(mods, guest, "Guest", ["2026-10-02:n"], NOW + 2), now=NOW + 2)
    assert rec["slots"] == ["2026-10-02:n"]
    assert mods["votes"].host_of(mods["store"].load(mods["slug"]))[0] == "host"


def test_the_host_can_change_their_offer_freely(mods):
    host = Ed25519PrivateKey.generate()
    submit(mods, signed(mods, host, "Host", ["2026-10-01:m"], NOW))
    rec = submit(mods, signed(mods, host, "HOST", ["2026-10-05:n", "2026-10-06:m"], NOW + 1), now=NOW + 1)
    assert rec["slots"] == ["2026-10-05:n", "2026-10-06:m"]


def test_an_empty_offer_leaves_nothing_to_pick(mods):
    submit(mods, signed(mods, Ed25519PrivateKey.generate(), "Host", [], NOW))
    guest = Ed25519PrivateKey.generate()
    assert err(mods, signed(mods, guest, "Guest", ["2026-10-01:m"], NOW + 1), NOW + 1) == 400
    submit(mods, signed(mods, guest, "Guest", [], NOW + 2), now=NOW + 2)
