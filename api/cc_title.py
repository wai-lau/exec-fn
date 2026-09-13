"""A rolling title for the /cc conversation.

The SDK has a `summary` per session, but on a live conversation it is usually
just the opening prompt -- which is exactly what the status bar was showing
back. The good titles in Wai's terminal come from her own recap hook
(`~/.claude/hooks/session-recap-gen.js`), which asks haiku for a tiny rolling
title every few prompts. This is that, app-side.

The generation itself lives in the SIDECAR (`claude-box/title-gen.mjs`), on the
subscription -- the same account /cc runs on, so naming a conversation costs no
API credit. It is two calls, not one: haiku writes a title, then a second,
independent haiku call judges whether it is title SHAPED and hands back one
sentence of feedback, which the writer gets one retry with. A model checking its
own output in the same breath talks itself into whatever it just wrote.

This module is the CACHE and the schedule -- when to re-title, and what to keep
when generation fails. It used to hold the model call too, against the Anthropic
API key; the docstring here argued for that on the grounds that the sidecar
would have to spawn a `claude` subprocess on a 1967MB box. It does, and that
cost is real (~304MB, ~7s a call), which is why the sidecar route is
single-flight and yields while a chat turn is in flight -- but it is the plan,
and the plan is what this should have been spending all along.
"""

import json

from helpers import DATA_DIR

_CACHE = DATA_DIR / "cc_titles.json"
# Re-title every few messages, the way the recap hook re-rolls: a conversation
# drifts, and a title from message two is wrong by message twenty.
_EVERY = 4
_MAX_MSGS = 12       # the latest N messages are what the title is about
_MAX_CHARS = 400     # per message, so one pasted essay cannot dominate


def _load() -> dict:
    try:
        return json.loads(_CACHE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save(data: dict) -> None:
    try:
        tmp = _CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(_CACHE)
    except OSError:
        pass   # a title that does not persist is a re-generated title, not an error


async def _ask(messages: list) -> str | None:
    """Hand the transcript to the sidecar's write-then-check loop.

    The trimming below is duplicated there (it has to be -- the sidecar caps
    what it feeds the model regardless of who calls it); doing it here too keeps
    a long transcript off the wire in the first place.
    """
    import cc_client

    recent = [m for m in messages if (m.get("text") or "").strip()][-_MAX_MSGS:]
    if not recent:
        return None
    payload = [
        {"role": m.get("role", "user"), "text": (m.get("text") or "")[:_MAX_CHARS]}
        for m in recent
    ]
    out = await cc_client.generate_title(payload)
    return (out.get("title") or "").strip()[:60] or None


def cached_title(session_id: str) -> str | None:
    """A title already generated for this session, or None.

    Read-only on purpose: the conversation list shows dozens of sessions and
    must not fire a haiku call per row to name them.
    """
    entry = (_load().get(session_id) or {}) if session_id else {}
    return entry.get("title") or None


async def rolling_title(session_id: str, messages: list) -> str | None:
    """Cached per session, regenerated every `_EVERY` messages.

    Never raises: a status bar without a title is fine, and a failed generation
    must not take the page's title endpoint down with it. The sidecar likewise
    answers `title: null` rather than an error when it is busy or a chat turn is
    in flight, which lands here as "keep the cached one".
    """
    if not session_id or not messages:
        return None
    cache = _load()
    entry = cache.get(session_id) or {}
    n = len(messages)
    if entry.get("title") and n - int(entry.get("at", 0)) < _EVERY:
        return entry["title"]
    try:
        title = await _ask(messages)
    except Exception:
        return entry.get("title")    # keep the last good one rather than blanking
    if not title:
        return entry.get("title")
    cache[session_id] = {"title": title, "at": n}
    _save(cache)
    return title
