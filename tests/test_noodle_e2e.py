"""End-to-end noodle polls (noodle/e2e.py): the server stores sealed blobs it
cannot open, and still enforces who may write which -- by key alone."""
import base64
import json
import os
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import config, drafts, e2e, pages, sig, store  # noqa: E402
from noodle.votes import VoteError  # noqa: E402

NOW = 1_790_000_000_000
CREATOR = Ed25519PrivateKey.generate()   # the claim key the creator's /noodle page derives


def b64u(k):
    return base64.urlsafe_b64encode(k.public_key().public_bytes_raw()).decode().rstrip("=")


@pytest.fixture
def slug(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    d = drafts.new(b64u(CREATOR))
    drafts.ensure(d["slug"], {"draft": d["token"]})
    return d["slug"]


def pub(k):
    return base64.b64encode(k.public_key().public_bytes_raw()).decode()


def claim(slug, k, by=CREATOR):
    """The claim key's signature over voter k: what makes a first vote the creator's."""
    msg = sig.canonical_action(kind="e2e-claim", poll=slug, voter=pub(k))
    return base64.b64encode(by.sign(msg)).decode()


def blob(n=40):
    return base64.b64encode(os.urandom(n)).decode()


def signed(slug, k, ts, kind, **fields):
    msg = sig.canonical_action(poll=slug, ts=ts, kind=kind, **fields)
    return {"pub": pub(k), "ts": ts, "sig": base64.b64encode(k.sign(msg)).decode(), **fields}


def vote(slug, k, ts, ct=None):
    # every vote carries the creator's claim: the server reads it only on the first
    body = signed(slug, k, ts, "e2e-vote", ct=ct or blob())
    return e2e.vote(slug, {**body, "claim": claim(slug, k)}, now=ts)


def fails(fn, *a, **kw):
    with pytest.raises(VoteError) as e:
        fn(*a, **kw)
    return e.value.status


def test_a_fresh_draft_makes_an_end_to_end_poll_with_nothing_readable(slug):
    poll = store.load(slug)
    assert poll["e2e"] and poll["head"] is None and poll["voters"] == {}
    assert "title" not in poll and poll["claim"] == b64u(CREATOR)


def test_old_plain_draft_tokens_are_retired(monkeypatch, tmp_path):
    # a bare mac over the slug (drafts handed out before 2026-10-09): whoever
    # had seen one could commit it first and host -- refused since 2026-10-14
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    s = "AbCdEfGhIjKlMnOpQrStUv"
    assert drafts.kind(s, drafts.token(s)) is None
    assert drafts.ensure(s, {"draft": drafts.token(s)}) is False and not store.exists(s)


def test_settings_never_create_an_end_to_end_poll(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    s = "AbCdEfGhIjKlMnOpQrStUv"
    drafts.ensure(s, {"draft": drafts.token(s, b64u(CREATOR))}, e2e_ok=False)
    assert not store.exists(s)


def test_only_the_creators_claim_casts_the_first_vote(slug):
    h, x = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    first = signed(slug, h, NOW, "e2e-vote", ct=blob())
    assert fails(e2e.vote, slug, first, now=NOW) == 403, "no claim"
    assert fails(e2e.vote, slug, {**first, "claim": claim(slug, h, by=x)}, now=NOW) == 403, "someone else's claim key"
    assert fails(e2e.vote, slug, {**first, "claim": claim(slug, x)}, now=NOW) == 403, "a claim for another voter"
    assert fails(e2e.vote, slug, {**first, "claim": "x" * 88}, now=NOW) == 403
    assert store.load(slug)["voters"] == {}, "a refused first vote stores nothing"
    assert e2e.vote(slug, {**first, "claim": claim(slug, h)}, now=NOW)["order"] == 0
    assert "claim" not in store.load(slug), "the claim is spent"
    g = Ed25519PrivateKey.generate()
    assert e2e.vote(slug, signed(slug, g, NOW + 1, "e2e-vote", ct=blob()), now=NOW + 1)["order"] == 1, \
        "later voters need no claim"


def test_the_slug_and_token_alone_never_take_the_host_seat(monkeypatch, tmp_path):
    # everything the server (or its access log) sees: the slug, the draft
    # token -- the claim's public half inside it -- and junk the observer seals
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    d = drafts.new(b64u(CREATOR))
    s, tok = d["slug"], d["token"]
    spy, host = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    early = {**signed(s, spy, NOW, "e2e-vote", ct=blob()), "draft": tok}
    drafts.ensure(s, early)
    assert fails(e2e.vote, s, early, now=NOW) == 403
    e2e.vote(s, {**signed(s, host, NOW + 1, "e2e-vote", ct=blob()), "draft": tok, "claim": claim(s, host)}, now=NOW + 1)
    e2e.head(s, signed(s, host, NOW + 2, "e2e-head", ct=blob()), now=NOW + 2)   # the creator hosts
    late = signed(s, spy, NOW + 3, "e2e-vote", ct=blob())
    assert e2e.vote(s, late, now=NOW + 3)["order"] == 1, "the spy can only queue behind"
    assert fails(e2e.remove, s, signed(s, spy, NOW + 4, "e2e-remove", target=pub(host)), now=NOW + 4) == 403


def test_first_voter_hosts_and_later_ones_queue(slug):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    assert vote(slug, h, NOW)["order"] == 0
    assert vote(slug, g, NOW + 1)["order"] == 1
    assert vote(slug, h, NOW + 2)["order"] == 0, "a re-vote keeps its seat"


def test_votes_are_signed_fresh_and_never_replayed(slug):
    k, x = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    body = {**signed(slug, k, NOW, "e2e-vote", ct=blob()), "claim": claim(slug, k)}
    e2e.vote(slug, body, now=NOW)
    assert fails(e2e.vote, slug, body, now=NOW) == 409
    forged = dict(signed(slug, x, NOW + 1, "e2e-vote", ct=blob()), pub=pub(k))
    assert fails(e2e.vote, slug, forged, now=NOW + 1) == 403
    assert fails(e2e.vote, slug, signed(slug, k, NOW, "e2e-vote", ct=blob()), now=NOW + 10**6) == 400
    assert fails(e2e.vote, slug, signed(slug, k, NOW + 2, "e2e-vote", ct="not base64!"), now=NOW + 2) == 400
    assert fails(e2e.vote, slug, signed(slug, k, NOW + 2, "e2e-vote", ct=blob(10)), now=NOW + 2) == 400


def test_a_signature_for_one_kind_never_passes_as_another(slug):
    k = Ed25519PrivateKey.generate()
    vote(slug, k, NOW)
    ct = blob()
    as_vote = signed(slug, k, NOW + 1, "e2e-vote", ct=ct)
    assert fails(e2e.head, slug, as_vote, now=NOW + 1) == 403


def test_only_the_host_seals_the_settings(slug):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    assert fails(e2e.head, slug, signed(slug, h, NOW, "e2e-head", ct=blob()), now=NOW) == 403, "nobody hosts yet"
    vote(slug, h, NOW)
    vote(slug, g, NOW + 1)
    assert fails(e2e.head, slug, signed(slug, g, NOW + 2, "e2e-head", ct=blob()), now=NOW + 2) == 403
    ct = blob()
    e2e.head(slug, signed(slug, h, NOW + 3, "e2e-head", ct=ct), now=NOW + 3)
    assert store.load(slug)["head"]["ct"] == ct
    assert fails(e2e.head, slug, signed(slug, h, NOW + 3, "e2e-head", ct=blob()), now=NOW + 3) == 409


def test_the_host_removes_guests_by_key_never_themself(slug):
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    vote(slug, h, NOW)
    vote(slug, g, NOW + 1)
    assert fails(e2e.remove, slug, signed(slug, g, NOW + 2, "e2e-remove", target=pub(h)), now=NOW + 2) == 403
    assert fails(e2e.remove, slug, signed(slug, h, NOW + 3, "e2e-remove", target=pub(h)), now=NOW + 3) == 400
    assert fails(e2e.remove, slug, signed(slug, h, NOW + 4, "e2e-remove", target="nobody"), now=NOW + 4) == 404
    e2e.remove(slug, signed(slug, h, NOW + 5, "e2e-remove", target=pub(g)), now=NOW + 5)
    assert list(store.load(slug)["voters"]) == [pub(h)]


def test_rekey_moves_the_seat_to_the_new_key(slug):
    old, new, g = (Ed25519PrivateKey.generate() for _ in range(3))
    vote(slug, old, NOW)
    vote(slug, g, NOW + 1)
    assert fails(e2e.rekey, slug, signed(slug, new, NOW + 2, "e2e-rekey", newpub=pub(new), ct=blob()),
                 now=NOW + 2) == 404, "a key with no seat has nothing to hand over"
    assert fails(e2e.rekey, slug, signed(slug, old, NOW + 2, "e2e-rekey", newpub=pub(g), ct=blob()),
                 now=NOW + 2) == 409
    ct = blob()
    e2e.rekey(slug, signed(slug, old, NOW + 3, "e2e-rekey", newpub=pub(new), ct=ct), now=NOW + 3)
    v = store.load(slug)["voters"]
    assert pub(old) not in v and v[pub(new)]["order"] == 0 and v[pub(new)]["ct"] == ct
    e2e.head(slug, signed(slug, new, NOW + 4, "e2e-head", ct=blob()), now=NOW + 4)   # still the host


def test_the_page_gets_blobs_and_keys_only(slug):
    h = Ed25519PrivateKey.generate()
    vote(slug, h, NOW)
    e2e.head(slug, signed(slug, h, NOW + 1, "e2e-head", ct=blob()), now=NOW + 1)
    view = e2e.public(store.load(slug))
    assert set(view) == {"slug", "e2e", "head", "voters"}
    assert set(view["head"]) == {"ct"} and set(view["voters"][0]) == {"pub", "order", "ct"}


def test_the_page_html_carries_no_title_or_note(slug):
    poll = store.load(slug)
    poll["title"] = "SECRET"   # even if one were there, an end-to-end page would not print it
    html = pages.vote_page(poll)
    assert "SECRET" not in html and 'data-e2e="1"' in html
    assert '<meta property="og:title" content="noodle">' in html


def test_the_routes_send_an_end_to_end_poll_down_its_own_path(slug):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from noodle import routes
    app = FastAPI()
    app.include_router(routes.router)
    c = TestClient(app)
    h, g = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    now = __import__("noodle").votes.now_ms()
    first = {**signed(slug, h, now, "e2e-vote", ct=blob()), "claim": claim(slug, h)}
    assert c.post(f"/api/noodle/{slug}/vote", json=first).status_code == 200
    assert c.post(f"/api/noodle/{slug}/vote", json=signed(slug, g, now + 1, "e2e-vote", ct=blob())).status_code == 200
    r = c.post(f"/api/noodle/{slug}/settings", json=signed(slug, h, now + 2, "e2e-head", ct=blob()))
    assert r.status_code == 200, r.text
    r = c.post(f"/api/noodle/{slug}/remove", json=signed(slug, h, now + 3, "e2e-remove", target=pub(g)))
    assert r.status_code == 200, r.text
    got = c.get(f"/api/noodle/{slug}").json()
    assert got["e2e"] is True and [v["pub"] for v in got["voters"]] == [pub(h)]
    # a plain-shaped vote is refused, not stored in the clear
    plain = {"name": "ada", "pub": pub(g), "slots": [], "ts": now + 4, "sig": "x" * 88}
    assert c.post(f"/api/noodle/{slug}/vote", json=plain).status_code == 400
    raw = json.dumps(store.load(slug))
    assert "ada" not in raw
