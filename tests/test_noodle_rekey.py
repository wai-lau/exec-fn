"""Changing a passphrase (noodle/rekey.py): the old key signs the new public
key, and from then on only the new key is accepted for that name."""
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
    from noodle import config, host, rekey, sig, store, votes
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    slug = store.create("fresh", "2026-09-27T00:00:00")["slug"]
    return {"slug": slug, "host": host, "rekey": rekey, "sig": sig, "store": store, "votes": votes}


def _b64(b):
    return base64.b64encode(b).decode()


def pub(k):
    return _b64(k.public_key().public_bytes_raw())


def vote(m, k, name, slots, ts):
    msg = m["sig"].canonical(m["slug"], name, sorted(slots), ts)
    return {"name": name, "pub": pub(k), "slots": slots, "ts": ts, "sig": _b64(k.sign(msg))}


def rekey(m, old, new, name, ts, newname=None):
    newname = newname or name
    msg = m["sig"].canonical_action(name=name, poll=m["slug"], ts=ts, kind="rekey", newpub=pub(new),
                                    newname=newname)
    return {"name": name, "pub": pub(old), "ts": ts, "sig": _b64(old.sign(msg)), "newpub": pub(new),
            "newname": newname}


def fails(fn, *a, **kw):
    from noodle.votes import VoteError
    with pytest.raises(VoteError) as e:
        fn(*a, **kw)
    return e.value.status


def test_the_old_key_hands_the_name_to_the_new_one(m):
    old, new = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    m["votes"].submit(m["slug"], vote(m, old, "a", ["2027-03-04:d"], NOW), now=NOW)
    m["rekey"].rekey(m["slug"], rekey(m, old, new, "a", NOW + 1), now=NOW + 1)
    rec = m["store"].load(m["slug"])["voters"]["a"]
    assert rec["pub"] == pub(new) and rec["slots"] == ["2027-03-04:d"] and rec["order"] == 0
    assert fails(m["votes"].submit, m["slug"], vote(m, old, "a", [], NOW + 2), now=NOW + 2) == 403
    m["votes"].submit(m["slug"], vote(m, new, "a", [], NOW + 3), now=NOW + 3)


def test_a_rekeyed_host_is_still_the_host(m):
    old, new, g = (Ed25519PrivateKey.generate() for _ in range(3))
    m["votes"].submit(m["slug"], vote(m, old, "h", ["2027-03-04:d"], NOW), now=NOW)
    m["votes"].submit(m["slug"], vote(m, g, "g", [], NOW + 1), now=NOW + 1)
    m["rekey"].rekey(m["slug"], rekey(m, old, new, "h", NOW + 2), now=NOW + 2)
    msg = m["sig"].canonical_action(name="h", poll=m["slug"], ts=NOW + 3, kind="remove", target="g")
    body = {"name": "h", "pub": pub(new), "ts": NOW + 3, "sig": _b64(new.sign(msg)), "target": "g"}
    m["host"].remove(m["slug"], body, now=NOW + 3)
    assert set(m["store"].load(m["slug"])["voters"]) == {"h"}


def test_only_the_holder_rekeys_and_never_twice(m):
    old, new, x = (Ed25519PrivateKey.generate() for _ in range(3))
    assert fails(m["rekey"].rekey, m["slug"], rekey(m, old, new, "a", NOW), now=NOW) == 404
    m["votes"].submit(m["slug"], vote(m, old, "a", [], NOW), now=NOW)
    # a stranger's valid signature over their own key is not the holder's
    assert fails(m["rekey"].rekey, m["slug"], rekey(m, x, new, "a", NOW + 1), now=NOW + 1) == 403
    body = rekey(m, old, new, "a", NOW + 2)
    body["newpub"] = pub(x)   # swapped after signing
    assert fails(m["rekey"].rekey, m["slug"], body, now=NOW + 2) == 403
    body = rekey(m, old, new, "a", NOW + 2)
    body["newname"] = "b"   # renamed after signing
    assert fails(m["rekey"].rekey, m["slug"], body, now=NOW + 2) == 403
    body = rekey(m, old, new, "a", NOW + 2)
    body["newpub"] = "nope"
    assert fails(m["rekey"].rekey, m["slug"], body, now=NOW + 2) == 400
    assert fails(m["rekey"].rekey, m["slug"], rekey(m, old, new, "a", NOW), now=NOW) == 409
    m["rekey"].rekey(m["slug"], rekey(m, old, new, "a", NOW + 3), now=NOW + 3)
    assert fails(m["rekey"].rekey, m["slug"], rekey(m, old, x, "a", NOW + 4), now=NOW + 4) == 403


def test_a_vote_signature_is_not_a_rekey(m):
    old, new = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    m["votes"].submit(m["slug"], vote(m, old, "a", [], NOW), now=NOW)
    body = dict(vote(m, old, "a", [], NOW + 1), newpub=pub(new), newname="a")
    assert fails(m["rekey"].rekey, m["slug"], body, now=NOW + 1) == 403


def test_a_rename_moves_the_vote_and_keeps_its_place(m):
    old, new, g = (Ed25519PrivateKey.generate() for _ in range(3))
    m["votes"].submit(m["slug"], vote(m, old, "a", ["2027-03-04:d"], NOW), now=NOW)
    m["votes"].submit(m["slug"], vote(m, g, "g", [], NOW + 1), now=NOW + 1)
    assert fails(m["rekey"].rekey, m["slug"], rekey(m, old, new, "a", NOW + 2, "G"), now=NOW + 2) == 409
    assert fails(m["rekey"].rekey, m["slug"], rekey(m, old, new, "a", NOW + 2, "a.b"), now=NOW + 2) == 400
    m["rekey"].rekey(m["slug"], rekey(m, old, new, "a", NOW + 3, "Jane Doe"), now=NOW + 3)
    v = m["store"].load(m["slug"])["voters"]
    assert set(v) == {"jane doe", "g"}
    assert v["jane doe"]["order"] == 0 and v["jane doe"]["slots"] == ["2027-03-04:d"]
    assert v["jane doe"]["name"] == "jane doe" and v["jane doe"]["pub"] == pub(new)
    m["votes"].submit(m["slug"], vote(m, new, "jane doe", [], NOW + 4), now=NOW + 4)
