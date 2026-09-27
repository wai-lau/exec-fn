"""What only the HOST may do, each as a signed action.

The host is whoever acts first on a fresh poll: saving the settings (the date
range, and whether days are split into midday + night) claims the poll, making
that name + key vote order 0. After that only the same key can change the
settings or remove a guest.

Signed like a vote (Ed25519 over canonical JSON, server-clock skew window,
strictly newer ts than the signer's last), but over `sig.canonical_action`,
whose `kind` field keeps a vote and an action from ever being swapped.
"""
from noodle import config, sig, slots, store
from noodle.votes import VoteError, host_of, now_ms


def _check(slug: str, body: dict, fields: dict, now: int) -> tuple[str, str, int]:
    """Validate the common envelope and signature -> (name key, pub, ts)."""
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


def _as_host(poll: dict, key: str, pub: str, ts: int) -> dict:
    """The host's record, after checking this signer IS the host."""
    host = host_of(poll)
    if not host or host[0] != key or (host[1]["pub"] and host[1]["pub"] != pub):
        raise VoteError(403, "only the host can do that")
    rec = host[1]
    if ts <= rec["ts"]:
        raise VoteError(409, "stale or replayed request")
    rec["pub"], rec["ts"] = pub, ts
    return rec


def settings(slug: str, body: dict, now: int | None = None) -> dict:
    """Set the date range and split. On a fresh poll this CLAIMS it."""
    now = now_ms() if now is None else now
    start, end, halves = body.get("start"), body.get("end"), body.get("halves")
    if not isinstance(halves, bool):
        raise VoteError(400, "halves must be true or false")
    try:
        slots.parse_window(start, end)
    except (TypeError, ValueError) as e:
        raise VoteError(400, str(e)) from None
    key, pub, ts = _check(slug, body, {"kind": "settings", "start": start, "end": end,
                                       "halves": halves}, now)
    try:
        with store.edit(slug) as poll:
            if not poll["voters"]:
                poll["voters"][key] = {"name": key, "pub": pub, "slots": [], "ts": ts, "order": 0}
            else:
                _as_host(poll, key, pub, ts)
            was_split = poll.get("halves", True)
            for v in poll["voters"].values():
                picks = slots.convert(v["slots"], halves) if halves != was_split else v["slots"]
                v["slots"] = slots.within(picks, start, end)
            poll.update(start=start, end=end, halves=halves)
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"start": start, "end": end, "halves": halves}


def remove(slug: str, body: dict, now: int | None = None) -> dict:
    """Remove a guest, and their vote with them. Never the host."""
    now = now_ms() if now is None else now
    target = body.get("target")
    if not isinstance(target, str):
        raise VoteError(400, "who should be removed?")
    key, pub, ts = _check(slug, body, {"kind": "remove", "target": target}, now)
    try:
        victim = slots.normalize_name(target)
    except ValueError as e:
        raise VoteError(400, str(e)) from None
    try:
        with store.edit(slug) as poll:
            _as_host(poll, key, pub, ts)
            if victim == key:
                raise VoteError(400, "the host cannot remove themselves")
            if victim not in poll["voters"]:
                raise VoteError(404, "no such voter")
            del poll["voters"][victim]
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"removed": victim}
