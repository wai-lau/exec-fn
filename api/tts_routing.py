"""Pure routing decisions for the TTS proxy -- stdlib only, no FastAPI/httpx.

Kept dependency-free so the dev venv (pytest + httpx, no fastapi) can import
and unit-test it without dragging the whole app graph (auth/pages/routers ->
anthropic, etc.). routes_tts.py imports these and keeps only the plumbing."""


def pick_upstream(req, home: str, piper: str) -> str:
    """Route one utterance to its backend's upstream. Glados (backend "piper")
    is served by the always-on droplet container; every other backend goes to
    the home GPU box over the SSH tunnel. A non-dict request defaults home."""
    if isinstance(req, dict) and req.get("backend") == "piper":
        return piper
    return home


def died_mid_utterance(conns: dict, busy: dict, url: str, upstream) -> bool:
    """True iff an upstream stream just ended while an utterance was still in
    flight on the LIVE connection for `url` -- i.e. the backend vanished without
    sending its own {end}/{error} and the proxy must synthesize one.

    Two things disqualify it. An utterance that already terminated (`busy` false)
    needs nothing. And a connection that is no longer the one cached for `url`
    was deliberately cut by _ws_dispatch to start a NEW utterance on a fresh
    socket -- synthesizing an error for that superseded stream would abort the
    utterance that replaced it."""
    return conns.get(url) is upstream and bool(busy.get(url))


def merge_voices(piper_voices: list[dict], home_voices: list[dict]) -> list[dict]:
    """Merge the two upstreams' voice lists: the piper voices come from the
    always-on piper upstream, everything else from the home box. Filtering each
    side by backend keeps glados authoritative on the droplet and avoids a
    duplicate if the home box also happens to advertise piper."""
    out = [v for v in piper_voices if v.get("backend") == "piper"]
    out += [v for v in home_voices if v.get("backend") != "piper"]
    return out
