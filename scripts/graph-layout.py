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


def main() -> int:
    from playwright.sync_api import sync_playwright

    t0 = time.time()
    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            extra_http_headers={"Authorization": "Bearer " + api_key()},
        )
        pg = ctx.new_page()
        pg.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        # gp-loaded is set by graph-overlay.js once the layout is final and the
        # lattice snap has run — the same moment a visitor is shown the graph.
        pg.wait_for_function(
            "document.body && document.body.classList.contains('gp-loaded')",
            timeout=TIMEOUT_MS,
        )
        data = pg.evaluate(
            """() => {
              const ids = nodesDS.getIds();
              const p = network.getPositions(ids);
              const pos = {};
              for (const id of ids) {
                if (p[id]) { pos[String(id)] = [Math.round(p[id].x), Math.round(p[id].y)]; }
              }
              return { key: window.GRAPH_LAYOUT_KEY || '', pos: pos };
            }"""
        )
        browser.close()

    if not data.get("key") or len(data.get("pos") or {}) < 2:
        print("FAIL no key or too few positions: %r" % (list(data)[:3],))
        return 1
    # Atomic, so a reader never sees a half-written layout.
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(OUT)
    print("OK %d nodes, key %s, %.1fs, %d bytes"
          % (len(data["pos"]), data["key"][:8], time.time() - t0, OUT.stat().st_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
