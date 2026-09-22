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
import json
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
    _read_array, _prune_graph_nodes,
)
from graph_style import (
    _restyle_graph_nodes, _drop_graph_tooltips, _label_graph_nodes,
    _merge_graph_communities, _fix_graph_stats, _size_graph_by_degree,
    _tune_graph_physics, _brighten_graph_edges, _apply_graph_layout,
    graph_layout_key, read_graph_layout,
)


# /graph overlay assets live in web/ (graph-overlay.css/js) — not inline here.
# CSS = vertical-left nav + vis-network config-panel theme; JS = the firing
# overlay + zoom walls. Injected at serve time so they survive graph.html rebuilds.
_GRAPH_OVERLAY_CSS = '<link rel="stylesheet" href="/graph-overlay.css?v=46">'

# The loading cover, as STATIC MARKUP at the top of <body>.
#
# graph-overlay.js used to build it, and that script is injected before
# </body> — i.e. after ~2.2MB of inline vis bundle and RAW_NODES (measured on
# the served page: <body> at byte 4,546, RAW_NODES at 5,252, the overlay script
# at the very end). None of that is a transfer cost — gzipped the whole page is
# 133KB and warm TTFB is 0.12s — it is PARSE and EXECUTE, on the main thread,
# before a cover built at the end of the document can exist. So the page showed
# nothing at all for seconds and then a bar, which is the wrong way round: the
# bar is the thing that explains the wait.
#
# Served up front it paints with the first chunk, styled by the stylesheet link
# already in <head>, and it MOVES immediately — .gp-indet is an indeterminate
# marquee, since at that point nothing can report a fraction yet. This is markup
# and not one line of inline CSS/JS on purpose; the rules live in
# web/graph-overlay.css with the rest of the cover.
_GRAPH_BOOT = (
    '<div id="gp-loading"><div class="gp-load-track gp-indet">'
    '<div class="gp-load-fill"></div></div></div>'
)
# Order is the whole contract — same global scope, no modules. The draw half
# defines `graphPulseDraw`, the model half reads it at construction time, and
# graph-overlay.js starts the model.
_GRAPH_OVERLAY_JS = (
    # The cover first: graph-overlay.js calls gpCover.show() on its own last
    # line, and the failure note has to exist before anything can need it.
    '<script src="/graph-cover.js?v=10"></script>'
    '<script src="/graph-pulse-draw.js?v=3"></script>'
    '<script src="/graph-pulse.js?v=19"></script>'
    # Before the overlay: gpLattice.snap()/bounds() are called from openView.
    '<script src="/graph-lattice.js?v=3"></script>'
    '<script src="/graph-overlay.js?v=60"></script>'
)
# graphify's graph.html has no viewport meta — without it mobile renders at
# desktop width and scales everything down (tiny buttons/text).
_VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1">'

_GRAPH_HTML = Path("/app/graphify-out/graph.html")

# A PHONE GETS A SMALLER GRAPH.
#
# 2,722 nodes is a page a laptop draws and a phone dies on: Safari on iOS froze
# solid on load -- not slow, FROZEN, with the nav bar unable to take a tap, which
# is a main thread that never came back rather than a graph that was missing.
# Every other lever tried first (first paint, the deferred payload, the DPR cap,
# the pulse gate) made the WAIT better and none of them made the work smaller,
# because the work is the graph.
#
# So a phone is served the busiest _LITE_NODES nodes and the edges among them.
# Degree is the right ranking because this graph's whole shape is its hubs: the
# tail is leaves that hang off one parent, and at the opening zoom they are the
# halo, not the structure. It is a different picture, honestly — `?full=1`
# overrides it for anyone who wants the whole thing on a phone anyway.
_LITE_NODES = 600

