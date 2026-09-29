"""What only the HOST may do, each as a signed action.

The host is whoever acts first on a fresh poll: committing a vote, or saving
the settings (whether days are split into midday + night), claims the poll,
making that name + key vote order 0. After that only the same key can change the
settings or remove a guest.

Signed like a vote (Ed25519 over canonical JSON, server-clock skew window,
strictly newer ts than the signer's last), but over `sig.canonical_action`,
whose `kind` field keeps a vote and an action from ever being swapped.
"""
from noodle import config, slots, store
from noodle.votes import VoteError, check_action, host_of, now_ms


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


def _crop(body: dict) -> tuple[str | None, str | None]:
    """The host's crop: the first and last day on offer, or (None, None) for an
    uncropped, endless calendar. Both ends or neither."""
    lo, hi = body.get("from"), body.get("to")
    if lo is None and hi is None:
        return None, None
    try:
        slots.parse_window(lo, hi, 3 * 366)
    except (TypeError, ValueError) as e:
        raise VoteError(400, f"crop: {e}") from None
    return lo, hi


def _title(body: dict) -> tuple[str | None, str | None]:
    """The title rides along only when the host changed it: (as sent, cleaned)."""
    title = body.get("title")
    if title is None:
        return None, None
    clean = " ".join(title.split()) if isinstance(title, str) else ""
    if not clean or len(clean) > config.TITLE_MAX:
        raise VoteError(400, f"title must be 1-{config.TITLE_MAX} characters")
    return title, clean


def _note(body: dict) -> tuple[str | None, str | None]:
    """The host's note under the title, when changed: (as sent, cleaned). An
    empty note is allowed -- it clears it."""
    note = body.get("note")
    if note is None:
        return None, None
    if not isinstance(note, str) or len(note) > config.NOTE_MAX:
        raise VoteError(400, f"note must be at most {config.NOTE_MAX} characters")
    return note, note.strip()


def settings(slug: str, body: dict, now: int | None = None) -> dict:
    """The host's poll settings: split the days or not, the CROP -- the first
    and last week anyone can pick -- and, optionally, the poll's TITLE. On a
    fresh poll saving these CLAIMS it."""
    now = now_ms() if now is None else now
    halves = body.get("halves")
    if not isinstance(halves, bool):
        raise VoteError(400, "halves must be true or false")
    lo, hi = _crop(body)
    fields = {"kind": "settings", "halves": halves, "from": lo, "to": hi}
    # the optional texts ride along only when the host changed them, signed as
    # sent and stored cleaned
    texts = {k: v for k, v in (("title", _title(body)), ("note", _note(body))) if v[0] is not None}
    fields.update({k: sent for k, (sent, _) in texts.items()})
    key, pub, ts = check_action(slug, body, fields, now)
    try:
        with store.edit(slug) as poll:
            if not poll["voters"]:
                poll["voters"][key] = {"name": key, "pub": pub, "slots": [], "ts": ts, "order": 0}
            else:
                _as_host(poll, key, pub, ts)
            if halves != poll.get("halves", True):
                for v in poll["voters"].values():
                    v["slots"] = slots.convert(v["slots"], halves)
            if lo:
                # narrowing the crop takes days outside it off everyone's vote
                for v in poll["voters"].values():
                    v["slots"] = [x for x in v["slots"] if lo <= x[:10] <= hi]
            poll.update(halves=halves, **{"from": lo, "to": hi})
            poll.update({k: clean for k, (_, clean) in texts.items()})
    except KeyError:
        raise VoteError(404, "no such poll") from None
    return {"halves": halves, "from": lo, "to": hi}


def remove(slug: str, body: dict, now: int | None = None) -> dict:
    """Remove a guest, and their vote with them. Never the host."""
    now = now_ms() if now is None else now
    target = body.get("target")
    if not isinstance(target, str):
        raise VoteError(400, "who should be removed?")
    key, pub, ts = check_action(slug, body, {"kind": "remove", "target": target}, now)
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
