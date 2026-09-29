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


def check_action(slug: str, body: dict, fields: dict, now: int) -> tuple[str, str, int]:
    """The envelope every signed ACTION shares (host settings/remove, rekey):
    name + ts shape, the clock-skew window, and the Ed25519 signature over
    sig.canonical_action -> (normalized name, pub, ts). Who may act is the
    caller's check (host._as_host, rekey's binding)."""
    name, pub, signature, ts = (body.get(k) for k in ("name", "pub", "sig", "ts"))
    if not isinstance(name, str) or not isinstance(ts, int) or isinstance(ts, bool):
        raise VoteError(400, "name and ts are required")
    try:
        key = slots.normalize_name(name)
    except ValueError as e:
        raise VoteError(400, str(e)) from None
    if abs(now - ts) > config.TS_SKEW_MS:
        raise VoteError(400, "timestamp too far from server time")
    msg = sig.canonical_action(name=name, poll=slug, ts=ts, **fields)
    if not sig.verify(pub, signature, msg):
        raise VoteError(403, "signature does not match")
    return key, pub, ts


def host_of(poll: dict) -> tuple[str, dict] | None:
    """The poll's HOST: whoever committed first (vote order 0). The halves
    they pick are the only ones anyone else may pick. None before any vote."""
    voters = poll.get("voters") or {}
    if not voters:
        return None
    return min(voters.items(), key=lambda kv: kv[1]["order"])


def _in_crop(poll: dict, picked: list[str]) -> list[str]:
    """The host's crop is the first and last day anyone can pick."""
    lo, hi = poll.get("from"), poll.get("to")
    if lo and any(not lo <= s[:10] <= hi for s in picked):
        raise ValueError("a picked day is outside the host's crop")
    return picked


def _admit(poll: dict, prev, key: str, pub: str, ts: int, picked: list[str]):
    """The checks that need the poll AS IT IS NOW (inside the lock). Returns
    the host, as (name, record) or None."""
    # an empty pub is a key the owner reset: the next signer re-binds it
    if prev and prev["pub"] and prev["pub"] != pub:
        raise VoteError(403, "that name is sealed with a different passphrase")
    if prev and ts <= prev["ts"]:
        raise VoteError(409, "stale or replayed submission")
    # the crop again: the check before the lock read a copy a concurrent
    # narrowing can have made stale
    try:
        _in_crop(poll, picked)
    except ValueError as e:
        raise VoteError(400, str(e)) from None
    # and the split: the slot codes were checked against a pre-lock copy too.
    # A host flipping the split in between converts every stored vote; a vote
    # written in the OLD format would then be the offer, and trimming the
    # guests against it would empty every one of them.
    if picked and {s[11:] for s in picked} - slots.codes(poll.get("halves", True)):
        raise VoteError(409, "the poll's days were just split or joined -- look again and resubmit")
    host = host_of(poll)
    if host and host[0] != key and not set(picked) <= set(host[1]["slots"]):
        raise VoteError(400, "only the times the host offered can be picked")
    return host


def _trim_guests(voters: dict, host_key: str, offer: list[str]) -> None:
    """The HOST's picks are the offer: a time they drop is gone from every
    guest's vote too, or the dots would show agreement on it."""
    keep = set(offer)
    for k, v in voters.items():
        if k != host_key:
            v["slots"] = [s for s in v["slots"] if s in keep]


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
        picked = _in_crop(poll, slots.clean_slots(body.get("slots"), poll.get("halves", True)))
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
        host = _admit(poll, prev, key, pub, ts, picked)
        rec = {
            # the NORMALIZED name is the one shown too: it is the identity, and
            # showing first-typed casing made "Wai" and "wai" look like two people
            "name": key,
            "pub": pub, "slots": picked, "ts": ts,
            "order": prev["order"] if prev else len(voters),
        }
        voters[key] = rec
        if not host or host[0] == key:
            _trim_guests(voters, key, picked)
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
