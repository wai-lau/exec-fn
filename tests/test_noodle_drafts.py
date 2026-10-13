"""A poll that does not exist yet (noodle/drafts.py): "create poll" stores
nothing; the host's first commit, carrying the owner's token for that exact
slug, creates it -- and nothing else can."""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))


def _claim():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    raw = Ed25519PrivateKey.generate().public_key().public_bytes_raw()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


CLAIM = _claim()


@pytest.fixture
def d(monkeypatch, tmp_path):
    from noodle import config, drafts, store
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    monkeypatch.delenv("NOODLE_SECRET", raising=False)
    return drafts, store


def test_a_new_draft_stores_nothing(d):
    drafts, store = d
    n = drafts.new(CLAIM)
    assert store.valid_slug(n["slug"]) and not store.exists(n["slug"])
    assert store.all_polls() == []


def test_only_the_slugs_own_token_creates_it(d):
    drafts, store = d
    a, b = drafts.new(CLAIM), drafts.new(CLAIM)
    drafts.ensure(a["slug"], {"draft": b["token"]})     # someone else's token
    drafts.ensure(a["slug"], {"draft": "x" * 32})
    drafts.ensure(a["slug"], {})
    assert not store.exists(a["slug"])
    drafts.ensure(a["slug"], {"draft": a["token"]})
    poll = store.load(a["slug"])
    # a draft minted now becomes an END-TO-END poll: no title the server can read
    assert poll["e2e"] and "title" not in poll and poll["voters"] == {}
    assert poll["claim"] == CLAIM, "the creator's claim key rides into the poll"


def test_a_second_first_commit_does_not_recreate(d):
    drafts, store = d
    a = drafts.new(CLAIM)
    drafts.ensure(a["slug"], {"draft": a["token"]})
    with store.edit(a["slug"]) as p:
        p["title"] = "board games"
    drafts.ensure(a["slug"], {"draft": a["token"]})
    assert store.load(a["slug"])["title"] == "board games"


def test_the_secret_is_kept_private(d):
    drafts, store = d
    from noodle import config
    drafts.token("A" * 22)
    mode = (config.DATA_DIR / "secret.key").stat().st_mode & 0o777
    assert mode == 0o600



def test_starting_drafts_is_rate_limited_per_ip(d, monkeypatch):
    drafts, store = d
    from noodle import config
    monkeypatch.setattr(config, "NEW_RATE", 2)
    drafts._starts.clear()
    drafts.new_for("203.0.113.1", CLAIM, now=0)
    drafts.new_for("203.0.113.1", CLAIM, now=1)
    with pytest.raises(drafts.TooFast):
        drafts.new_for("203.0.113.1", CLAIM, now=2)
    drafts.new_for("203.0.113.2", CLAIM, now=2)                      # another address is fine
    drafts.new_for("203.0.113.1", CLAIM, now=config.NEW_WINDOW_S + 1)  # and the window rolls on


def test_the_token_binds_its_claim_key(d):
    drafts, store = d
    a = drafts.new(CLAIM)
    mac = a["token"].partition(".")[2]
    other = _claim()
    assert drafts.kind(a["slug"], f"{CLAIM}.{mac}") == "e2e"
    assert drafts.kind(a["slug"], f"{other}.{mac}") is None, "a swapped claim key voids the token"
    drafts.ensure(a["slug"], {"draft": f"{other}.{mac}"})
    assert not store.exists(a["slug"])


def test_end_to_end_drafts_without_a_claim_are_retired(d):
    # minted 2026-10-09..12: whoever saw one could take the host's seat
    import hashlib
    import hmac
    drafts, store = d
    s = "AbCdEfGhIjKlMnOpQrStUv"
    old = hmac.new(drafts._key(), b"e2e\0" + s.encode(), hashlib.sha256).hexdigest()[:32]
    assert drafts.kind(s, old) is None
    drafts.ensure(s, {"draft": old})
    assert not store.exists(s)


def test_a_bad_claim_or_token_is_refused_not_raised(d):
    drafts, store = d
    for bad in (None, "", "!" * 43, CLAIM + "A", 7):
        with pytest.raises(ValueError):
            drafts.new(bad)
        with pytest.raises(ValueError):
            drafts.new_for("203.0.113.9", bad, now=0)
    s = drafts.new(CLAIM)["slug"]
    assert drafts.kind(s, "\u00e9" * 32) is None, "a non-ASCII token is no token (compare_digest would raise)"