def _prune_for_lite(page: str) -> str:
    """Keep the busiest _LITE_NODES nodes, and only the edges between them.

    Runs AFTER the baked layout has been applied, which is what lets it share
    one layout with the full graph: positions are per node id, so the survivors
    keep the coordinates they were baked at and the layout key still hashes the
    FULL graph. Pruning first would change the key, miss the bake, and hand a
    phone the ~30s browser stabilisation this all exists to avoid."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes or len(nodes) <= _LITE_NODES:
        return page
    ranked = sorted(nodes, key=lambda n: n.get("degree") or 0, reverse=True)
    keep = {n.get("id") for n in ranked[:_LITE_NODES]}
    return _prune_graph_nodes(page, [n.get("id") for n in nodes if n.get("id") not in keep])

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


# Graphify emits its whole dataset as ONE ~2.1MB INLINE <script> at the top of
# <body>, and an inline script cannot be deferred. So the browser parsed the
# cover above, hit that block, and spent the next second EXECUTING it — with the
# main thread busy there is no rendering opportunity, so the first paint landed
# after it, measured at FCP 1304ms against a 129ms responseStart. None of that
# is transfer: gzipped the page is 133KB. Serving those blocks as one external
# `defer` file gives the parser a network wait to paint into, and the browser a
# cacheable copy for the next visit.
#
# Order is preserved by deferring EVERY src script on the page (`_defer_scripts`):
# deferred scripts run in document order, after the parse, so vis -> payload ->
# crt-zoom -> pulse -> overlay is exactly the order they ran in before. The two
# inline blocks that are NOT graphify's (the layout-key line in <head>, the nav
# sizing script at the end) are untouched and depend on none of it.
_PAYLOADS: dict[str, str] = {}
# Two tiers x the current artifact, plus room for the previous one so a browser
# that loads the HTML seconds before a nightly rebuild can still fetch the
# payload its page asked for.
_PAYLOAD_MAX = 6


def _externalise_boot(page: str) -> tuple[str, str]:
    """Lift graphify's inline <body> scripts into one deferred external file.

    Returns (page, payload). Runs FIRST, on the raw artifact, so the only inline
    body scripts it can see are graphify's own."""
    start = page.find("<body>")
    end = page.find("</body>", start)
    if start < 0 or end < 0:
        return page, ""
    region = page[start:end]
    blocks = list(re.finditer(r"<script>(.*?)</script>", region, re.S))
    if not blocks:
        return page, ""
    payload = "\n;\n".join(b.group(1) for b in blocks)
    # The cover cannot otherwise tell a payload still on the wire from one
    # already running: both look like "network is undefined".
    payload = ("window.__GP_PAYLOAD_START = performance.now();\n;" + payload
               + "\n;window.__GP_PAYLOAD_MS = performance.now();\n")
    digest = hashlib.md5(payload.encode()).hexdigest()[:16]
    # NOT a <script defer src>. The cover fetches this itself (graph-cover.js)
    # so the bar can track real BYTES — a script tag reports nothing until it is
    # done, and on a phone the download is the part worth watching. The loader
    # falls back to injecting the tag on any failure, and graph-overlay.js
    # injects it too if the loader never ran at all.
    tag = '<script>window.GRAPH_BOOT_URL=%s;</script>' % json.dumps(
        "/graph/boot.js?v=%s" % digest)
    out, last = [], 0
    for i, block in enumerate(blocks):
        out.append(region[last:block.start()])
        # The first one becomes the tag; the rest are already inside it.
        out.append(tag if i == 0 else "")
        last = block.end()
    out.append(region[last:])
    _PAYLOADS[digest] = payload
    while len(_PAYLOADS) > _PAYLOAD_MAX:
        _PAYLOADS.pop(next(iter(_PAYLOADS)))
    return page[:start] + "".join(out) + page[end:], payload


def _defer_scripts(page: str) -> str:
    """Every same-origin src script deferred, so the parse can finish and paint
    before any of them runs, in unchanged relative order.

    Except the cover. It is 4KB with no dependency on anything, and deferring it
    put it BEHIND the payload it exists to report on: the phase line first
    appeared at "drawing", i.e. after the slow part was already over. Parsed
    inline it is live while the payload is still on the wire, and the payload's
    own start/end marks survive the main thread being blocked in between."""
    page = re.sub(r'<script src="(/[^"]+)"></script>',
                  r'<script defer src="\1"></script>', page)
    return page.replace('<script defer src="/graph-cover.js',
                        '<script src="/graph-cover.js')


