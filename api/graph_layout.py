"""Where the /graph nodes ARE: the physics that produces a layout, and the
baked layout that replaces it.

Split out of graph_style.py at the 500-line cap, along a real seam rather than a
convenient one — everything left there decides how the graph LOOKS (communities,
colours, shapes, sizes, labels, edges), and everything here decides where its
nodes sit. The two meet only in routes_graph's pipeline.

The pairing is the point: `_tune_graph_physics` is the sim that computes a
layout, and `_apply_graph_layout` is what makes that sim unnecessary for every
visitor after the first. scripts/graph-layout.py runs the former nightly so the
latter can serve it, which is the difference between ~30s of browser
stabilisation on a phone and none.
"""
import re
import json
import hashlib
from pathlib import Path

from graph_scrub import _read_array, _sub_json_array


# graphify's own physics block, matched as a whole so the replacement survives a
# rebuild changing any value inside it. Anchored on the two-space indent it is
# emitted at, and on the `interaction:` key that follows, so it can't run away
# into the rest of the options literal.
_PHYSICS_BLOCK_RE = re.compile(r"\n  physics: \{.*?\n  \},\n(?=  interaction:)", re.DOTALL)
# One-shot layout, then still. The constants are graph-overlay.js's old tuned set
# (it used to apply them AFTER graphify had already stabilised with its own,
# which meant stabilising twice and then simulating forever); applying them here
# means the single stabilisation pass produces the layout that is kept.
# `damping` is high and `minVelocity` is coarse on purpose: this sim has one job,
# to stop. 300 iterations, settled after walking the range on 2026-09-22: 270 ->
# 370 -> 300 -> 325 -> 300. Nothing above 300 showed up in the picture, and the
# aspect shaping does not care either — 325 moved the bakes by 0.06 and 0.01,
# because what limits them is the springs pulling back against the squeeze
# (_SHAPE_RATE in scripts/graph-layout.py), not how long the sim runs.
# The whole run is spent inside the NIGHTLY BAKE now, not in front of a visitor
# -- a normal serve gets physics off and the baked positions -- so the cost of
# another hundred is about seven seconds of a cron job that already takes twenty,
# and what it buys is a layout that has finished moving rather than one frozen
# mid-drift. Raising it does NOT invalidate anything on its own: graph_layout_key
# hashes node ids and edge pairs, not coordinates, so the old bake still matches
# by key and keeps being served until scripts/graph-layout.py is re-run. theta 0.8 loosens the Barnes-Hut approximation -- on 4.5k nodes the
# force error is invisible and the saving is not. `updateInterval` is small so
# the run yields the main thread often: vis runs each interval's iterations in
# one synchronous batch, and a batch the size of the whole run freezes the tab
# (no timers, no progress bar, nothing to say the page is working).
_PHYSICS_BLOCK = """
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      theta: 0.8,
      gravitationalConstant: -628,
      centralGravity: 0.025,
      springLength: 30,
      springConstant: 0.22,
      damping: 0.9,
      avoidOverlap: 1,
    },
    maxVelocity: 50,
    minVelocity: 4,
    stabilization: { enabled: true, iterations: 300, updateInterval: 20, fit: true },
  },
"""
# Curved edges cost a bezier per edge per frame. At 6k edges that is the single
# most expensive thing on the canvas, and it buys nothing a straight line doesn't
# say. `selectionWidth: 3` is kept -- the hover highlight rides on it.
_EDGE_SMOOTH = ("edges: { smooth: { type: 'continuous', roundness: 0.2 }, selectionWidth: 3 }",
                "edges: { smooth: false, selectionWidth: 3 }")


def _tune_graph_physics(page: str) -> str:
    """Replace graphify's physics block with a one-shot stabilisation, and
    straighten the edges. graph.html's own `stabilizationIterationsDone` handler
    then disables physics and the layout holds still -- which is the whole point:
    a force sim that never idles is a canvas redraw every frame forever, and on
    this graph that measured 0.4 fps. Each half no-ops if graphify stops emitting
    what it matches."""
    page = _PHYSICS_BLOCK_RE.sub(lambda _m: _PHYSICS_BLOCK, page, count=1)
    return page.replace(_EDGE_SMOOTH[0], _EDGE_SMOOTH[1], 1)




