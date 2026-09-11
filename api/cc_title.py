"""A rolling title for the /cc conversation.

The SDK has a `summary` per session, but on a live conversation it is usually
just the opening prompt -- which is exactly what the status bar was showing
back. The good titles in Wai's terminal come from her own recap hook
(`~/.claude/hooks/session-recap-gen.js`), which asks haiku for a tiny rolling
title every few prompts. This is that, app-side.

App-side rather than in the sidecar deliberately: the sidecar would have to
spawn another `claude` subprocess on a 1967MB box that already caps itself at
one concurrent run, while the app has haiku wired for exactly this class of
cheap call (card classification, date parsing).
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


def _ask(messages: list) -> str | None:
    import anthropic

    recent = [m for m in messages if (m.get("text") or "").strip()][-_MAX_MSGS:]
    if not recent:
        return None
    body = "\n".join(
        f"{m.get('role', 'user')}: {(m.get('text') or '')[:_MAX_CHARS]}" for m in recent
    )
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=32,
        system=(
            "Write a 3-6 word title for what this conversation is CURRENTLY about, "
            "weighting the latest messages most. Output ONLY the title: no quotes, "
            "no punctuation at the end, no preamble."
        ),
        messages=[{"role": "user", "content": body}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    text = text.strip('"').strip()
    return text[:60] or None


def rolling_title(session_id: str, messages: list) -> str | None:
    """Cached per session, regenerated every `_EVERY` messages.

    Never raises: a status bar without a title is fine, and a failed haiku call
    must not take the page's title endpoint down with it.
    """
    if not session_id or not messages:
        return None
    cache = _load()
    entry = cache.get(session_id) or {}
    n = len(messages)
    if entry.get("title") and n - int(entry.get("at", 0)) < _EVERY:
        return entry["title"]
    try:
        title = _ask(messages)
    except Exception:
        return entry.get("title")    # keep the last good one rather than blanking
    if not title:
        return entry.get("title")
    cache[session_id] = {"title": title, "at": n}
    _save(cache)
    return title
