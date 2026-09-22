#!/usr/bin/env python3
"""Compute /graph's node layout once, out of band, and bake it to disk.

Stabilising this graph is ~270 forceAtlas2 iterations over ~2700 nodes. On a
desktop that is a few seconds under the loading cover; on a phone it measured
around THIRTY, on every single visit, for a layout that comes out the same every
time. So it is computed here instead, nightly, right after the graphify rebuild.

It drives a REAL vis-network in a headless browser rather than reimplementing
forceAtlas2 in Python: the cached layout is then exactly the layout vis would
have produced, including graph-overlay.js's own lattice snap, which runs before
the positions are read. Anything else would be an approximation that drifts from
the live page every time either side is tuned.

Writes graphify-out/graph-layout.json as {key, pos:{id:[x,y]}}. The key is the
GRAPH's hash (sorted node ids + edge pairs), read back off the rendered page so
the writer and the reader cannot disagree about it — it changes when graphify
rebuilds AND when the serve-time drop/merge code changes what survives.

The page is fetched with ?relayout=1, which renders WITHOUT any baked layout, so
this can never feed on its own output.
"""
import json
import os
import sys
import time
from pathlib import Path

URL = os.environ.get("GRAPH_URL", "http://127.0.0.1:8080/graph?relayout=1")
OUT = Path(os.environ.get("GRAPHIFY_OUT", "/exec-fn/graphify-out")) / "graph-layout.json"
ENV = Path(os.environ.get("EXEC_FN_ENV", "/exec-fn/.env"))
# The stabilisation itself is the long pole and is slow on a loaded box; the
# whole point of this script is that it can afford to be.
TIMEOUT_MS = 600000


def api_key() -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith("API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no API_KEY in %s" % ENV)


# TWO BAKES, one per shape. vis has no per-axis gravity -- 9.1.9 offers
# `centralGravity`, a single scalar toward one point, and nothing that pulls
# harder on one axis -- so a stabilisation produces whatever aspect the forces
# happen to settle at, once, for everyone. The shape is imposed instead by
# NUDGING between stabilisation intervals: squeeze the cloud a few percent
# toward the target aspect, let the next interval's springs relax against it,
# repeat. What comes out is a layout the forces agreed to at that shape, which
# is a different object from the same layout scaled afterwards -- edges
# re-balance rather than being multiplied.
#
# Physics only ever runs here, so both runs are the cron job's time and nobody
# waits on them. The client picks whichever bake is nearer its own viewport and
# stretches away the small remainder (graph-lattice.js).
_BAKES = (
    ("pos", 1.60, 1440, 900),   # wide: the desktop shape, baked into RAW_NODES
    ("tall", 0.50, 430, 932),   # tall: the phone shape, shipped in the payload
)

# Rate per interval. updateInterval is 20 against 300 iterations, so this fires
# ~15 times; at 0.2 the correction compounds to ~96% of the way, which leaves
# the springs the last word rather than the squeeze.
_SHAPE_RATE = 0.2

_SHAPE_JS = """
window.__GP_SHAPE = %f;
window.__GP_RATE = %f;
(function () {
  var iv = setInterval(function () {
    if (typeof network === 'undefined' || !network.body) { return; }
    clearInterval(iv);
    network.on('stabilizationProgress', function () {
      var nodes = network.body.nodes;
      var ids = Object.keys(nodes);
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var i = 0; i < ids.length; i++) {
        var n = nodes[ids[i]];
        if (!n || typeof n.x !== 'number' || typeof n.y !== 'number') { continue; }
        if (n.x < minX) { minX = n.x; }
        if (n.x > maxX) { maxX = n.x; }
        if (n.y < minY) { minY = n.y; }
        if (n.y > maxY) { maxY = n.y; }
      }
      var w = maxX - minX, h = maxY - minY;
      if (!(w > 0 && h > 0)) { return; }
      /* (target / current) ^ rate, split evenly across the axes so the squeeze
         preserves area and only the SHAPE moves. */
      var f = Math.pow((window.__GP_SHAPE * h) / w, window.__GP_RATE);
      var kx = Math.sqrt(f), ky = 1 / Math.sqrt(f);
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      for (var j = 0; j < ids.length; j++) {
        var m = nodes[ids[j]];
        if (!m || typeof m.x !== 'number' || typeof m.y !== 'number') { continue; }
        m.x = cx + (m.x - cx) * kx;
        m.y = cy + (m.y - cy) * ky;
      }
    });
  }, 10);
})();
"""

_READ_JS = """() => {
  const ids = nodesDS.getIds();
  const pre = window.__GP_PRESNAP;
  const pos = {};
  if (pre) {
    for (const id of ids) {
      if (pre[id]) { pos[String(id)] = pre[id]; }
    }
  } else {
    const p = network.getPositions(ids);
    for (const id of ids) {
      if (p[id]) { pos[String(id)] = [Math.round(p[id].x), Math.round(p[id].y)]; }
    }
  }
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const k in pos) {
    const q = pos[k];
    if (q[0] < a) { a = q[0]; }
    if (q[0] > b) { b = q[0]; }
    if (q[1] < c) { c = q[1]; }
    if (q[1] > d) { d = q[1]; }
  }
  return { key: window.GRAPH_LAYOUT_KEY || '', pos: pos, presnap: !!pre,
           aspect: (b - a) / Math.max(d - c, 1) };
}"""


def bake(pw, target: float, vw: int, vh: int):
    """One stabilisation, shaped toward `target`, read back before the snap.

    __GP_PRESNAP is the layout as the PHYSICS left it -- before graph-lattice.js
    stretches or quantises anything. Reading network.getPositions() here would
    bake the client's snap back into the file, which is the moire that produced
    evenly spaced groups of four."""
    browser = pw.webkit.launch()
    try:
        ctx = browser.new_context(
            viewport={"width": vw, "height": vh},
            extra_http_headers={"Authorization": "Bearer " + api_key()},
        )
        ctx.add_init_script(_SHAPE_JS % (target, _SHAPE_RATE))
        pg = ctx.new_page()
        pg.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        # gp-loaded is set once the layout is final and the snap has run -- the
        # same moment a visitor is shown the graph.
        pg.wait_for_function(
            "document.body && document.body.classList.contains('gp-loaded')",
            timeout=TIMEOUT_MS,
        )
        return pg.evaluate(_READ_JS)
    finally:
        browser.close()


def main() -> int:
    from playwright.sync_api import sync_playwright

    t0 = time.time()
    out: dict = {}
    with sync_playwright() as pw:
        for field, target, vw, vh in _BAKES:
            data = bake(pw, target, vw, vh)
            if not data.get("key") or len(data.get("pos") or {}) < 2:
                print("FAIL %s: no key or too few positions" % field)
                return 1
            if out.get("key") and out["key"] != data["key"]:
                # Both runs must describe the same graph, or the client could
                # pick a set of coordinates for an edge set that no longer is.
                print("FAIL key drifted between bakes: %s vs %s"
                      % (out["key"][:8], data["key"][:8]))
                return 1
            out["key"] = data["key"]
            out["presnap"] = data["presnap"]
            out[field] = data["pos"]
            print("   %-4s target %.2f -> got %.2f  (%d nodes)"
                  % (field, target, data["aspect"], len(data["pos"])))

    # Atomic, so a reader never sees a half-written layout.
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, separators=(",", ":")))
    tmp.replace(OUT)
    print("OK %d nodes, key %s, %.1fs, %d bytes"
          % (len(out["pos"]), out["key"][:8], time.time() - t0, OUT.stat().st_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