# ── the baked layout ───────────────────────────────────────────────────────
# Stabilising this graph is ~300 forceAtlas2 iterations over 2581 nodes. On a
# desktop that is a few seconds under the loading cover; on a phone it measured
# around THIRTY, every single visit, for a layout that is identical every time.
# So it is computed once, out of band, and baked into the bytes — see
# scripts/graph-layout.py, which drives a real vis-network in a headless browser
# rather than reimplementing forceAtlas2 here, so the cached layout is exactly
# the layout vis would have produced.
#
# The cache key is a hash of the GRAPH, not of the file it came from: sorted node
# ids plus sorted edge pairs. That is what actually determines a layout, and it
# changes both when graphify rebuilds AND when our own drop/merge code changes
# what survives — "or when we update the code" — while staying identical across
# the guest and admin renders, which differ only by their nav.
_LAYOUT_FILE = "graph-layout.json"


def _layout_key(nodes, edges) -> str:
    h = hashlib.md5()
    for nid in sorted(str(n.get("id")) for n in nodes):
        h.update(nid.encode())
        h.update(b"\x00")
    h.update(b"\xff")
    for pair in sorted("%s>%s" % (e.get("from"), e.get("to")) for e in edges):
        h.update(pair.encode())
        h.update(b"\x00")
    return h.hexdigest()


def graph_layout_key(page: str) -> str:
    """The cache key for the graph as this page currently renders it, or "" if
    the arrays are missing. Public: the generator script reads it back off the
    rendered page so the writer and the reader cannot disagree about the key."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return ""
    return _layout_key(nodes, _read_array(page, "RAW_EDGES") or [])


def read_graph_layout(graphify_dir, key: str):
    """The baked positions for `key`, or None when there is no layout, it is for a
    different graph, or it is unreadable. Every failure is a no-op that falls back
    to stabilising in the browser, because a stale layout is worse than a slow
    one: it would place nodes by an edge set that no longer exists."""
    try:
        data = json.loads((Path(graphify_dir) / _LAYOUT_FILE).read_text())
    except (OSError, ValueError):
        return None
    if data.get("key") != key or not isinstance(data.get("pos"), dict):
        return None
    return data["pos"]


def read_graph_layout_tall(graphify_dir, key: str):
    """The TALL bake for `key`, or None. Same file, same key, a second set of
    coordinates: `scripts/graph-layout.py` stabilises twice, once shaped wide and
    once shaped tall, because the physics only ever runs in the baker and one run
    produces one shape. The wide set is baked into RAW_NODES as before; this one
    rides in the payload and the client picks whichever is nearer its own
    viewport (graph-lattice.js)."""
    try:
        data = json.loads((Path(graphify_dir) / _LAYOUT_FILE).read_text())
    except (OSError, ValueError):
        return None
    if data.get("key") != key or not isinstance(data.get("tall"), dict):
        return None
    return data["tall"]


def _apply_graph_layout(page: str, pos: dict) -> str:
    """Bake `pos` into RAW_NODES as x/y, make vis carry those fields through to
    the DataSet, and switch physics off entirely. Nodes with no cached position
    keep none — vis drops them near the origin, which is visible and wrong, so
    the caller only uses a layout that covers the graph it is for."""
    def _place(nodes):
        for n in nodes:
            p = pos.get(str(n.get("id")))
            if p:
                n["x"], n["y"] = p[0], p[1]
        return nodes

    page = _sub_json_array(page, "RAW_NODES", _place)
    # graphify's DataSet mapper lists its fields explicitly, so x/y would be
    # dropped on the way in no matter what RAW_NODES carries.
    page = page.replace(
        "  id: n.id, label: n.label, color: n.color, size: n.size,",
        "  id: n.id, label: n.label, color: n.color, size: n.size, x: n.x, y: n.y,",
        1,
    )
    # No sim, no stabilisation: the positions ARE the layout.
    return _PHYSICS_BLOCK_RE.sub(
        lambda _m: "\n  physics: { enabled: false },\n", page, count=1
    )