def _render(page: str, guest: bool, relayout: bool = False, lite: bool = False) -> str:
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
    # ...unless the layout is already baked. Stabilising measured ~30s on a
    # phone, every visit, for a layout that is the same every time; scripts/
    # graph-layout.py computes it nightly and this drops it straight in. The key
    # is the graph itself, so a rebuild OR a change to our own drop/merge code
    # invalidates it, and a miss simply falls back to stabilising in the browser.
    # `relayout` is how the generator asks for that fallback on purpose.
    key = graph_layout_key(page)
    pos = None if relayout else read_graph_layout(_GRAPH_HTML.parent, key)
    if pos:
        page = _apply_graph_layout(page, pos)
    # The overlay has to know: with physics off there is no
    # stabilizationIterationsDone to wait for, and that event is what reveals
    # the page.
    page = page.replace(
        "</head>",
        "<script>window.GRAPH_LAYOUT_KEY=%s;window.GRAPH_LAYOUT_CACHED=%s;</script></head>"
        % (json.dumps(key), "true" if pos else "false"),
        1,
    )
    if lite:
        # After the layout, before the restyle: the survivors carry their baked
        # x/y, and the header then has to be told what is actually left.
        page = _prune_for_lite(page)
        page = _fix_graph_stats(page)
    # Hexagon nodes + bg-filled (coloured-outline) look, matching /emet; repoints
    # the neighbour-stripe colour to the border. After the merge so node colours exist.
    page = _restyle_graph_nodes(page)
    # No hover tooltips — drop `title:` from both DataSet mappers.
    page = _drop_graph_tooltips(page)
    # First thing in the body, so it is the first thing painted.
    page = page.replace("<body>", "<body>" + _GRAPH_BOOT, 1)
    # LAST, and that ordering is load-bearing twice over: every scrub, drop,
    # merge and restyle above is a string edit on the inline node JSON, and the
    # baked-layout key is a hash of it. Lifting the payload out first made all of
    # them no-ops on a 9KB shell -- the layout key came back empty (so /graph
    # fell back to ~30s of phone stabilisation) and the served payload was the
    # RAW, unredacted artifact. It reads the body's inline scripts, so it also
    # has to run before the </body> injections put ours there.
    page, _ = _externalise_boot(page)
    page = page.replace("</head>", _VIEWPORT_META + _APPLE_WEBAPP_META + _FAVICON + _FONT_PRELOAD + _CHROME_LINK + _GRAPH_OVERLAY_CSS + "</head>", 1)
    page = page.replace("</body>", _CRT_FX + _build_nav("graph", guest=guest) + _GRAPH_OVERLAY_JS + "</body>", 1)
    return _defer_scripts(page)


async def run_graph_warm_loop():
    """Keep both tiers rendered, so no visitor ever pays the cold pipeline.

    The render is 1.7-2.9s of CPU and the cache is per-PROCESS, so every restart
    -- and `--reload` makes those routine -- parked that cost in front of
    whoever opened /graph next. Reported as lag between tapping GPH and anything
    happening at all, which is what it was: not the page, the response.

    The same loop covers the 05:00 graphify rebuild, since it re-warms whenever
    the artifact's (mtime_ns, size) changes rather than on a schedule of its
    own. A failure here is never fatal: the route still renders on demand."""
    seen = None
    while True:
        try:
            if _GRAPH_HTML.exists():
                st = _GRAPH_HTML.stat()
                key = (st.st_mtime_ns, st.st_size)
                if key != seen:
                    for guest in (False, True):
                        for lite in (False, True):
                            await _cached(guest, lite)
                    seen = key
        except Exception:
            pass
        await asyncio.sleep(600)


