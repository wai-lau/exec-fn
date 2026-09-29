"""Changing a voter's passphrase and/or name: the OLD key signs the NEW public
key and the new name.

A name is bound to the key its first vote was signed with, and the passphrase
IS that key -- so changing it means re-binding the name, which only the key
that holds it may do. The browser derives both keys, signs
canonical_action(kind="rekey", newpub=...) with the old one, and from then on
the server expects the new one. The passphrase itself never arrives here,
old or new. A new NAME is the same operation: the key is salted with the name,
so renaming also means a new key, and the record moves to the new name
(slots, order and so the host role all kept).

Same envelope as a host action (votes.check_action: skew window, signature), then the
voter's own replay check: strictly newer than their last signed request.
"""
from noodle import sig, slots, store
from noodle.votes import VoteError, check_action, now_ms


def rekey(slug: str, body: dict, now: int | None = None) -> dict:
    now = now_ms() if now is None else now
    newpub, newname = body.get("newpub"), body.get("newname")
    try:
        sig.b64d(newpub, 32)
    except (TypeError, ValueError):
        raise VoteError(400, "newpub must be a public key") from None
    try:
        newkey = slots.normalize_name(newname)
    except ValueError as e:
        raise VoteError(400, f"new name: {e}") from None
    key, pub, ts = check_action(slug, body, {"kind": "rekey", "newpub": newpub, "newname": newname}, now)
    try:
        with store.edit(slug) as poll:
            rec = poll["voters"].get(key)
            if not rec:
                raise VoteError(404, "that name has not committed yet")
            if rec["pub"] != pub:
                raise VoteError(403, "that name is sealed with a different passphrase")
            if ts <= rec["ts"]:
                raise VoteError(409, "stale or replayed request")
            if newkey != key and newkey in poll["voters"]:
                raise VoteError(409, "that name is taken")
            rec["pub"], rec["ts"], rec["name"] = newpub, ts, newkey
            if newkey != key:
                del poll["voters"][key]
                poll["voters"][newkey] = rec
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"name": newkey}
