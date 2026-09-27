"""Changing a voter's passphrase: the OLD key signs the NEW public key.

A name is bound to the key its first vote was signed with, and the passphrase
IS that key -- so changing it means re-binding the name, which only the key
that holds it may do. The browser derives both keys, signs
canonical_action(kind="rekey", newpub=...) with the old one, and from then on
the server expects the new one. The passphrase itself never arrives here,
old or new.

Same envelope as a host action (host._check: skew window, signature), then the
voter's own replay check: strictly newer than their last signed request.
"""
from noodle import sig, store
from noodle.host import _check
from noodle.votes import VoteError, now_ms


def rekey(slug: str, body: dict, now: int | None = None) -> dict:
    now = now_ms() if now is None else now
    newpub = body.get("newpub")
    try:
        sig.b64d(newpub, 32)
    except (TypeError, ValueError):
        raise VoteError(400, "newpub must be a public key") from None
    key, pub, ts = _check(slug, body, {"kind": "rekey", "newpub": newpub}, now)
    try:
        with store.edit(slug) as poll:
            rec = poll["voters"].get(key)
            if not rec:
                raise VoteError(404, "that name has not committed yet")
            if rec["pub"] != pub:
                raise VoteError(403, "that name is sealed with a different passphrase")
            if ts <= rec["ts"]:
                raise VoteError(409, "stale or replayed request")
            rec["pub"], rec["ts"] = newpub, ts
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"name": key}