async def _cached(guest: bool, lite: bool = False):
    """The rendered page + its ETag for this VARIANT, rendering only when the
    artifact on disk is not the one already in the cache. Keyed on mtime_ns+size
    rather than a content hash so the check costs one stat, not a 3.6MB read.

    The variant is (tier, lite): four entries at most, and a phone and a laptop
    are served different graphs, so they cannot share one."""
    global _CACHE_KEY
    st = _GRAPH_HTML.stat()
    key = (st.st_mtime_ns, st.st_size)
    async with _CACHE_LOCK:
        if key != _CACHE_KEY:
            _CACHE.clear()
            _CACHE_KEY = key
        if (guest, lite) not in _CACHE:
            _CACHE[(guest, lite)] = await asyncio.to_thread(_build, guest, False, lite)
        return _CACHE[(guest, lite)]


def _build(guest: bool, relayout: bool = False, lite: bool = False):
    """Render + hash, off the event loop."""
    page = _render(_GRAPH_HTML.read_text(), guest, relayout, lite)
    return page, '"%s"' % hashlib.md5(page.encode()).hexdigest()


@guest_protected.get("/graph/boot.js")
async def graph_boot(request: Request):
    """Graphify's own body scripts, lifted out of the page (`_externalise_boot`).

    Same tier as the page it belongs to. The `?v=` is a content hash, so the
    bytes at a given URL never change and the browser is told so — the payload
    is the one part of /graph that IS worth caching hard, since it is 2.1MB of
    JS that changes once a day. A hash this process has never rendered renders
    that tier once and looks again, which covers a restart between the HTML and
    this fetch."""
    digest = request.query_params.get("v", "")
    payload = _PAYLOADS.get(digest)
    if payload is None and _GRAPH_HTML.exists():
        guest = request.cookies.get("session") != SESSION_TOKEN
        for lite in (False, True):
            await _cached(guest, lite)
            payload = _PAYLOADS.get(digest)
            if payload is not None:
                break
    if payload is None:
        return Response("// unknown graph payload\n", status_code=404,
                        media_type="application/javascript")
    return Response(payload, media_type="application/javascript", headers={
        "Cache-Control": "public, max-age=31536000, immutable",
        # The DECODED length. Content-Length is the gzipped one (GZipMiddleware
        # is outside this), while a stream reader yields decoded bytes, so a bar
        # driven off Content-Length would run to several hundred percent.
        "X-Payload-Bytes": str(len(payload.encode())),
    })


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
    guest = request.cookies.get("session") != SESSION_TOKEN
    # OPT-IN ONLY. This was served to phones by UA for a few hours, on the
    # reasoning that 2,722 nodes is what froze iOS Safari -- and it did load a
    # phone in a quarter of the payload. It is not the default because the whole
    # graph is the point of the page: a codebase map with its leaves cut off is a
    # different, smaller claim about the codebase, and deciding that for someone
    # from their user-agent string is the wrong call to make on their behalf.
    # The freeze was answered by the things that made the page cheaper without
    # making it smaller (the deferred payload, the DPR cap, the reveal
    # sequencing, the viewport-shaped lattice). `?lite=1` keeps the tested path
    # for anyone who wants it.
    lite = request.query_params.get("lite") == "1"
    # ?relayout=1 renders WITHOUT the baked layout, so the nightly generator can
    # stabilise a fresh one. Never cached: it exists to be run once a night.
    if request.query_params.get("relayout") == "1":
        page, etag = await asyncio.to_thread(_build, guest, True)
    else:
        page, etag = await _cached(guest, lite)
    # /graph has no extension so the no-cache middleware skips it, and the route
    # body changes whenever /graphify regenerates graph.html. Tag the rendered
    # bytes with a content-hash ETag + no-cache so the browser revalidates every
    # load: unchanged -> 304 (cheap), updated -> 200 fresh. Cache-busts on update.
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(page, headers=headers)
