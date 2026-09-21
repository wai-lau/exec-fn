"""The /graph page — graphify's self-contained codebase viz, re-served.

graph.html is a GENERATED artifact from the ./graphify-out volume, rebuilt
wholesale by /graphify, so everything site-specific is applied per request:
the privacy scrubs + node/edge drops (graph_scrub), the look — communities,
hexagons, no hover tooltips, degree-driven sizes (graph_style), and the shared
chrome (css, cyber fx, nav) injected here. Split out of routes_views.py so
both stay under the 500-line cap.

Applied per request, but not COMPUTED per request: the whole pipeline chews a
3.6MB string through ten json round-trips and measured 2.5-2.9s of CPU on every
single load. The artifact it reads changes once a day (the 05:00 graphify cron),
so the rendered bytes are memoised against its mtime+size — see `_cached`.
"""
import re
import asyncio
import hashlib
from pathlib import Path

from fastapi import Request
from fastapi.responses import HTMLResponse, Response

from routers import guest_protected
from pages import (
    _build_nav, _CHROME_LINK, _FONT_PRELOAD, _FAVICON, _APPLE_WEBAPP_META, _CRT_FX,
)
from auth import SESSION_TOKEN
from graph_scrub import (
    _redact_graph_nodes, _drop_graph_prefixed_nodes, _drop_graph_moltbook_nodes,
    _drop_graph_library_nodes, _drop_graph_inferred_edges, _drop_graph_orphan_nodes,
)
from graph_style import (
    _restyle_graph_nodes, _drop_graph_tooltips, _label_graph_nodes,
    _merge_graph_communities, _fix_graph_stats, _size_graph_by_degree,
    _tune_graph_physics, _brighten_graph_edges,
)


# /graph overlay assets live in web/ (graph-overlay.css/js) — not inline here.
# CSS = vertical-left nav + vis-network config-panel theme; JS = the firing
# overlay + zoom walls. Injected at serve time so they survive graph.html rebuilds.
_GRAPH_OVERLAY_CSS = '<link rel="stylesheet" href="/graph-overlay.css?v=43">'
# Order is the whole contract — same global scope, no modules. The draw half
# defines `graphPulseDraw`, the model half reads it at construction time, and
# graph-overlay.js starts the model.
_GRAPH_OVERLAY_JS = (
    '<script src="/graph-pulse-draw.js?v=1"></script>'
    '<script src="/graph-pulse.js?v=8"></script>'
    '<script src="/graph-overlay.js?v=47"></script>'
)
# graphify's graph.html has no viewport meta — without it mobile renders at
# desktop width and scales everything down (tiny buttons/text).
_VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1">'

_GRAPH_HTML = Path("/app/graphify-out/graph.html")

# Rendered pages by (artifact identity, guest) -> (html, etag). Two entries live
# at a time, ~7MB; the whole dict is dropped the moment graphify writes a new
# graph.html, so a stale render cannot outlive its source. Module-level rather
# than an lru_cache so the invalidation is the artifact's mtime, not a call count.
_CACHE: dict = {}
_CACHE_KEY = None
# The cold render is ~3s of straight CPU, so it runs off the event loop (a
# blocking route body would stall every SSE stream and nudge tick on the box for
# its duration) and under a lock, so a reload that lands two requests at once
# pays for one render rather than two.
_CACHE_LOCK = asyncio.Lock()


