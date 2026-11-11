## 11. `/graph`

**Node rotation was removed after three attempts (2026-09-24).** "Get rid of the shape rotation
it's fucked."

The feature was: the instant before a big node throws a wavefront, turn its shape a quarter, half or
three quarters. The obstacle was never the rotation itself — it is a few lines of vertex arithmetic —
but that vis draws its OWN copy of every node, at the original angle, on a canvas one layer below
the overlay. The overlay cannot erase that canvas, and with physics off vis never redraws it, so the
copy is baked. Re-orienting it would mean forcing a full redraw of the graph, about 100ms, on every
rotation — once a beat.

So every attempt was a way of COVERING vis's copy, and each failed on the same fact in a different
disguise:

1. Fill both orientations in the opaque punch. The punch runs after the halos, so it cut a hole in
   the glow instead of covering anything, and the union of an up- and a down-triangle is a hexagram.
   Reported as doubled shapes.
2. Fill only the rotated orientation. No hole, but vis's copy then showed wherever it protruded past
   the rotated glyph — a visible rim of its own border, not the hairline that reasoning predicted,
   because the border is 2px wide and CENTRED on its path so a pixel of it lies outside the glyph
   that was supposed to contain it.
3. Fill the unrotated orientation FIRST, before the halos, so the halo paints over the cover rather
   than being cut by it. This is actually correct and would have worked. It was abandoned because
   the feature had by then cost three rounds and the owner called it.

Worth keeping for the general shape: an effect that needs two layers to agree is only as good as the
layer you do not control. The wavefront's own rotation stayed, and costs nothing, precisely because
nothing on vis's canvas corresponds to it.

**Punching two orientations cut a hexagram out of the halo (2026-09-24).** Reported twice, the
second time as *why are the node shapes still doubled up after rotation*.

A node that turns before throwing a wavefront is drawn rotated by the overlay, while vis draws its
own copy at the original angle on a canvas a layer down that the overlay cannot erase. The fix
attempted was to fill BOTH orientations in the opaque punch, so the rotated fill would cover vis's
copy too, and the commit justified the extra area as costing nothing "being the page background over
the page background".

That sentence was the whole error, and it survived a round of fixing the page background because the
background was genuinely also wrong. The punch does not land on the page. It lands on the node's own
HALO — two soft discs out to 2.6x the glyph radius, drawn on this same canvas a few passes earlier —
so the fill cuts a hole in the glow, and the hole is shaped like exactly what was filled. An up- and
a down-triangle about one centre make a hexagram, and a hexagram-shaped hole in a glowing disc reads
as two triangles. Looking at a zoomed screenshot with the CRT layers hidden showed it in one glance,
after two rounds of reasoning about it had produced two wrong answers.

Punching one shape — the node's current orientation — makes the hole match the outline drawn over
it. What it leaves is vis's copy still sitting under the halo where it protrudes, which is a hairline
of a 0.2-alpha border under an additive glow rather than a second shape. Removing that too would
mean re-orienting vis's own node, and with physics off vis's canvas is static, so that is a full
redraw of the graph (~100ms) on every rotation, once a beat. Not worth it.

Verified structurally rather than by eye, because eyes had already been wrong twice here: wrap
`graphGlyph.path`, record the `turn` every glyph is built with over a frame, and check that no node
appears at two orientations. Zero turn is now absent from a frame entirely.

**The node fill was never the page background, and it showed up as duplicated nodes
(2026-09-24).** Reported as *the nodes themselves are duplicated, not the waves*.

`graph_style._GRAPH_BG` was `#0f0f1a`, and the comment above it called that "graph.html body bg".
That was true of graphify's own emitted page and stopped being true the moment `/graph` started
injecting chrome.css over it. This site's `--bg-hsl` is `0 0% 0%` — measured `rgb(0, 0, 0)`, pure
black — so the fill was a dark NAVY, and every node interior it painted was a visible shape on a
black page rather than a hole in the overlay.

It went unnoticed for as long as it did because a single navy triangle behind a coloured outline
just looks like a node. What made it visible was the rotation: a node that turns before throwing a
wavefront has BOTH orientations filled, because vis draws its own unrotated copy on a lower canvas
that the overlay cannot erase, so the only way to hide that copy is to cover it. The union of an up-
and a down-triangle is a hexagram — invisible if the fill matches the page, and two overlapping
triangles if it does not. The claim in that commit that punching both orientations "costs nothing
visually, being the page background over the page background" was exactly right and exactly the
assumption that was false.

Fixed at both ends. `_GRAPH_BG` is `#000000` for vis's unlit layer, which has nothing to fall back
on, and `web/graph-surface.js` reads the overlay's fill from `getComputedStyle(document.body)` —
which cannot drift the way a literal or a data field can, because it IS the thing being matched.
Verified by sampling the canvas pixel at the centre of the largest hub: `[0, 0, 0, 255]`, where it
had been `[15, 15, 26]`.

Both incidents on this value have the same shape: a fill that must equal something else was stored
as its own copy of that something, and the copy went stale in a different way each time. The
occlusion pass is only correct when it reads the thing it is trying to match.

**`setBg('transparent')` silently switched off node occlusion (2026-09-24).** Reported as *the
centre of big nodes is getting bright*.

`graph-pulse-draw.js` reads the page background off real node data rather than holding a second
literal — `graphPulseDraw.setBg(n.color.background)` — guarded by `if (n.color.background)`. That
guard was correct until `graph_geometry._unocclude_small_nodes` started writing the string
`"transparent"` onto every node under the size percentile, which at `_OCCLUDE_PCTL` 0.80 is four
fifths of them. `"transparent"` is TRUTHY, so the guard accepted it and whichever node the index
loop visited last decided the value. `BG` became `"transparent"`, `punchNodes` filled with it,
`source-over` with a fully transparent fill paints nothing, and the pass that makes a node occlude
the edges behind it became a silent no-op.

The symptom pointed away from the cause. Nothing looked broken at small nodes — they are not
supposed to occlude — and the visible failure was at the HUBS, whose lit edges all converge on one
point, so with no opaque fill over them they summed under `'lighter'` into a bright core. It read as
a glow bug, not as a missing fill.

Two things fixed it. `setBg` now rejects `transparent` as well as empty, and it is the SINGLE gate —
`graph-pulse.js` passes the value straight through instead of holding a second opinion about which
values are acceptable. Verified by sampling the canvas pixel at the centre of the largest hub with
40 neighbours lit and their edges fired: `[15, 15, 26, 255]`, exactly `#0f0f1a` at full opacity.

The general lesson is about DATA whose meaning changed under a reader that was written before it: a
falsy check is not a validity check, and a sentinel added at one end of a pipeline needs every
consumer re-read, not just the one that motivated it.


Current design: [ARCHITECTURE.md §11](../architecture/11-graph.md).

**The first thing painted is the loading bar** (2026-09-22). Two things stood between a visitor and that bar, and only one of them was obvious. The cover was built by `graph-overlay.js`, which is injected before `</body>`; serving it as static markup at the top of `<body>` (`_GRAPH_BOOT`) fixes the document ORDER but not the paint, because graphify emits its entire dataset as one ~2.1MB **inline** `<script>` right after it. An inline script cannot carry `defer`, and a script executing is a main thread with no rendering opportunity in it — so the browser parsed the cover and then sat in that block for a second before painting anything at all. Measured on the served page: `responseStart` 129ms, **first-contentful-paint 1304ms**, and none of the gap is transfer (133KB gzipped).

**A black /graph is a JS failure wearing a crash's clothes** (2026-09-22). `#graph` is `opacity: 0` until `body.gp-loaded` lifts it, so every path that does not reach `reveal()` shows the same thing: a black page. Reported from a phone as *nothing happens when I tap GPH, then the page goes black* — with the visuals turning up around three minutes later, which is what ruled out a crashed tab and made it a slow load nobody could see the inside of. The failsafe at the time was **120s**, so even the recovery was two minutes of black.

**Three failures that only ever showed on a phone** (2026-09-22), found by asking what the screen actually did rather than by reproducing them — none of them reproduce on the droplet's headless WebKit.

