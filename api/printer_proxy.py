"""Pure rewrite helpers for the /printer reverse proxy (no I/O, no deps).

The ELEGOO Centauri Carbon serves an Angular SPA on :80 that assumes it is the
ORIGIN: `<base href="/">`, root-absolute asset paths, a hard-coded
`ws://<hostname>:3030/websocket` (SDCP control socket), and an MJPEG video
URL (`<ip>:3031/video`) that arrives over that socket and is prefixed with
`"http://"` in the template. Served from https://wai-lau.net under a path
prefix, every one of those breaks (wrong origin, mixed content, wrong port).
These rewrites re-anchor the app on the proxy: HTML + JS bodies are patched
in flight, and the SDCP frames flowing browser-ward have their video URL
rewritten to the same-origin MJPEG route.

Covered: the SDCP socket (:3030), the MJPEG camera (:3031), the file
host (:80) and the root-absolute "/assets/…" image paths baked into the
compiled Angular templates. NOT covered, on purpose: the WebRTC signalling socket
(`ws://<host>:8883`, only reached when the printer advertises the
`VIDEO_WEBRTC` capability -- this unit reports FILE_TRANSFER / PRINT_CONTROL /
VIDEO_STREAM only). Wiring it would need a fourth tunnel port + relay; until
then it passes through untouched (pinned by a regression test).

Kept dependency-free so the unit tests can import it without the app's
httpx/websockets stack (mirrors tts_routing.py vs routes_tts.py)."""

import re

PREFIX = "/printer"            # HTTP proxy mount: /printer/<upstream path>
WS_PATH = "/ws/printer"        # same-origin SDCP websocket proxy
VIDEO_PATH = f"{PREFIX}/video"  # same-origin MJPEG proxy

# <base href="/"> + every root-absolute href/src ("/assets/…") -> under PREFIX.
# The negative lookahead keeps protocol-relative "//cdn…" URLs untouched.
_ABS_ATTR_RE = re.compile(r'\b(href|src)="/(?!/)')

# main.js: `ws://${this.hostName}:3030/websocket` (a template literal) -> the
# same-origin proxy, scheme following the page (wss under https). Only the
# literal's inner text is swapped; the surrounding backticks stay.
_WS_URL_RE = re.compile(r"ws://\$\{[^}]*\}:3030/websocket")
_WS_URL_SUB = '${location.protocol==="https:"?"wss":"ws"}://${location.host}' + WS_PATH

# 25.<hash>.js (monitor/control views): `"http://"+(…VideoUrl)` on the <img>
# src. Drop the scheme so the rewritten same-origin VideoUrl is used verbatim
# (an http:// image is mixed content on the https page).
_VIDEO_SRC_RE = re.compile(r'"http://"\+(\([^()]*\.VideoUrl\))')

# `http://${…hostName}:80…` (file download href + upload POST target) -> the
# proxy prefix on the page's own origin. Also inside template literals.
_HOST80_RE = re.compile(r"http://\$\{[^}]*hostName\}:80")
_HOST80_SUB = "${location.origin}" + PREFIX

# Angular templates compiled into the bundles carry root-absolute image paths
# ("/assets/images/network/start.png" etc.) that would resolve against the
# site root, not the proxy. Rewrite the quoted string-literal form only.
_JS_ASSETS_RE = re.compile(r'(["\'`])/assets/')
_JS_ASSETS_SUB = r"\1" + PREFIX + "/assets/"

# SDCP frame (printer -> browser): "VideoUrl":"192.168.x.y:3031/video" (set by
# the enable-video-stream reply, cmd 386) -> the same-origin MJPEG route.
_VIDEO_URL_RE = re.compile(r'("VideoUrl"\s*:\s*")[^"]*:3031/video(")')


def rewrite_html(body: str) -> str:
    """Re-root the SPA shell under PREFIX (base href + absolute asset paths)."""
    return _ABS_ATTR_RE.sub(rf'\1="{PREFIX}/', body)


def rewrite_js(body: str) -> str:
    """Patch the SPA's hard-coded printer-origin URLs to the proxy's routes."""
    body = _WS_URL_RE.sub(_WS_URL_SUB, body)
    body = _VIDEO_SRC_RE.sub(r"\1", body)
    body = _HOST80_RE.sub(_HOST80_SUB, body)
    return _JS_ASSETS_RE.sub(_JS_ASSETS_SUB, body)


def rewrite_ws_text(text: str) -> str:
    """Rewrite the video URL in a printer->browser SDCP text frame."""
    return _VIDEO_URL_RE.sub(rf"\g<1>{VIDEO_PATH}\2", text)


def rewrite_kind(content_type: str) -> str | None:
    """'html' / 'js' when the body needs rewriting, else None (stream through)."""
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if ct == "text/html":
        return "html"
    if ct in ("application/javascript", "text/javascript", "application/x-javascript"):
        return "js"
    return None


# Request headers forwarded to the printer. An ALLOWLIST: the session cookie
# and the admin bearer must never reach the printer, and accept-encoding is
# pinned to identity so rewritable bodies arrive uncompressed. content-length
# rides along so a streamed upload body is sent with a known length (the
# printer's tiny HTTP server is not trusted to speak chunked).
_REQ_FORWARD = ("accept", "accept-language", "content-type", "content-length",
                "if-none-match", "if-modified-since", "range", "user-agent",
                "x-requested-with")
# Response headers passed back. Hop-by-hop, content-length (bodies get
# rewritten) and content-encoding (httpx already decoded) are dropped.
_RESP_FORWARD = ("content-type", "etag", "last-modified", "content-disposition",
                 "accept-ranges", "content-range")
# Every proxied response is auth-gated, so it is never a shared-cache
# candidate: private, and revalidated each time (the etag round-trip makes
# that a 304 for the hashed bundles). main.py's CacheControlMiddleware skips
# the prefix so its public/immutable stamp for static suffixes never applies.
CACHE_CONTROL = "private, no-cache"


def upstream_request_headers(headers) -> dict:
    """Allowlisted copy of the browser's request headers for the printer."""
    out = {k: v for k, v in headers.items() if k.lower() in _REQ_FORWARD}
    out["accept-encoding"] = "identity"
    return out


def client_response_headers(headers) -> dict:
    """Allowlisted copy of the printer's response headers for the browser.
    Only a root-relative Location survives (re-rooted under PREFIX); an
    absolute, protocol-relative or otherwise odd redirect target is dropped
    rather than sending the owner's browser off-origin."""
    out = {k: v for k, v in headers.items() if k.lower() in _RESP_FORWARD}
    out["cache-control"] = CACHE_CONTROL
    loc = headers.get("location")
    if loc and loc.startswith("/") and not loc.startswith(("//", "/\\")):
        out["location"] = f"{PREFIX}{loc}"
    return out
