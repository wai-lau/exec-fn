"""END-TO-END polls: the server stores ciphertext it has no key for.

Every poll started since 2026-10-09 is one. Its key is 32 random bytes the
creator's browser makes and keeps in the link's FRAGMENT (`#k=...`), which a
browser never sends -- so the server never holds it, not even in flight.
Polls made before then (and the owner's titled API create) stay on the
plain path (votes.py / host.py / rekey.py), untouched, so their links work.

What is sealed (AES-256-GCM in the browser, web/noodle-e2e.js):
  head          {title, note, halves, from, to}       -- the host's settings
  each voter    {name, slots}                          -- bound to their pub
What the server still sees and checks: public keys, vote order, timestamps
and signatures -- so it still enforces who may write what (only you change
your vote; only the host changes the head or removes a guest; only your old
key moves you to a new one) and replay. What it can no longer check, the
browser applies when it draws the poll (web/noodle-e2e.js ndeView): the
host's offer, the crop, the split, one seat per name.

Each signed object carries an `e2e-*` kind, so nothing signed for one
action (or for a plain poll) verifies as another. Storage is the same
store.py file, so the at-rest layer still wraps it.
"""
import base64

from noodle import config, sig, store
from noodle.votes import VoteError, now_ms

CT_MAX = 6000   # base64 chars of one sealed object; BODY_MAX_VOTE caps the whole body too
_CT_MIN = 12 + 16   # nonce + GCM tag: anything shorter cannot be a sealed object


def is_e2e(slug: str) -> bool:
    """Whether a STORED poll is end-to-end (a missing one is not)."""
    try:
        return bool(store.load(slug).get("e2e"))
    except KeyError:
        return False


def _ct(body: dict, key: str = "ct") -> str:
    ct = body.get(key)
    if not isinstance(ct, str) or not ct or len(ct) > CT_MAX:
        raise VoteError(400, "sealed data missing or too large")
    try:
        raw = base64.b64decode(ct, validate=True)
    except ValueError:
        raise VoteError(400, "sealed data is not base64") from None
    if len(raw) < _CT_MIN:
        raise VoteError(400, "sealed data too short")
    return ct


def _check(slug: str, body: dict, fields: dict, now: int) -> tuple[str, int]:
    """The signed envelope: ts shape, the skew window, an Ed25519 signature
    by `pub` over canonical_action(poll, ts, **fields) -> (pub, ts)."""
    pub, signature, ts = body.get("pub"), body.get("sig"), body.get("ts")
    if not isinstance(pub, str) or not isinstance(ts, int) or isinstance(ts, bool):
        raise VoteError(400, "pub and ts are required")
    if abs(now - ts) > config.TS_SKEW_MS:
        raise VoteError(400, "timestamp too far from server time")
    if not sig.verify(pub, signature, sig.canonical_action(poll=slug, ts=ts, **fields)):
        raise VoteError(403, "signature does not match")
    return pub, ts


def _host(poll: dict) -> dict | None:
    voters = poll["voters"]
    return min(voters.values(), key=lambda v: v["order"]) if voters else None


def _as_host(poll: dict, pub: str, ts: int) -> dict:
    host = _host(poll)
    if not host or host["pub"] != pub:
        raise VoteError(403, "only the host can do that")
    if ts <= host["ts"]:
        raise VoteError(409, "stale or replayed request")
    host["ts"] = ts
    return host


def vote(slug: str, body: dict, now: int | None = None) -> dict:
    """Store a voter's sealed {name, slots} under their key. The FIRST key to
    vote on a fresh poll is its host (order 0)."""
    now = now_ms() if now is None else now
    ct = _ct(body)
    pub, ts = _check(slug, body, {"kind": "e2e-vote", "ct": ct}, now)
    try:
        with store.edit(slug) as poll:
            voters = poll["voters"]
            prev = voters.get(pub)
            if prev and ts <= prev["ts"]:
                raise VoteError(409, "stale or replayed submission")
            order = prev["order"] if prev else max((v["order"] for v in voters.values()), default=-1) + 1
            voters[pub] = {"pub": pub, "ts": ts, "order": order, "ct": ct}
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"pub": pub, "order": order}


def head(slug: str, body: dict, now: int | None = None) -> dict:
    """The host's sealed settings (title, note, split, crop), whole each time."""
    now = now_ms() if now is None else now
    ct = _ct(body)
    pub, ts = _check(slug, body, {"kind": "e2e-head", "ct": ct}, now)
    try:
        with store.edit(slug) as poll:
            _as_host(poll, pub, ts)
            poll["head"] = {"ct": ct, "ts": ts}
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"ok": True}


def remove(slug: str, body: dict, now: int | None = None) -> dict:
    """The host removes a guest (by public key) and their vote. Never themself."""
    now = now_ms() if now is None else now
    target = body.get("target")
    if not isinstance(target, str):
        raise VoteError(400, "who should be removed?")
    pub, ts = _check(slug, body, {"kind": "e2e-remove", "target": target}, now)
    try:
        with store.edit(slug) as poll:
            _as_host(poll, pub, ts)
            if target == pub:
                raise VoteError(400, "the host cannot remove themselves")
            if target not in poll["voters"]:
                raise VoteError(404, "no such voter")
            del poll["voters"][target]
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"removed": target}


def rekey(slug: str, body: dict, now: int | None = None) -> dict:
    """A new name and/or passphrase: the OLD key signs the record over to the
    new one, with the vote re-sealed to the new key. Order (so the host role)
    is kept."""
    now = now_ms() if now is None else now
    newpub, ct = body.get("newpub"), _ct(body)
    try:
        sig.b64d(newpub, 32)
    except (TypeError, ValueError):
        raise VoteError(400, "newpub must be a public key") from None
    pub, ts = _check(slug, body, {"kind": "e2e-rekey", "newpub": newpub, "ct": ct}, now)
    try:
        with store.edit(slug) as poll:
            voters = poll["voters"]
            rec = voters.get(pub)
            if not rec:
                raise VoteError(404, "you have not committed yet")
            if ts <= rec["ts"]:
                raise VoteError(409, "stale or replayed request")
            if newpub != pub and newpub in voters:
                raise VoteError(409, "that name and passphrase are already on this poll")
            del voters[pub]
            voters[newpub] = {"pub": newpub, "ts": ts, "order": rec["order"], "ct": ct}
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"pub": newpub}


def public(poll: dict) -> dict:
    """What the page gets: sealed blobs + the public keys they belong to.
    Timestamps stay server-side (the page needs none of them)."""
    voters = sorted(poll["voters"].values(), key=lambda v: v["order"])
    h = poll.get("head")
    return {"slug": poll["slug"], "e2e": True, "head": {"ct": h["ct"]} if h else None,
            "voters": [{"pub": v["pub"], "order": v["order"], "ct": v["ct"]} for v in voters]}