**A black page after switching tabs and coming back** was `watchSleep` reloading the document. It ran a 10s interval and treated a tick landing >60s late as "the device slept", on the reasoning that a canvas comes back wedged from a suspend. iOS freezes a backgrounded tab within seconds, so switching apps and returning tripped it EVERY time, and a reload of /graph is a black screen for the whole load (opacity 0 until `gp-loaded`) — which is how a slow load came to be reported as a crash. The old comment already recorded the same shape of bug on the droplet: a reload landing in another stabilisation, tripping it again. It is now `watchWake`, hung on `visibilitychange` and a `persisted` `pageshow` — the events that actually mean *you are back* — and it REPAIRS instead of reloading: `graphPulseDraw.resize()` re-measures the backing store, `network.redraw()` repaints. That is the entire recovery the reload was buying, minus the document.

**A finished page that would not take a tap.** `graphPulse.init()` now returns early on `(pointer: coarse)`. The cascade is the only animated layer on the page and it sits UNDER the CRT stack's two `backdrop-filter` layers — §10's most expensive rule: a backdrop-filter is a full-viewport readback with no partial invalidation, cheap only while nothing under it animates, ruinous when something does. 2fps against 18 measured here with the stack hidden; on a phone that is a main thread and compositor with nothing left over for touch. The stack stays and the cascade goes, and the order matters: the stack is the site's look on every page, while the cascade is /graph-only ambience that happens to be exactly what makes the stack expensive.

**Lag between tapping GPH and anything happening** was the response, not the page. The render is 1.7-2.9s of CPU and `_CACHE` is per-PROCESS, so every restart — routine under `--reload` — parked a cold render in front of whoever opened /graph next, and the tap sat there looking ignored. `run_graph_warm_loop` is a lifespan task beside the nudge loop: it renders both tiers at startup and re-warms whenever `(mtime_ns, size)` changes, which covers the 05:00 rebuild without a schedule of its own, and it swallows its own failures because the route still renders on demand. First request after a restart measured 6.5s (the warm and the request contending), steady state **0.046s**.

