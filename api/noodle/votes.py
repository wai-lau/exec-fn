"""Accepting a signed vote: first submission binds a name to a public key,
every later one must be signed by that same key, newer than the last."""
import time

from noodle import config, sig, slots, store


class VoteError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status, self.msg = status, msg


def now_ms() -> int:
    return int(time.time() * 1000)


def submit(slug: str, body: dict, now: int | None = None) -> dict:
    """Validate + store one vote. Returns the stored voter record.

    Order matters: everything cheap and stateless (shape, window, signature,
    clock skew) is checked before the lock, so a flood of junk never contends
    with real voters; only the binding + replay checks need the file."""
    now = now_ms() if now is None else now
    name, pub, signature, ts = (body.get(k) for k in ("name", "pub", "sig", "ts"))
    if not isinstance(name, str) or not isinstance(ts, int) or isinstance(ts, bool):
        raise VoteError(400, "name and ts are required")
    try:
        key = slots.normalize_name(name)
        poll = store.load(slug)
        picked = slots.clean_slots(body.get("slots"), poll["start"], poll["end"])
    except KeyError:
        raise VoteError(404, "no such poll") from None
    except ValueError as e:
        raise VoteError(400, str(e)) from None
    if abs(now - ts) > config.TS_SKEW_MS:
        raise VoteError(400, "timestamp too far from server time")
    if not sig.verify(pub, signature, sig.canonical(slug, name, picked, ts)):
        raise VoteError(403, "signature does not match")

    with store.edit(slug) as poll:
        voters = poll["voters"]
        prev = voters.get(key)
        # an empty pub is a key the owner reset: the next signer re-binds it
        if prev and prev["pub"] and prev["pub"] != pub:
            raise VoteError(403, "that name is sealed with a different passphrase")
        if prev and ts <= prev["ts"]:
            raise VoteError(409, "stale or replayed submission")
        rec = {
            # the NORMALIZED name is the one shown too: it is the identity, and
            # showing first-typed casing made "Wai" and "wai" look like two people
            "name": key,
            "pub": pub, "slots": picked, "ts": ts,
            "order": prev["order"] if prev else len(voters),
        }
        voters[key] = rec
    return rec


def reset_voter(slug: str, raw_name: str) -> bool:
    """Owner recovery (scripts/noodle-reset-voter.py): forget a name's key so
    its next submission binds afresh. Keeps the voter's column position."""
    key = slots.normalize_name(raw_name)
    with store.edit(slug) as poll:
        rec = poll["voters"].get(key)
        if not rec:
            return False
        rec["pub"] = ""
        rec["ts"] = 0
    return True