def _render(page: str, guest: bool) -> str:
    """The whole serve-time pipeline: scrub, drop, restyle, inject chrome. Pure —
    same artifact bytes in, same page bytes out — which is what makes the memo
    above sound, and what lets the content-hash ETag stay stable across a
    restart."""
    # Serve vis-network from our own origin (immutable-cached, no third-party
    # RTT) and unify with /emet's 9.1.9 so both share one cached copy. Replace
    # the whole CDN tag (its SRI integrity hash is pinned to graphify's 9.1.6,
    # so a bare URL swap would fail the integrity check). Regex so it survives
    # graphify regenerating graph.html.
    page = re.sub(
        r'<script src="https://unpkg\.com/vis-network@.*?</script>',
        '<script src="/vendor/vis-network-9.1.9.min.js?v=1"></script>',
        page, count=1, flags=re.DOTALL,
    )
    page = _redact_graph_nodes(page)
    # Whole trees that aren't this codebase's structure: the tarot reference
    # book, vendored libs, and the nightfall game's own React source.
    page = _drop_graph_prefixed_nodes(page)
    page = _drop_graph_moltbook_nodes(page)
    # Drop imported library/framework symbols (BaseModel, Request, ...) — not our
    # code, just clutter.
    page = _drop_graph_library_nodes(page)
    # Drop dashed (INFERRED, low-confidence) edges before the stats rewrite so the
    # edge count reflects reality — thins the physics/canvas load for a faster render.
    page = _drop_graph_inferred_edges(page)
    # Then the nodes nothing connects to any more — they drew nothing (the overlay
    # hid them) but were parsed, built and walked every frame regardless.
    page = _drop_graph_orphan_nodes(page)
    # Merge graphify's many fine-grained communities into feature-based groups and
    # cap the count (after the drops) so each gets a distinct, memorable colour —
    # 54 communities over a 28-colour palette is colour noise, not an encoding.
    page = _merge_graph_communities(page)
    # Labels + the canvas font, baked once here instead of walked client-side.
    page = _label_graph_nodes(page)
    # Size nodes exponentially by edge count, so hubs read as hubs.
    page = _size_graph_by_degree(page)
    # And make the UNLIT edges readable — they are the structure the page is for.
    page = _brighten_graph_edges(page)
    # Header counts are baked pre-scrub; rewrite to the merged/dropped reality.
    page = _fix_graph_stats(page)
    # Disable vis-network's improvedLayout — the graph is too large for it to
    # position (it warns + costs perf). Patched here so it survives /graphify.
    page = page.replace(
        "{ nodes: nodesDS, edges: edgesDS }, {",
        "{ nodes: nodesDS, edges: edgesDS }, {\n  layout: { improvedLayout: false },",
        1,
    )
    # One stabilisation pass, then physics off for good, and straight edges.
    page = _tune_graph_physics(page)
    # Hexagon nodes + bg-filled (coloured-outline) look, matching /emet; repoints
    # the neighbour-stripe colour to the border. After the merge so node colours exist.
    page = _restyle_graph_nodes(page)
    # No hover tooltips — drop `title:` from both DataSet mappers.
    page = _drop_graph_tooltips(page)
    page = page.replace("</head>", _VIEWPORT_META + _APPLE_WEBAPP_META + _FAVICON + _FONT_PRELOAD + _CHROME_LINK + _GRAPH_OVERLAY_CSS + "</head>", 1)
    return page.replace("</body>", _CRT_FX + _build_nav("graph", guest=guest) + _GRAPH_OVERLAY_JS + "</body>", 1)


async def _cached(guest: bool):
    """The rendered page + its ETag for this tier, rendering only when the
    artifact on disk is not the one already in the cache. Keyed on mtime_ns+size
    rather than a content hash so the check costs one stat, not a 3.6MB read."""
    global _CACHE_KEY
    st = _GRAPH_HTML.stat()
    key = (st.st_mtime_ns, st.st_size)
    async with _CACHE_LOCK:
        if key != _CACHE_KEY:
            _CACHE.clear()
            _CACHE_KEY = key
        if guest not in _CACHE:
            _CACHE[guest] = await asyncio.to_thread(_build, guest)
        return _CACHE[guest]


def _build(guest: bool):
    """Render + hash, off the event loop."""
    page = _render(_GRAPH_HTML.read_text(), guest)
    return page, '"%s"' % hashlib.md5(page.encode()).hexdigest()


@guest_protected.get("/graph", response_class=HTMLResponse)
async def graph_page(request: Request):
    # Self-contained graphify viz from the ./graphify-out volume (regenerated by
    # /graphify). Guest-gated (Turnstile): the graph is just codebase structure;
    # sensitive node summaries are scrubbed by _redact_graph_nodes. chrome.css +
    # the overlay css/js + the nav are all injected here so they survive
    # rebuilds; non-admins get the guest nav.
    if not _GRAPH_HTML.exists():
        return HTMLResponse(
            "<pre>graph.html not found. Run /graphify to build it.</pre>",
            status_code=404,
        )
    page, etag = await _cached(request.cookies.get("session") != SESSION_TOKEN)
    # /graph has no extension so the no-cache middleware skips it, and the route
    # body changes whenever /graphify regenerates graph.html. Tag the rendered
    # bytes with a content-hash ETag + no-cache so the browser revalidates every
    # load: unchanged -> 304 (cheap), updated -> 200 fresh. Cache-busts on update.
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(page, headers=headers)
