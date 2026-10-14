"""Serve-time cache-busting: every `/<asset>?v=<anything>` in an HTML response
becomes `?v=<content hash>` of the file actually being served.

Why: versioned static is cached `immutable` for a year (main.py
CacheControlMiddleware), so a stale `?v=` keeps the old file in every browser
that has it. The `?v=` used to be bumped BY HAND, policed by a pre-commit lint
(scripts/lint-cachebust.py) -- and that broke down once assets and the pages
naming them could live in different repos (an app submodule's template naming
the parent's /chrome.css could not be made to bump in the parent's commit).
Hashing at serve time makes the number in the source irrelevant: write `?v=1`,
or leave the old number; the response carries the file's real version.

Scope: text/html responses only (the pages and partials; JS that loads other
assets keeps its own hand-written `?v=`). Root-relative URLs, or this site's
absolute ones (the og:image). A URL whose file is not under the static dirs
(nightfall's bundle, a typo) is left exactly as written. Hashes are cached per
(path, mtime_ns, size), so a page costs one stat per asset it names.
"""
import hashlib
import re
from pathlib import Path

import app_paths

_EXT = r"css|js|mjs|woff2|woff|ttf|otf|png|jpe?g|webp|gif|svg|ico|mp3|m4a|wav|json|webmanifest|txt"
_REF = re.compile(
    r"(?P<pre>[\"'(=\s]|https://wai-lau\.net)"
    r"(?P<url>/[\w./-]+\.(?:" + _EXT + r"))\?v=[\w.-]*")
_cache: dict[str, tuple[int, int, str]] = {}


def _find(url: str) -> Path | None:
    rel = url.lstrip("/")
    if ".." in rel.split("/"):
        return None
    for d in app_paths.web_dirs():
        p = d / rel
        if p.is_file():
            return p
    return None


def version(url: str) -> str | None:
    """8 hex of the served file's sha256, or None when it is not a static file."""
    p = _find(url)
    if p is None:
        return None
    st = p.stat()
    hit = _cache.get(str(p))
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    h = hashlib.sha256(p.read_bytes()).hexdigest()[:8]
    _cache[str(p)] = (st.st_mtime_ns, st.st_size, h)
    return h


def rewrite(html: str) -> str:
    def sub(m: re.Match) -> str:
        v = version(m.group("url"))
        return m.group(0) if v is None else f"{m.group('pre')}{m.group('url')}?v={v}"
    return _REF.sub(sub, html)


class VersionedAssetsMiddleware:
    """Pure ASGI: buffers ONLY text/html bodies (small, never streamed), rewrites
    them, fixes Content-Length. Registered innermost, so GZip compresses the
    rewritten body. Skips the reverse proxies' pages and anything pre-encoded."""
    _SKIP = ("/printer/", "/nightfall-game/")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"].startswith(self._SKIP):
            return await self.app(scope, receive, send)
        start = None
        chunks: list[bytes] = []

        async def wrapped(message):
            nonlocal start
            if message["type"] == "http.response.start":
                headers = {k.lower(): v for k, v in message.get("headers", [])}
                ctype = headers.get(b"content-type", b"")
                if ctype.startswith(b"text/html") and b"content-encoding" not in headers:
                    start = message
                    return
                return await send(message)
            if start is None:
                return await send(message)
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return
            body = b"".join(chunks)
            try:
                body = rewrite(body.decode("utf-8")).encode("utf-8")
            except UnicodeDecodeError:
                pass
            start["headers"] = [(k, v) for k, v in start["headers"]
                                if k.lower() != b"content-length"]
            start["headers"].append((b"content-length", str(len(body)).encode()))
            await send(start)
            await send({"type": "http.response.body", "body": body, "more_body": False})

        await self.app(scope, receive, wrapped)