**The bar is a fraction of the work, and that is the second answer to the question.** The first was bytes: `graph-cover.js` fetches the payload itself (`window.GRAPH_BOOT_URL`, a streamed `fetch`, handed back as a Blob `<script src>` so the payload's top-level `const RAW_NODES` / `network` stay global bindings) instead of leaving it to a `<script defer src>`, which reports nothing until it is finished. Then the measurement came back: **WebKit returns all 2,204,421 bytes in ONE chunk**, so a byte-driven bar fires exactly once, at 100%, and correlates with nothing. A slower link does split it — which is the phone this is for and not the loopback it gets tested on — so bytes are kept where they appear, but they cannot be the whole bar.

So the bar is cut by phase, and every step is a real thing finishing: `FETCHED` 0.45 (payload down), `BUILT` 0.9 (it has executed — the injected script's `onload`, the only honest marker for that from outside), 1.0 at reveal. Inside the download it tracks bytes. Inside the BUILD it holds its width and **breathes** — `.gp-build`, an opacity keyframe — because opacity is a compositor property that keeps moving through a main thread blocked solid, while a JS-driven width freezes exactly when the page most needs to look alive. The marquee is now only for the phase before there is any position to hold.

Three things that only showed up by tracing the running page: the phase text ran BACKWARDS (`building the graph` then `fetching graph data`) while both `go()` and the loader wrote it — the loader owns it now; `indeterminate()` has to clear the inline width, or the marquee slides a FULL-WIDTH bar rather than a segment; and `X-Payload-Bytes` exists because `Content-Length` is the gzipped length while the reader yields decoded bytes. Since the page no longer carries a `<script src>` for the payload, three separate paths restore one: the fetch's `catch`, the injected script's `onerror`, and a 25s `RESCUE_MS` timer — plus a belt in graph-overlay.js for the case where graph-cover.js never ran at all.

**The cover lifts on a finished page, not an ordered one.** `reveal()` sat on the line after `moveTo`, which left two things in flight. `moveTo` sets the camera but does not paint at it, so the reveal uncovered the frame BEFORE the move and the graph jumped into position a beat later. And `graphPulse.init()` only wires the model up — the first cascade lights a moment afterwards, so the page arrived still and then twitched into life.

**One `moveNode` per node is one REDRAW per node, and that was the freeze.** `snapToGrid` wrote 2,722 positions through `network.moveNode`. That was already the cheap path — a DataSet bulk write fires vis's `_dataUpdated` cascade and rebuilds every physics body, 7.4s against 1.07s — but every call also asks vis to redraw, and **the draws it queues are invisible to a timer wrapped around the loop**. `place` reported 0.0s while the work it had just ordered ran on for seconds afterwards, which is precisely why the instrumentation exonerated the guilty step twice over.

Hooking `beforeDrawing`/`afterDrawing` is what found it: **160 draws, 16.1s of main thread, a median 93ms apart**, 130 of them before the cover lifted, each repainting a 3.36-megapixel canvas of 2,722 nodes. A thread that busy cannot run a timer, which is why the 3s reveal failsafe never fired and the page sat frozen with the bar at `drawing` — the exact state in the screenshot that reported it. Writing straight to `network.body.nodes[id].x/y` (guarded, falling back to `moveNode` on any vis that renames it) and calling `network.redraw()` once after the loop: **160 draws -> 4, 16,161ms -> 737ms**.

`graphPulse.index()` was chunked into four rAF-separated phases during the same hunt, and it was **not** the culprit — `nodes 22 / edges 5 / pos 7 / grid 54ms`, 88ms all told. The phases stay anyway: a thread that yields between them is what allows a failsafe to fire at all, and the per-phase numbers print in the cover line, which is how a device nobody here can profile gets to name its own slow step. The reveal gains `DRAWN_CAP` (800ms from vis's first painted frame) for the same reason — waiting for the first lit frame stays the intent, but it is no longer the only way out.

`CELLS_PER_NODE` moved **4 -> 9** in the same pass, on request: more points for each part of the graph to snap to. The cell is `sqrt(area / (n * CELLS_PER_NODE))`, so raising it makes the grid finer without moving the cloud's outline — 107x103 distinct coordinates against roughly 70x70 — every node lands nearer where the layout put it, and `nearestFree` walks less because there is more room beside each first choice.

**“Groups of four” was a moire: the layout was quantised twice.** Reported from a phone as nodes sitting in evenly spaced clusters of up to four, which looks like an arrangement somebody chose. `scripts/graph-layout.py` waits for `gp-loaded` and reads `network.getPositions()` — and `gp-loaded` comes after `snapToGrid`, so the nightly file held **already a lattice**: 107 distinct x values, gaps of 146/147, exactly `cell` at `CELLS_PER_NODE` 4. Every visit snapped that again at whatever cell was current, 97 at CPN 9, and **146/97 = 1.505**. Multiples of 146 rounded onto a 97 grid give indices 0, 2, 3, 5, 6, 8, 9: alternating wide and narrow gaps, in both axes at once, drawn as pairs and pairs of pairs.

`snapToGrid` publishes `window.__GP_PRESNAP` — the positions as the layout left them, before it quantises anything — and the baker reads that, falling back to `getPositions()` so a bake still works against an older page. **Snap once, at serve time**, against whatever density is current. Re-baked and measured: the file went from 107 distinct x values to **2,433** (gaps of 1, 2, 3, 4, 5), the rendered lattice to gaps of 99 x121 and 100 x25 with an occasional 198 or 298 where the graph is sparse, and the clump distribution from a hard cap at 4 to a natural tail (1220 singles, 223 pairs, down to one 107-node mass in the densest region).

**`_cached` keys on the layout file too, which fixes a day-long fault nobody had noticed.** The key was graph.html's `(mtime_ns, size)` alone, while the 05:00 cron rebuilds graphify FIRST and bakes after. A visit landing in that window cached a render made without a baked layout, and nothing invalidated it until the next rebuild twenty-four hours later — every visitor in between paying the ~30s browser stabilisation the bake exists to remove. A re-bake by hand had the same problem, which is how it surfaced.

**The physics gets another hundred iterations before it freezes.** `stabilization.iterations` went 220 -> 270 on 2026-09-21 and 270 -> **370** on 2026-09-22: the sim runs longer before `stabilizationIterationsDone` turns physics off and `snapToGrid` quantises what it left, so what gets frozen is a layout that has settled rather than one still drifting. Every one of those iterations now runs inside `scripts/graph-layout.py` — a normal serve gets physics off and the baked coordinates — so the bill is a nightly cron job's, measured **20.7s -> 29.1s**, and no visitor waits on any of it.

Worth knowing because it is the opposite of the drop passes: raising the iteration count invalidates NOTHING. `graph_layout_key` hashes surviving node ids and edge pairs, not coordinates, so the old bake still matches by key and goes on being served — the longer run changes nothing until the baker is actually re-run. Dropping nodes is the reverse: it changes the key, the bake misses instantly, and every visit pays the browser stabilisation until a re-bake. One needs a re-run to take effect; the other needs one to stop hurting.

**Shape carries a node's TYPE, colour carries its community.** `code` (1,955) is a hexagon, `rationale` (403) a triangle, `document` (223) a dot — `_TYPE_SHAPES` and `_shape_graph_nodes_by_type` (then in graph_style.py, since moved to graph_geometry.py; the shapes were later reassigned, see ARCHITECTURE.md §11a). It is `dot` and not `circle` even though a dot IS a circle, because vis splits its shapes into two families: `circle`, `ellipse`, `box` and `text` draw the label INSIDE and size themselves to it, ignoring `size` entirely, while `dot`, `hexagon`, `triangle`, `diamond`, `square` and `star` draw the label outside and take their size from `size`. Node size here is geometric in degree, which is the graph's primary encoding, so `circle` would have discarded it for every document and relocated their labels in the same move. The per-node `shape` must be named in graphify's DataSet mapper or it is dropped on the way in — the same explicit-field trap as the baked x/y — and the global `nodes: { shape: 'hexagon' }` stays as the fallback for a type this misses. The cascade's lit glyph follows the shape too (`glyph()` in graph-pulse-draw.js, since moved to `web/graph-glyph.js`), since lighting everything as a hexagon made a cascade misdescribe what it was crossing; the triangle draws at 1.15x radius because at equal circumradius it reads smaller than the hexagon beside it.

The opening view is `OPEN_ZOOM` **1.2** — renamed from `OPEN_ZOOM_OUT`, which at a value above 1 said the opposite of what it did. It multiplies the cover scale: 0.75 when the cloud was square and the window was not, 1 once the stretch made cover and contain the same number, and 1.2 on request, which crops roughly a sixth off each axis in exchange for nodes large enough to read. Measured at 430x867: the graph draws 513x1032, a 1.19x overflow both ways.

**The lattice keeps equal spacing on both axes, and that bounds what it can do about the viewport.** graphify's cloud is roughly square; the window rarely is. At 430x932 the camera opened on cover, filled the height and ran **2.08x the width** — a phone saw the middle strip of the graph and had to drag for the rest. `snapToGrid` did rescale every node into a box of the viewport's own aspect before snapping, which fitted the outline to the screen (0.50 -> 0.50 at 430x932, 1.72 -> 1.73 at 1280x800) and was **reverted**: square grid points with a stretched picture standing on them is the worst of both, because a force layout means something by distance and scaling one axis alone rewrites that meaning. The map is uniform now — a single `k` applied to x and y — so the step between adjacent lattice points is identical on both axes (measured 97 and 97).

What that costs is the thing it was reaching for. With a uniform scale the grid's row-to-column ratio follows the CLOUD's aspect, not the window's: **107x103 on a 0.50 phone and on a 1.72 desktop alike**. A roughly square cloud cannot become a tall one without either stretching it or moving nodes relative to each other, and both of those rewrite the layout. The camera takes the slack instead. Getting a genuinely tall, undistorted layout means computing it tall — baking a second layout at a phone's aspect in `scripts/graph-layout.py` — not reshaping a wide one after the fact.

Wiring that up surfaced a bug in the size gate from the commit before: `var many = Object.keys(pos).length > AMBIENT_MAX_NODES` ran BEFORE `index()`, which is what fills `pos`. It was counting an empty object every time, so `many` was always false and the one case the gate exists for — a coarse pointer on the full 2,722-node graph — was never gated at all. It looked correct only because `_prune_for_lite` had already made the common case cheap. Verified in WebKit by reading lit pixels off the canvas: desktop ambient peak 261 / after a node click 295; phone (`has_touch`, coarse) ambient **0** / after a node tap 61.

**The reasoning that produced it —** iOS Safari froze on /graph: not a slow load, a FROZEN one, with the nav bar unable to take a tap — the signature of a main thread that never came back, not of a graph that failed to arrive. Everything tried before it (the static cover, the deferred payload, the DPR cap, the pulse gate, the wake repair) made the wait cheaper, better reported, or better behaved, and not one of them made the page do less: 2,722 nodes with 3,582 edges is a page a laptop draws and a phone dies on.

vis's `fit()` is CONTAIN: it scales until the limiting axis fits and leaves the other as empty margin, which on this near-square cloud in a wide window was two black bands with the graph sitting in the middle distance. `nodeBounds()` returns both scales and the page takes **`cover`** = `max(W/w, H/h)`, so neither edge has a gap and the cloud runs off the axis that is not limiting. It is centred on the node bounding box, so the overflow is shared evenly rather than landing all at one end. Measured: 1280×744 opens at 0.0883, cloud width exactly 1.00× the window and height 1.80×; 430×876 opens at 0.0593, height exactly 1.00× and width 2.08×. A wide window fills to width and crops top/bottom; a phone fills to height and crops left/right. **Every node is SNAPPED to a lattice first** (`snapToGrid`, 2026-09-21). The cell is `sqrt(area / (n x CELLS_PER_NODE))` over the cloud's bounding box — 4 cells per node, so most land on their first choice — and a taken cell sends the node ring-searching outward for the nearest free one, compared on real distance within a ring since a ring is a square and its corners are further than its edges. Placement is CENTRE-OUT so the crowded middle claims its own cells before the sparse rim pushes in, which keeps the walk short instead of cascading through the core. Measured on 2722 nodes: a 138-unit cell, 107x103 lattice, 2722 distinct points, zero overlaps. It writes with `network.moveNode`, never a DataSet update — a bulk write fires vis's `_dataUpdated` cascade and rebuilds every physics body. The camera bounds are recomputed after it, since the snap moves everything. **Then it backs off a quarter** (`OPEN_ZOOM_OUT` 0.75, 2026-09-21): cover alone runs the cloud to both edges, and a graph with no margin reads as cropped rather than as filling the frame. Note that at the opening scale (~0.046 on a 900px canvas) a node draws sub-pixel and vis gives it NO hit area — `getNodeAt` finds nothing anywhere on the canvas, so clicking a node means zooming in first. Worth knowing before testing a click by hand: it looks exactly like a broken click handler.

It replaced an `OPEN_ZOOM` of 1.25× applied on top of `fit()` — cover is already about 1.8× contain on a desktop window, so stacking the two would have over-cropped. The zoom-OUT wall stays on CONTAIN × `FIT_MARGIN` (0.8), deliberately looser than the cover the page opens at, so zooming out until every node is on screen at once is still allowed. It used to cap the viewport at half the node-cloud's area, which the opening view violates on arrival.

#### The tour kept its job and lost its mechanism, twice

The original overlay ran a **camera tour** — pick a random cluster every 10s, `network.focus()` its highest-degree node, and random-walk the gravitational constant to keep the layout "breathing" — behind a top-left **freeze | tour** segmented toggle. To do that it **re-enabled physics after graphify had already turned it off**, which left a 4.5k-node canvas running a force sim and redrawing every frame, forever. Measured: **0.4 fps, with 4.2-second frames**.

What was wrong with it was the camera, not the cycling. Flying to a cluster shows you that cluster and throws away the graph it came from; you arrive somewhere with no idea where you are. So the tour cycles as before and lights its stop **in place**, and the freeze toggle is gone outright — physics off is the only state. **The physics configurator panel went too** (2026-09-21), along with every `vis-configuration` rule that themed it: a strip of live sliders governs nothing once the sim is off for good, and a reload undoes whatever they were dragged to. The node-info panel on the right is the only panel left.

#### Why nothing writes to the DataSets, or to `network.body` either

An earlier hover-highlight mutated vis's drawn node objects and called `network.redraw()`. That was already the fast path — measured on the droplet's headless WebKit, for a ~30-node neighbourhood:

| Path | Cost |
|---|---|
| `nodesDS.update()` + `edgesDS.update()` | **7.4s** |
| direct `body.nodes[id].setOptions()` + one `network.redraw()` | **1.07s** |

A DataSet write fires vis's whole `_dataUpdated` cascade — visible-index rebuild, **physics-body rebuild for all 4.5k nodes and 6.5k edges** — on a graph whose physics is switched off and will never run again.

But 1.07s is a *hover*, not a *frame*. Once the tour had to animate, even the fast path was a full graph redraw 60 times a second, so the overlay took over and vis's canvas is now left completely alone. The DataSets stay pristine as the source of truth the overlay indexes at startup.

#### What a redraw costs, and what that means

A warm full redraw of the served graph, on the droplet's headless WebKit (no GPU, shared core — the pessimistic end; a phone or desktop is several times quicker):

| | ms |
|---|---|
| first redraw after stabilisation (cold: label measurement, shape caching) | ~8300 |
| warm redraw, nodes + edges | ~1500 |
| nodes only (edges hidden) | ~717 |
| edges only (nodes hidden) | ~539 |
| arrowheads disabled | ~1463 — **no saving; arrows stay** |

Redraw cost tracks the primitive count almost linearly and splits roughly evenly between nodes and edges, which is why the answer to "rendering is slow" is *draw fewer things* (11b) rather than *draw them cheaper* — and why the firing animation had to move off this canvas entirely. Those numbers were taken at 4561 nodes / 6501 edges; the graph is 2722 / 3582 now, so scale them by about 0.57.

---

**Seeds were drawn from a 16-square positional lattice until 2026-09-24.**
`partition()` cut the node cloud's bounding box into a `GRID`x`GRID` (4x4)
lattice, filed every node under one square at index time with its own weighted
prefix sum, and an iteration drew its extra seeds from the FIRST seed's own
square. It was cheap and it quantised, in three ways that all have the same
shape: a seed near a boundary could only draw inward, two seeds a pixel apart on
either side of a boundary got completely disjoint pools, and the same 16 regions
recurred for the life of the page. Replaced by a draw over the 64 nearest nodes
to the seed, which has no seams and needs no bookkeeping — the layout is frozen,
so one pass over ~2.8k nodes costs a few hundred microseconds a few times a
second. `GRID`, `cells`, `cellOf` and `partition()` went with it.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

(Moved out of ARCHITECTURE.md §11 / 11a–11e during the 2026-10-15 concision pass. Prose is verbatim or lightly trimmed. Items marked STALE no longer exist in source.)

### 11 (intro)

Guest-gated (Turnstile; it was public until 2026-07-03). `graph_page()` was split out of routes_views into `routes_graph.py` on 2026-08-30 for the 500-line cap.

### 11a. Applied per request, COMPUTED once per artifact

The pipeline chews a 3.6MB string through ten json round-trips. Measured on the droplet, that was **2.5–2.9s of CPU on every single page load** — the page's whole "slow to load" reputation, before a byte reached the browser (gzip takes the response to ~170KB, so the wire was never the problem).

`_cached()` objection answered: *"the graph is constantly regenerated, so it can't be cached"* has the invalidation backwards: it is regenerated ONCE A DAY by the 05:00 cron, and an mtime key is correct at any rebuild frequency because the next request after a write misses. A stale render cannot outlive its source.

The layout file joined the cache key after a day-long failure: the 05:00 cron rebuilds graphify (new graph.html, cache dropped) and only then runs `scripts/graph-layout.py`, so any visit in that window cached a render made WITHOUT a layout, and nothing invalidated it until the next rebuild — every visitor paid the ~30s browser stabilisation. A hand re-bake had the same problem.

`_externalise_boot` lifts every inline `<body>` script into ONE external file, content hash in `?v=` so the middleware stamps it `immutable`: 2.1MB of JS that changes once a day. `_defer_scripts` then marks every same-origin src tag `defer`. The fetch the parser now waits on is the rendering opportunity the cover needed. **FCP 1304ms → 387ms**, page shell 2.21MB → 9.3KB.

**It runs LAST in `_render`, and that is not a style preference.** Extracting first — the version this was written as — left every scrub/drop/merge/restyle/stats rewrite operating on a 9KB shell: they silently did nothing, the layout key came back EMPTY (every visit fell back to the ~30s browser stabilisation), and the payload served to the browser was the raw artifact with **no redaction**. Caught by checking the served payload rather than the served page: 2,722 nodes / 3,582 edges / 14 communities with x/y baked, and zero occurrences of the dropped prefixes.

**The bar moves from the first frame.** Until vis can report a real fraction there is nothing to report, so the track is served with `.gp-indet` — an indeterminate marquee — and `graph-overlay.js` adopts the existing element and drops that class on its first progress call or at reveal. A sliding segment claims only "working"; the fixed 3s fill this file replaced claimed a fraction it did not have.

The cover is its own file, `web/graph-cover.js` (`gpCover`, split from graph-overlay.js at the 500-line cap, same global scope, loaded first). It is the one script on the page that is **not** deferred: deferred, it ran after the payload it exists to report on, and the phase line's first words were `drawing` — after the slow part had already happened. What it reports:
- **The phase**, named: `fetching graph data` -> `building the graph` -> `drawing`, with seconds once there are at least three of them (a counter that opens at 0s makes a fast load look like a stopwatch).
- **The split the payload measures on itself.** `_externalise_boot` brackets the payload with `__GP_PAYLOAD_START`/`__GP_PAYLOAD_MS`, so the line reads `· data 0.9s · build 1.0s`. The marks are written BY the payload: through the build the main thread is blocked solid and a ticking clock measures nothing, while two timestamps taken either side survive it.
- **`(slower than usual)`** past 20s, and on a thrown error, or a payload that never arrives, `[ <reason> — reload to retry ]` with the cover lifted so the nav underneath is reachable. A global `error` listener and a `try/catch` around `go()` both land there, because opacity 0 is forever otherwise.
- The hard cap is **180s** and only calls it failure when `network` never appeared; otherwise it lifts the cover on whatever there is. A cap that fires while the page is genuinely working replaces a slow graph with a broken-looking one.

`#gp-pulse` caps its backing store at **DPR 2** in the same pass: on a DPR-3 phone it was a 1290x2628 buffer (12.9MB) composited under the CRT stack every frame, against 5.7MB. Measured warm after all of it, at 430x932 DPR 3: FCP **384ms**, revealed **2318ms**, no page errors.

**Tapping a node fires a cascade seeded on it** (`graphPulse.seed(id)`, wired to vis's `click`; graph.html's own handler still opens the node panel). It is the ordinary iteration with its seed chosen instead of drawn. Only the SEEDING clock is ever gated, never the rAF loop — an idle frame paints nothing, so the backdrop-filter readback never re-fires.

**Both ambient gates are gone as of the lite revert — `auto` is never set false today** (STALE: `AMBIENT_MAX_NODES` (1200) no longer exists in web/graph-*.js). The second read: `auto` is false only when a coarse pointer draws more than `AMBIENT_MAX_NODES`. The first read `(pointer: coarse)` alone, and that was wrong twice over. The cost was never the finger: it was 2,722 nodes lighting every frame under two backdrop-filter layers, and the lite variant already removed that. More to the point, **the cascade is what this page is**. Turning it off to protect the phone produced the report it was meant to fix — "page still freezes on safari mobile", which on asking meant *no animations*, not an unresponsive page. A still graph reads as a dead one.

`openView` waits for both: vis's own `afterDrawing` (camera-correct frame on screen), then the pulse's first PAINTED frame, reported through `graphPulse.init(onReady)` — fired from inside the draw call, because init returning only means the model exists. `network.redraw()` is called explicitly after `moveTo` in case the camera did not change. `READY_CAP` (3s) is armed BEFORE either wait and lifts unconditionally. Where nothing will ever paint by itself (`auto` off), `onReady` fires at once.

**A tap guarantees its first hop.** `advance()` lights a neighbour only on `Math.random() < catchOdds(id)`, and `fireEdge` sits inside that branch — so tapping a hub, whose neighbours are mostly degree-1 leaves at `TERMINAL_ODDS` 0.15, lit the node and almost nothing else. A `force` flag on the queued hop lights it without rolling, set only on the first ring out of a tapped node and never passed on. A tap also seeds none of the extra `SEEDS_PER_ITER` draws (they make an ambient iteration read as a REGION waking up; on a tap they would bury the answer under eight unrelated nodes). Measured on a degree-157 hub: lit pixels 896 ambient, **1842** after the tap.

**Community packing (`?pack=1`).** Each of the 14 communities moves as a RIGID tile — translation only, never scaling — shelf-packed into a box of the viewport's aspect, because vis's physics runs in world coordinates and ignores the viewport (baking in a tall window changes nothing) and scaling an axis is the squish. Measured at 430x932: **117 columns x 218 rows**, step 350 on both axes, cloud aspect 0.53 against a 0.50 viewport. Off by default: nothing inside a community moves, but where the communities sit relative to each other is dealt out again, and it reads as a different graph. `cell` is sized from the cloud BEFORE packing — letting the gaps between tiles coarsen the grid took the step from 97 to 350, which is exactly what makes nodes collide and clump. It feeds the achieved aspect back into the target four times (0.51 against a 0.49 phone).

**Shape reassignment, 2026-09-23.** `code` (2,078, 74%) upward triangle, `rationale` (462, 16%) hexagon, `document` (262, 9%) downward triangle. It got there in two steps — rotated one place (hexagon -> triangleDown -> triangle -> hexagon), then the two triangle directions swapped back — so against the previous table `code` and `rationale` traded shapes while `document` kept its downward triangle. The two triangle directions read as a related pair against the one hexagon, the reason `dot` is not in the table. The global `nodes: { shape }` tracks the MAJORITY type (`triangle` now, `hexagon` before the rotation), so an unknown type has always drawn like `code`. The cascade's lit glyph follows the shape (`web/graph-glyph.js`) because lighting everything as one shape made a cascade misdescribe what it was crossing; triangles draw at 1.15x radius and shifted, because that is what vis itself does (`triangle: y += 0.275 * (size *= 1.15)`, `triangleDown: y -= 0.275 * …`) — the overlay agrees with the renderer it paints over.

vis shape families: `circle`, `ellipse`, `box`, `text` draw the label INSIDE and size themselves to it, ignoring `size`; `dot`, `hexagon`, `triangle`, `triangleDown`, `diamond`, `square`, `star` draw the label outside and take `size`. Node size is geometric in degree, the primary encoding, so the first family would discard it.

**Two bakes, one per shape, because vis has no per-axis gravity.** Checked in the vendored 9.1.9 bundle: the only knobs are `centralGravity` (single scalar) and `gravitationalConstant`, both isotropic, no per-tick force hook. `scripts/graph-layout.py` imposes a shape on the SIM instead: on every `stabilizationProgress` it squeezes the cloud a few percent toward a target aspect and lets the next interval's springs relax against it. What comes out is a layout the forces agreed to at that shape — edges re-balance instead of being multiplied. It undershoots: **wide targets 1.60 and reaches 1.25, tall targets 0.50 and reaches 0.74**. Still worth it — a 0.49 phone picks the tall bake and `stretchToViewport` covers 0.72 -> 0.49 rather than 1.6 -> 0.49, roughly a third of the distortion. The tall set rides in the payload (~50KB of coordinates on the 9KB `no-cache` shell would be paid every load). `useBakedAspect` picks on log distance (0.5 and 2.0 equally far from 1) and applies all-or-nothing: a half-applied layout draws as two clouds overlapping.

**`__GP_PRESNAP` moved to the top of `snapToGrid`.** It was captured after the stretch, so the file held a cloud already pulled to the bake window's 1.6 and every client stretched that AGAIN. The served ratio still came out right (the stretch recomputes from the bbox), but the distortion compounded silently — the same class of bug as the moire.

**`centreBesidePanel`.** The node info panel covers the right, so centring on the canvas centre puts the node under the panel; the camera moves so the node lands at `(W - panel) / 2`. The correction is MEASURED (open-loop assumed the node starts at the canvas centre and landed 156px out). It runs on the next frame, **without animation**: every animated frame is a full vis redraw of 2,581 nodes at ~100ms, so a 200ms animated pan was still travelling 2.1s after the click with the hub's cascade competing. The camera is moved before the cascade is seeded.

**Bar easing.** The steps are real events and discrete, so the fill snapped. `transition: width 280ms ease-out` smooths how each step is drawn while leaving what it claims untouched. Filling the gaps with a timed creep was the obvious alternative and is what this file already removed once (a flat 3s fill sat full while the layout kept settling — slowing a lie down does not make it true). The marquee sets `transition: none` because its segment moves by transform. Measured: 0.28s on the fill, intermediate widths (89, 92, 152, 228px) sampled at 30ms.

**Small islands.** `_drop_graph_small_islands` walks connected components and cuts every one under `min_size` (5). At the opening zoom they are specks around the rim, and each costs a payload entry, a DataSet row and a lattice cell. Orphans are components of size 1, so this subsumes them; it still runs second because the cheaper pass shrinks the graph this one walks. Served: **2,722 -> 2,581 nodes, 3,582 -> 3,482 edges**, 137 components, smallest exactly 5, all 14 communities intact (424 down to 69).

**Bake invalidation observed.** The page reported key `fd0e2d07…` against a file holding `d43d7ddd…`; re-running `scripts/graph-layout.py` took 20.7s and restored it.

**Opening zoom history.** The opening view was `OPEN_ZOOM` **1.2** (a fifth IN of cover, cropping roughly a sixth off each axis; 430x867: graph drew 513x1032); `OPEN_ZOOM` is gone: it now opens at `contain * FIT_MARGIN` (0.8), the identical expression `setupZoomLimits` clamps the outward wall to. `OPEN_ZOOM_OUT` went 0.75 -> 1 once cloud matched window (STALE: the constant no longer exists in web/graph-*.js) — a quarter out was how you got the shape back when cover cropped hard, and with nothing left to overflow it was only a border of empty black.

**Stretch then snap.** `stretchToViewport` scales x and y by different factors so the cloud takes the window's shape, preserving area (`boxW*boxH == w*h`) so `cell` and lattice density come out unchanged; `snapToGrid` then quantises with one `cell` on both axes. Measured: **98 columns x 199 rows at 430x932**, ratio 0.49 against 0.49, and **183 x 106 at 1280x800**, 1.73 against 1.72 — step 112 on both axes.

Two different things have been called squished here and only one of them is. The POSITIONS are reshaped (x and y scale differently, so distance no longer means quite what the force layout meant). The LATTICE is not: the step between adjacent points is identical horizontally and vertically (measured 97 and 97). Conflating the two sent this round-trip through a removal and a restoration. The ordering is forced: with one cell size, `cols/rows` is exactly the cloud's bbox aspect, so the cloud has to be reshaped before the snap runs. `nodeBounds` pads the box by the largest node radius (`pw`/`ph`) because the bbox is built from node CENTRES and filling the window against an unpadded box clips the outermost nodes down the middle. It distorts distances, knowingly: the trade is against a phone seeing less than half the picture, and the same trade the snap makes by quantising at all.

**The snap is not cached, and does not need to be.** It runs client-side on every load; the nightly bake records positions from BEFORE it (via `__GP_PRESNAP`). A phone re-lays its 600 lite survivors onto a lattice whose `cell` is **2.13x** coarser (`cell` derives from node COUNT). Both measured **0.0-0.1s**, which corrected the bar: the snap was the suspect for the pause a phone reported after the bar filled, and it is not the cost — the gap is vis's first full draw at the new camera plus `graphPulse.index()`. `openView` yields a macrotask after naming its phase, since setting text then blocking in the same turn paints neither.

**`?lite=1` history.** A smaller graph was served to phones by user-agent (`_MOBILE_UA`: `iPhone|iPod|Android.+Mobile`; iPad deliberately not matched) for a few hours on 2026-09-22, and the owner reverted it: the whole graph is the point of the page. The reason: 2,722 nodes made Safari on iOS freeze solid on load (nav unable to take a tap). Every other lever (first paint, deferred payload, DPR cap, pulse gate) made the WAIT better and none made the work smaller. `_prune_for_lite` keeps the busiest 600 by degree — this graph's shape IS its hubs, the tail is leaves hanging off a single parent. It runs AFTER `_apply_graph_layout` (same trap `_externalise_boot` fell into: pruning first would change the key, miss the bake, and give the weakest device the ~30s stabilisation). `_CACHE` was keyed `(guest, lite)` — four entries, all kept warm by `run_graph_warm_loop`; `/graph/boot.js` looks in both variants for an unknown hash. Measured, iPhone UA at 430x932 DPR 3: **0.49MB / 600 nodes / 929 edges**, against 2.10MB / 2,722 / 3,582 full, all 14 communities and every baked x/y intact. On the droplet the two load within 300ms of each other (1978ms vs 2273ms) — this box was never the device that froze. `?full=1` was the escape hatch while lite was the phone default (STALE: the server no longer reads it).

### 11b. Drops

Net (2026-09 measurement; the 2026-10-12 bake holds 4,949 nodes as the repo grew): 4843 nodes / 7154 edges / 610 communities as emitted → **2722 / 3582 / 14** as served — 56% of the nodes and half the edges are somebody else's code, a reference text, a data file's key names, or a relationship graphify was only guessing at.

Prefix rationale: `api/tarot/book/` ~110 nodes; `web/vendor/` ~150 (one per mangled minified name `Kv()`, `_f()`, `Le()`); `nightfall-incident/nightfall-src/` 1054 nodes — a quarter of the whole graph and the single biggest community; `api/data/` 786 — JSON KEY structure of rd.json, the gamesaves, cron logs, cc_titles.json (`numCredits`, `netmapStatus`, `at`, bare uuids). Keys only, never values, so never a leak. The `.graphifyignore` mirror of `api/data/` was added 2026-10-14 after `api/data/`'s spire-perflog alone grew to 6,644 nodes and pushed the build to 14,666 > 8,000, so graph.html was skipped. Hyperedges dropped with the book were narrative clusters like "First-row forces gathered into the Chariot's ego". The vendored bundle is also excluded at ingestion (`**/vendor/`, `*.min.js`) so fresh graphs never carry vendor nodes; the prefix is the serve-time backstop for a stale graph.html. The overlay used to `hidden`-flag orphan nodes client-side, which still parsed them, built them into the DataSet and walked them each redraw. After 2026-10-14 submodule files index as `apps/<name>/…` (the nightly of that date 05:00 predates the move; its graph.json still held `web/aspira*`, `api/noodle/`, `tests/test_{spire,noodle}*`).

### 11c. Communities

54 buckets at `_MIN_COMMUNITY`; raising the threshold plateaus around 20 because the long tail is whole top-level dirs, not small modules. Colour is only a legible encoding while a reader can hold the legend in their head; 28 shades past that point encode nothing.

### 11d. Size, labels, shape, physics, stats

Size: doubled from `min(44, 6 × …)` on 2026-09-21 because at the opening whole-graph fit the hexagons were specks, and a node you cannot see is a node nobody will hover. Replaced `_size_graph_by_loc()` (sqrt of line count, ~10..40), which compressed the interesting end flat. Degree distribution at pick time: median 1, p90 5, p99 21, max 171 — the range is spent on degrees 1–17 (97% of nodes). x1.25 (15..110) tried 2026-09-22 and reverted the same day: largest hubs measured 220 across against a 168 lattice step, sitting over their neighbours.

Edges: opacity was 0.7 / width 2 in graphify, 1.0 for a while, 0 for an afternoon (too far — nothing for a lit node to be lit AGAINST, the page read as empty not dark), now 0.2 / 3. A global `edges: { color: { opacity } }` did nothing — measured, a runtime override moved the canvas ink count by exactly zero.

Nodes: fill was `#0f0f1a` (graphify's own body colour) until it read as navy shapes on the real black page; once the overlay punched both triangle orientations to cover vis's unrotated copy, navy-on-black showed as a visible union and was reported as the nodes being DUPLICATED. `_OCCLUDE_PCTL` was `_SIZE_MAX / 2` for one commit — wrong denominator: sizes are geometric, so the range midpoint caught 82 of 2867 nodes (2.9%). It went to 0.80 on 2026-09-24 and back to 0.90 the same day as a DIAGNOSTIC (the cause was `setBg` accepting the string "transparent" and turning the occlusion pass into a no-op): 0.90 -> 0.80 moved the cut only 20.3 -> 15.6 while more than doubling the solid set, 261 -> 573 nodes. The occlusion cut and the wave cut started as one number and were separated because they answer different questions (being solid vs throwing a front, which at 300x fills the screen). Every node used to have an opaque interior, including degree-1 leaves (76% of the graph, at the size floor) — a notch cut out of the single edge running in.

Physics: constants were graph-overlay.js's old tuned set (applied AFTER graphify's own stabilisation, i.e. stabilising twice then simulating forever). Iteration count walked on 2026-09-22: 270 -> 370 -> 300 -> 325 -> 300; 325 moved the bakes by 0.06 and 0.01 because the springs pulling back against the squeeze limit them, not run length. The run is spent inside the nightly bake now, so another hundred is ~7s of a ~20s job. `updateInterval` is small so the run yields the main thread (vis runs each interval's iterations in one synchronous batch). A never-idle force sim measured 0.4 fps; curved edges cost a bezier per edge per frame, the most expensive thing on the canvas at 6k edges. Stats header example: "56 communities" when 8 are rendered.

### 11e. Baked layout

Stabilising is ~300 forceAtlas2 iterations over 2581 nodes; on a phone it measured around thirty seconds on every visit. Baked layout measured at 430x932: **8.8s to ready, down from ~30s**, no node at the origin. `graph-layout.json` ~470KB at 4,949 nodes. `graphify-out` gitignored since 2026-10-12. The `systemd-run --user` bus failure was found by testing: the bake would have taken its failure branch every night while looking fine by hand. WebKit launch 200-400MB against ~650MB free at rest.

### 11f. The client-side overlay (history moved out of ARCHITECTURE.md, 2026-10-15)

#### Cascade tuning stories
- Seed weighting: strictly size-proportional looked like nothing happening (76% of nodes are size-floor, one-edge leaves; 9 seeds in 10 landed on a leaf that lit itself, rolled its one neighbour and stopped) -> `SEED_POW` 2. Seeds scattered anywhere in a hairball read as unrelated sparks; eight inside one proximity pool read as a region waking up. Proximity replaced a 16-square positional lattice that quantised at its boundaries.
- Stagger: eight hexagons on one frame = flashbulb; the same eight over 0.8s = a region coming awake. At 100ms each a 48-seed burst would take 4.8s, so the stagger became a WINDOW (`SEED_WINDOW_MS` 800).
- `P_MIN` was 0.18: chains too short to read as travelling (a spark, not a cascade); 0.55 carries about two hops through degree-1 nodes. `TERMINAL_ODDS` 0.15 because at `P_MIN` every cascade dragged a halo of dead ends.
- Overlap: once "one in flight, a new one every 2s"; now `ITER_MS` 1s / `ITER_LIFE` 2s (about two in flight). The busyness comes from how many nodes ONE iteration lights.
- Life: `DUR_MIN`/`DUR_PER_DEG` 1100+130 -> 1650+195 -> 2500+290 (2026-09-24, on request). `DECAY_POW` 1.8 -> 1.2 -> 0.85: below 1 the curve is concave (55% at the halfway point vs 43%); a node stays above alpha 0.5 +78% longer (1305 -> 2325ms) and above 0.1 +63%; it cannot go much lower or the fade becomes a hold that switches off. `ATTACK_MS` 90 -> 280: with a charge layer accumulating underneath, the rise was the only fast edge left and read as flicker. Cost of the longer life is FRAMES (`lit` non-empty longer), not drawing. `EDGE_DUR` stays 900 (node:edge 2.9x -> 4.4x).
- Edge effects fade faster than node effects: a node is a place, an edge is a crossing; held as long, the picture is a wireframe with bright corners, and over a long track an accumulating edge set ends as a solid web. Measured ambient: charged edges below charged nodes at every sample (72/97, 114/147, 137/178, 160/208, 221/275). Edges used to stroke white in the flash pass (a white -> community hue change over time); now tinted from the from-node on all passes; neutral ink is 1.7-8% of lit pixels (node cores).
- Saturated second layer (2026-09-23): over the top rather than under (under `'lighter'` it would be washed out during the overlap). Measured at 1000x800, 9s after seeding a hub (past the white pass's ~5.6s max): 31,924 of 33,072 lit pixels carried colour (channel spread up to 235); before the layer, zero. `graph-pulse.js` was exactly at the 500-line cap, so the layer lives wholly in `graph-pulse-draw.js` (model edits: cached ink on `pos`, `totalLife` in `expire`, `lit` in the `init` handover). `graph-seed.js` was split out when proximity seeding took graph-pulse.js past the cap.
- Hover used to pin the hovered node's whole community lit; the animation stopping dead under the pointer was worse than the question it answered -> `pin`/`unpin` removed (2026-09-21).
- Canvas under the CRT stack: raised above it on 2026-09-22 and REVERTED (the CRT was not the problem). Measured 2 fps under the stack vs 18 with it hidden on the GPU-less droplet WebKit, canvas work 0ms either way.
- `_NODE_OPACITY` was 0 for an afternoon: nothing to be lit against, the page read as empty not dark. Unlit ink at 1200x744: 121,177 pixels. A runtime `edges.color.opacity` override moved ink by exactly zero (per-edge colour objects outrank it).
- Ambient lit pixels 25 -> 22,767 and charged nodes 1 -> 168 over 7s (accumulating, not sawtoothing). `graphGlow not defined` happened when a browser got a new graph-pulse.js beside a shell whose `<script>` tags predated the dependency -> the no-op shim.
- Outline-and-halo: `A_FILL` was 1 (and earlier 0.55, which only greyed the bg-filled interior): the centre clipped to white and the halos ringed it, a blob at any real brightness that buried the shape (= node type). Opaque bg pixels on the overlay grew 97 -> 118 -> 139 over 3s of cascade (small because glyphs are a few pixels at the opening zoom).

#### Paint order history
- Originally three groups: all edges (charge, white, sat) -> halos -> one opaque black fill -> outlines. Edges drawn first meant `source-atop` landed the wavefront on every lit edge it crossed. 2026-09-24 re-cut to six passes (halos, clearNodes, punchNodes, outlines, ring, edges beneath via `destination-over`).
- Before that, passes interleaved (charge-edges, charge-nodes, white-edges, white-nodes...), so later edge passes drew over earlier node passes and edges crossed the glyphs they arrived at.
- `destination-out` vs a bg fill: an opaque fill hides vis's canvas a layer down (the unlit graph) and would undo `_unocclude_small_nodes` for exactly the nodes a cascade touches.
- Node fill bg bug 1: `_GRAPH_BG` was graphify's `#0f0f1a` after /graph began injecting chrome.css (`--bg-hsl` is pure black) -> navy shapes; rotated nodes had BOTH orientations filled, so the union (hexagram) read as duplicated nodes. Sampled punched interior `[0,0,0,255]` vs `[15,15,26]`. Bug 2: four fifths of nodes carry `transparent` (truthy), the old falsy-only guard accepted it, `BG` became `transparent`, `punchNodes` silently stopped occluding; symptom: bright centres of big nodes (a hub's lit edges add up under `'lighter'`). Verified: a hub with 40 lit neighbours read `[15,15,26,255]` once fixed (at the time).
- Occlusion: every node had an opaque interior including degree-1 leaves (76%), cutting a NOTCH out of the one edge running in. First threshold `_SIZE_MAX / 2` caught 82 of 2867 nodes (2.9%): sizes are geometric in degree, so the range midpoint sits in a thin tail -> percentile. `_OCCLUDE_PCTL` briefly 0.80 (a DIAGNOSTIC for the bright-centre bug) moved the cut only 20.3 -> 15.6 while solid nodes went 261 -> 573. At 0.90: threshold 20.3, 261 nodes (9.1%), min occluding degree 6. Trade: the same fill punches the halo inside a small node's glyph (small nodes carry their own faint glow).
- Rotated-node punching: briefly punched BOTH orientations "because it's page bg over page bg" - wrong, the punch lands on the node's own halo (2.6x radius) and cuts a hexagram hole = doubled shapes (reported twice).
- Node rotation removed 2026-09-24: written on `pos[id].t`; vis's static copy at the original angle can't be erased or re-oriented without a ~100ms full redraw per beat; two cover-ups failed (the opaque fill cut a hole in the halo; trimmed back it left a rim of vis's border).
- Sizes 6..44 -> 12..88 (2026-09-21); x1.25 (15..110) tried 2026-09-22 and reverted: the largest hubs were 220 across vs a 168 lattice step.
- `graph-surface.js` (108 lines) and `graph-glyph.js` split off graph-pulse-draw.js; `graph_geometry.py` split off graph_style.py at 513 lines (occlusion READS the size rule, so they must live together).
- Shape table reassigned 2026-09-23 (code up-triangle 2,078 / 74%, rationale hexagon 462 / 16%, document down-triangle 262 / 9%). Triangle: a plainly centred triangle put the lit glyph a third of a radius off; triangle gets 1.15x radius since at equal circumradius it reads smaller than the hexagon.

#### Wavefront history (2026-09-24)
- Originally a copy of the node's own shape (three silhouettes said the wrong thing); one UPWARD triangle (74% wear it anyway). `GROW` 300 so the largest front passes well off every edge. Linear growth because easing compounds against the range (at 0.75 and 50x, a front is past 18x a quarter through its life). Stroke strictly proportional is the zoom illusion; ends at 420px wide with alpha gone over the same span.
- Per-node gate let one beat throw several fronts (strobe); global `BEAT_GAP`. Concurrent fronts 23 -> 3. Nominal life ~2.6s vs beats ~0.5s apart nested ~5 fronts (read as a doubled shape) -> life clamped to one beat (500ms at 120bpm, 345 at 174). `BEAT_FALLBACK_MS` was 420 (now 840).
- `HALO_SWELL` removed: the halo followed `bloom` and swelled on every lit node, throbbing the whole picture in place; the kick's pulse moved to the front's extent (`BLOOM_GROW`, captured once at release so a later kick doesn't resize live fronts). `EDGE_SWELL` stays (per-passage, not per-kick).
- Front colour: coloured stroke under `source-atop` REPLACED node colour; white imposes no hue. `'luminosity'` would be exact but the single composite slot is taken. Residue: white over colour lightens toward white. Currently drawn via scratch layer + `'saturation'` blend.

#### Audio history
- Added 2026-09-24. Reading `getDisplayMedia` first (only route to real output; works with headphones), mic fallback. Chrome shows the picker whether or not "share tab audio" is ticked; unticked = video track, no audio.
- Old chain `source -> lowpass(200Hz) -> analyser`; averaging 512 bins after the filter divided the signal by ~128 (kick peaked 6.7/255 on the silence floor; 252 over the band alone). Then the lowpass itself removed: everything above 200Hz discarded, "loudness" was BASS loudness. 
- Old onset: energy over 1.32x the mean of the last 45 frames, history written AFTER the test; replaced by flux over a running MEDIAN (a mean is dragged up by the transients it baselines). Measured: 45 frames of sustained high flux then a 3x transient: `hit` 0.450 -> 1.000 at ratio 3.00.
- Octave: 120bpm click track raw-locked at 61 with high confidence; offering the winner its double gives 120, period exactly 500ms. A weighting nudge can't do it (half tempo is genuinely equally periodic).
- Tempo stability: a 6s envelope is ~12 beats at 120bpm, too little evidence -> 12s window; rolling median vote; the old `nextFire = now` on any 3% period change threw away the grid. 77 lines of dead code (a duplicate `tick()` left by a file split, referencing nonexistent `hist`/`HIST_N`/`FLOOR`/`fire`) came out of graph-tempo.js. Synthetic 120bpm train: locks at conf 0.958, accent 0.947 on beat 0 and exactly 0 on beats 1-3. `isDownbeat()` was missing the `LOCK_MIN` gate.
- Silence: "quiet hands back to ambient after 4s" was dropped; `driving()` = `on`. Verified by forcing the flag: 0 lit pixels for 24s.
- Placement: pan drove X for one commit - a mixed track sits near 0.5 and the un-normalised centroid mid-range -> a vertical column. The `at()` lookup itself spans the graph (fx 0..1 -> 11 distinct nodes over 18,011 world units; fy 10 nodes over 10,071), so the column was the input, not the lookup. Raw centroid uses a narrow slice of 60Hz..8kHz.
- X walk: independent random X per beat read as "too random"; then a pure random walk sat in one region (expected displacement zero, distance ~sqrt(steps)); momentum + reflection-flips-velocity: fraction of width covered after 16 fires 0.210 -> 0.822, after 32 0.321 -> 0.959. `X_STEP` 0.07 -> 0.09.
- Burst: seeds 4..20 -> 2..8; `MAX_SEEDS` 24 -> 48 -> 20; `EXTENT_GAIN` 3 -> 0.8 (pool reached 320 nodes: a region the size of the argument); `REACH_GAIN` 0.45 -> 0.18 (branching is degree x p so reach compounds; a cascade has to be able to die).
- Length bias measured on the served graph (mean edge 715; shortest 5% 194, longest 2% 2584): low pitch 1.60x long / 0.56x short; high 0.40x / 1.44x. Viewport shape at 430x932 vs 1400x900: cloud aspect 0.509 -> 1.656, mean-edge/diagonal 0.0319 vs 0.0313, p50/mean 0.761 vs 0.813, p98/mean 3.56 vs 3.77. The stretch is anisotropic, so a vertical edge on a tall phone is genuinely longer.
- Timbre: `mid`/`treb` were computed every frame and read by NOTHING until 2026-09-24. Bend `1 + K(1 - 2 sharp)`: 4069ms/448ms at the bass end vs 1181ms/112ms at treble. Crossovers: a 90Hz source cuts 118/1000, 700Hz 400/1400, 4kHz 400/6000. Fixed 200Hz/2kHz left a dark master with one band ~0 all song. dB window defaults -100..-30 pinned anything mastered at 255. Smoothing measured: 5 frames up 0.480 -> 0.792, down 0.728 -> 0.522. `PEAK_DECAY` 0.999 -> 0.99995 (fell to 1/e in ~17s, so the drop didn't look like one). `fftSize` 4096 (~11.7Hz bins): 2048 enough for a visualiser, 8192 smears time.
- Allocation found and removed: flux history was a pushed array (now a `Float32Array` ring + second buffer for the median), `window_` returned a fresh `{lo,hi,v}` per catch roll (out-params now), `graphLit.levels()` built a map + key per lit node per frame (one reused map).
- `graph-norm.js` split from `graph-audio.js` at 521 lines; `graph-source.js`/`graph-bias.js` split along their seams.
- Pitch is the `graphBias.length` rule: measured with a tight node (mean edge 194) and a far-reaching one (2135): same table as above. A node with no edges at 0 would make every isolated node a high-pitch magnet.

#### Cover / opening view / lattice / layout history
- First paint: graphify's dataset was one ~2.1MB inline script right after the cover; an inline script can't defer, so the parser spent a second executing it with no render opportunity. FCP 1304ms (129ms responseStart; page 133KB gzipped) -> 387ms after `_externalise_boot` (130KB gzipped, immutable). `_externalise_boot` before the drops left a 9KB shell: empty layout key (~30s phone stabilisation) and an UNREDACTED payload.
- Black /graph: reported from a phone as "tap GPH, nothing, then black"; failsafe was 120s. Cover moved to its own file (deferred it sat behind the payload; phase line first appeared at `drawing`). Two bugs from tracing the bar: phase text ran backwards while `go()` and the loader both wrote it; `indeterminate()` must clear the inline width or the marquee slides a full-width bar. WebKit returned all 2,204,421 bytes in ONE chunk, so a byte bar fired once at 100%. Milestones were 0.45/0.9 at first, then 0.35/0.6/0.75/0.9 after the lite payload made download+build finish almost at once.
- watchSleep (10s interval, >60s gap = "device slept", reload) tripped on every iOS app switch and reloaded into a black page; earlier its 30s watchdog fired mid-stabilisation and reloaded forever. Replaced by `watchWake`.
- Three phone failures 2026-09-22: reload-on-wake; the `(pointer: coarse)` pulse gate (turned the animation off on the device that reported a frozen page; later gate on node count also removed - "the animation is what the page IS"); cold render after restart (1.7-2.9s, per-process `_CACHE`) -> warm loop, TTFB 0.046s.
- Reveal used to fire the line after `moveTo` (uncovered the previous frame; first cascade lit a beat later). `moveNode` per node = a vis redraw per node: 160 draws, 16.1s main thread, median 93ms apart, 130 before the cover lifted; the 3s failsafe never fired (a busy thread can't run a timer). Direct writes + one redraw: 4 draws, 0.74s. `graphPulse.index()` chunked into four rAF phases (`nodes 22 / edges 5 / pos 7 / grid 54ms`) was not the culprit but stays so a failsafe can fire. `DRAWN_CAP` 800ms added.
- Opening zoom: `OPEN_ZOOM` 0.75 -> 1 -> 1.2 on top of fit(); cover (wallpaper fill; 1280x744 opened at 0.0883, 430x876 at 0.0593) then replaced by `contain x FIT_MARGIN`. Lattice was briefly rescaled into a viewport-aspect box before snapping (squashed everything inside; grid points square, picture not); then UNIFORM `k` (107x103 on every screen); then stretch-then-snap with one cell: 98x199 at 430x932 (0.49 vs 0.49), 183x106 at 1280x800 (1.73 vs 1.72), step 112/112.
- Moire "groups of four": the baker read positions AFTER `snapToGrid` (107 distinct x, gaps 146/147), re-snapped at cell 97, 146/97 = 1.505 -> alternating wide/narrow gaps. `__GP_PRESNAP` fixed it: 107 -> 2,433 distinct x; clumps from hard cap 4 to a natural tail (1220 singles ... one 107). `__GP_PRESNAP` was first captured after the stretch (baked the bake window's aspect, stretched again).
- `CELLS_PER_NODE` 4 -> 9 -> 7 (19,054 pts, cell 112) -> 5.25 -> 3.9375 -> 2.953125 -> 2.21484375 (5,716 pts, cell 194). Simulated on the tall bake: blocks 588 -> 328, nodes alone 341 -> 184, largest block 196 -> 204. `nearestFree` tie-break: displaced nodes 903 -> 793 (old density), 1,285 -> 1,150 (this one).
- Stabilisation 220 -> 270 -> 370 -> 300 (370 bought nothing for 8s of bake; 270/300/325/370 walked 2026-09-22); bake 20.7s -> 29.1s at 370. Bakes: vis has no per-axis gravity (9.1.9 has scalar `centralGravity`); targets 1.60 (got 1.20) and 0.50 (got 0.72); stretch remainder 0.72 -> 0.49 vs 1.6 -> 0.49, about a third of the distortion. `?pack=1`: 14 communities as rigid tiles shelf-packed (117x218, step 350, cloud 0.53 vs 0.50), aspect fed back four times (0.51 vs 0.49); off because it deals the communities out again. Baked layout: 430x932 ready 8.8s vs ~30s.
- `_cached` once keyed on graph.html alone: the 05:00 cron rebuilds graphify and bakes after it, so a visit in between cached a render with NO baked layout for a full day.
- Phone default `?lite=1` lasted a few hours and was reverted on the owner's call (a codebase map with its leaves cut off is a smaller claim). Freeze answered by making the page cheaper: 0.49MB / 600 nodes / 929 edges vs 2.10MB / 2,722 / 3,582.
- Islands under 5 dropped (2026-09-22): 2,722 -> 2,581 nodes, 3,582 -> 3,482 edges, 137 components (smallest 5), 14 communities (424 down to 69). `api/data/` (786 key-structure nodes) and `nightfall-src/` (1054) dropped 2026-09-21. 4843/7154/610 emitted -> 2581/3482/14 served; `(other)` 444 (38 small modules). Raising the cap to 22 only took `(other)` to 285 (52 buckets before the fold).
- Tap-centring: open-loop offset landed 156px out; measured correction next frame; animated pan took 2.1s (each frame a full 2,581-node redraw ~100ms). Tap guaranteed first hop: lit pixels 896 ambient -> 1842 after tapping a degree-157 hub. Palette lint: `hue2rgb` in graph-ink.js renamed `hueChan`.
- The physics configurator panel, freeze|tour toggle and the camera tour were removed 2026-09-21 (tour re-enabled physics: 4.5k-node canvas at 0.4 fps with 4.2s frames).

### 11g. Field notes (moved verbatim from CLAUDE.md 2026-09-27)
Everything above was folded out of the 11g block; stale values found there on 2026-10-15 (ITER cadence "every 2s", `BEAT_FALLBACK_MS` 420, `X_STEP` 0.07, bar milestones 0.45/0.9, "unlit edges opacity 1.0", "beat calls `seed()` with no argument", "ambient resumes after 4s of silence", `lowpass(200Hz)` chain, `MAX_SEEDS` 24/48, `ITER_LIFE` cadence) were dropped as superseded. The 11g text on the 05:00 bake: "~370 forceAtlas2 iterations over 2581 nodes measured ~30s on a phone every visit" is the motivation for the baked layout.


---

