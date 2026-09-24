// /graph — the firing overlay's MODEL half. Loaded by the /graph route after
// graph-pulse-draw.js and before graph-overlay.js (same global scope, no
// modules); graph-overlay.js starts it, graph-pulse-draw.js paints it.
//
// The split is the 500-line cap taken at the honest seam: this file knows what a
// cascade is and nothing about pixels; the draw file is the reverse. The state
// handed over at init (`pos`, `litEdges`, `level`) is mutated in place here and
// never reassigned, which is the contract that makes one handover enough.
//
// WHY A SEPARATE CANVAS AT ALL. vis draws every node and every edge on each
// redraw, and a warm full redraw of this graph measured ~1.5s at 4561 nodes on
// the droplet's headless WebKit. An animation that redrew vis per frame would be
// the camera tour's 0.4 fps all over again, which is the exact thing the tour was
// rebuilt to stop doing. So the layout is frozen, vis's canvas is left alone, and
// a transparent canvas draws ONLY what is currently lit. Cost per frame is
// O(lit), not O(graph).
//
// The frozen layout is what makes it cheap: world positions never move, so they
// are read once and every frame is two multiplies per lit node. The camera can
// still pan and zoom — the transform is recomputed from vis's own scale and view
// position each frame, so the glow stays welded to the nodes.
//
// WHAT IT LOOKS LIKE. Brain activity, as a SPREADING CASCADE. Once a second a
// seed node is picked at random, weighted by size, and the activation walks
// outward hop by hop: each neighbour is tried after a short delay and lights with
// a probability set by ITS OWN size, lighting the edge it arrived along. A
// neighbour that fails its roll is spent and propagates nothing, so a cascade
// dies out on its own — most are a spark of two or three nodes, and a seed that
// lands on a hub blooms across a whole neighbourhood. Iterations overlap (one starts
// every ITER_MS, each lives ~ITER_LIFE), so there are always a couple in flight.
//
// Everything fades rather than blinking off, and because size tracks degree, the
// hubs are both the likeliest seeds and the longest-lit.
/* global network, nodesDS, edgesDS, graphPulseDraw, graphRing */
var graphPulse = (function () {
  'use strict';

  // ── the cascade model ──────────────────────────────────────────────────────
  // One iteration per ITER_MS, each given ITER_LIFE to finish. Seeding is on a
  // clock and NOTHING ELSE: it does not wait for the last cascade to finish or
  // for the canvas to go dark. At 1s against a 2s life that is two overlapping,
  // one arriving as the one before it is fading out.
  var ITER_MS = 1000;
  var ITER_LIFE = 2000;
  // A safety bound, not the working number: four cascades is the steady state, so
  // this has to sit above it or the cap would be quietly truncating the oldest
  // live cascade every single tick.
  var MAX_LIVE = 8;
  var HOP_MS = 110;               // delay per hop, jittered by HOP_JITTER — this
  var HOP_JITTER = 0.3;           // is what makes it travel rather than appear

  // A neighbour lights with a probability set by ITS OWN size, mapped across the
  // size range. Sizes are geometric in degree (graph_style._size_graph_by_degree),
  // so this is a degree rule wearing the size it is drawn at. Branching is
  // degree x p: at P_MIN a chain through degree-1 nodes carries about two hops
  // before it dies, and anything with real degree keeps going. The floor was 0.18
  // and the chains were too short to read as travelling -- a spark, not a
  // cascade.
  var P_MIN = 0.55;
  var P_MAX = 1;
  // Terminal nodes -- degree 1, nothing past them -- are held well under the
  // floor. They are 76% of this graph, and on the size curve they sit at the
  // floor too, so at P_MIN every cascade dragged a halo of dead ends up with it:
  // lights that go nowhere, drawn at the same weight as the chain they hang off.
  // The same number scales their odds of being SEEDED, since a cascade that
  // starts at a dead end can never be more than a single dot.
  var TERMINAL_ODDS = 0.15;
  // How much the audio level raises the catch odds (4.2) and widens the seed pool
  // (4.1). Both are deliberately gentle: branching is degree x p, so reach
  // compounds, and a pool that grows too fast turns a loud bar into the whole
  // graph at once.
  // The audio biases (reach, extent, edge length) live in graph-bias.js.
  // The size range graph_style._size_graph_by_degree emits. Mirrored rather than
  // derived from the data so one enormous outlier can't flatten everything else
  // onto P_MIN; if that range moves, move these with it.
  var SIZE_FLOOR = 12;
  var SIZE_CEIL = 88;
  // Nodes lit at the START of an iteration, all from the one square: a burst,
  // not a spark. The first is the weighted whole-graph draw that CHOOSES the
  // square; the rest come out of that square, staggered. Each of them still
  // spreads, so the burst is a starting condition and not the whole event.
  var SEEDS_PER_ITER = 8;
  // A caller may ask for more than SEEDS_PER_ITER — graph-audio.js does, scaling
  // with how loud the bar is. Bounded here so a runaway level cannot ask for a
  // thousand starting points on one frame.
  // 20. It was 48 to leave BEAT_BOOST somewhere to go, but with the seed range
  // itself cut to 2..8 the ceiling only has to clear a boosted downbeat, and a
  // burst that lights fifty nodes at once is a flashbulb rather than a region
  // waking up.
  var MAX_SEEDS = 20;
  // The seeds do not all land at once — one every SEED_STAGGER_MS. Eight
  // hexagons appearing on the same frame reads as a flashbulb; the same eight
  // arriving over 0.8s reads as a region coming awake, and it also gives the
  // first seeds' own spread time to start before the last one has fired.
  var SEED_STAGGER_MS = 100;
  // ...but the whole burst fits inside this, however many seeds it holds. 100ms
  // each reads as a region waking up at 8 seeds; at 48 it would be 4.8s and span
  // several beats, which is a different thing entirely.
  var SEED_WINDOW_MS = 800;
  // Draws are weighted and with replacement, so eight draws do not give eight
  // distinct nodes. Retry, but bounded — a square holding four nodes must not
  // spin looking for a fifth.
  var SEED_TRIES = 4;

  // The lit envelopes and their two registers live in graph-lit.js.

  var pos = {};                   // id -> {x, y, r, s, c, e}; world units, read once
  var deg = {};                   // id -> edge count
  var adj = {};                   // id -> [neighbour ids]
  var live = [];                  // iterations in flight: {queue, seen, until}
  var nextIter = 0, running = false, lastFrame = 0;
  var edgeRef = 0;                // mean edge length, for the pitch bias

  // graph-glow.js is loaded before this file — and this working tree is edited
  // LIVE, so for a few seconds after a change a browser can be handed a new
  // graph-pulse.js alongside a page shell whose <script> tags predate its new
  // dependency. That happened, and was reported as `graphGlow not defined`.
  //
  // The failure mode is what makes the guard worth it: an unguarded call does not
  // cost the accumulation, it THROWS inside the rAF callback and takes the entire
  // cascade with it, so the page goes still. A no-op shim degrades to "no charge
  // layer" instead, which is the old look and nobody's emergency.
  var NO_GLOW = {
    bump: function () {}, bumpEdge: function () {}, step: function () {},
    nodes: function () { return {}; }, edges: function () { return {}; },
    charged: function () { return 0; },
  };

  function beat() {
    return typeof graphTempo !== 'undefined' ? graphTempo : null;
  }

  function glow() {
    return typeof graphGlow !== 'undefined' ? graphGlow : NO_GLOW;
  }

  // The wavefront, on the same no-op shim as the charge above and for the same
  // reason: this tree is edited live, so a new graph-pulse.js can reach a browser
  // before its dependency's script tag does, and an unguarded call throws inside
  // the rAF and takes the whole cascade down rather than costing one effect.
  var NO_RING = {
    index: function () {}, fire: function () {}, expire: function () {},
    live: function () { return []; },
    phase: function () { return 1; }, scale: function () { return 1; },
    fade: function () { return 0; },
    busy: function () { return false; }, reset: function () {},
  };

  function ring() {
    return typeof graphRing !== 'undefined' ? graphRing : NO_RING;
  }

  // Indexing runs in PHASES, one per frame, timed, with the milliseconds left on
  // the window for the cover to print: a thread that yields between them is one
  // a failsafe can still fire on, and a phase that is slow on a device nobody
  // here can profile says so there. 88ms all told — insurance, not a hot path.
  function index(done) {
    var t = {};
    var steps = [
      ['nodes', function () {
        var all = nodesDS.get();
        for (var i = 0; i < all.length; i++) {
          var n = all[i];
          pos[n.id] = { x: 0, y: 0, r: n.size || 10, s: n.shape, c: graphPulseDraw.satInk(n.color && n.color.hover && n.color.hover.border) };
          if (n.color && n.color.background) {
            // The page background, for the opaque fill that makes a node occlude
            // the edges behind it. Read off the data, never a second literal.
            graphPulseDraw.setBg(n.color.background);
          }
          deg[n.id] = 0;
          adj[n.id] = [];
        }
      }],
      ['edges', function () {
        var es = edgesDS.get();
        for (var i = 0; i < es.length; i++) {
          var e = es[i];
          if (!adj[e.from] || !adj[e.to]) {
            continue;
          }
          deg[e.from] += 1;
          deg[e.to] += 1;
          adj[e.from].push(e.to);
          adj[e.to].push(e.from);
        }
      }],
      // The layout is frozen, so world positions are read ONCE. Losing this read
      // is not a subtle failure: every node keeps x=0, y=0 and the whole cascade
      // draws on top of itself in the dead centre of the screen.
      ['pos', function () {
        var ids = Object.keys(pos);
        var world = network.getPositions(ids);
        for (var i = 0; i < ids.length; i++) {
          var w = world[ids[i]];
          if (w) {
            pos[ids[i]].x = w.x;
            pos[ids[i]].y = w.y;
          }
        }
        // The mean edge length, which the pitch bias measures against. It has to
        // be taken HERE and not with the rest of the edge indexing two steps up:
        // that runs before `getPositions`, so every node is still at 0,0 and every
        // edge would measure zero.
        var es = edgesDS.get(), total = 0, n = 0;
        var sum = {}, cnt = {};
        for (i = 0; i < es.length; i++) {
          var a = pos[es[i].from], b = pos[es[i].to];
          if (!a || !b) {
            continue;
          }
          var dx = a.x - b.x, dy = a.y - b.y;
          var len = Math.sqrt(dx * dx + dy * dy);
          total += len;
          n++;
          sum[es[i].from] = (sum[es[i].from] || 0) + len;
          cnt[es[i].from] = (cnt[es[i].from] || 0) + 1;
          sum[es[i].to] = (sum[es[i].to] || 0) + len;
          cnt[es[i].to] = (cnt[es[i].to] || 0) + 1;
        }
        edgeRef = n ? total / n : 0;
        // Each node's OWN mean connected edge length, normalised against twice the
        // graph's mean so an average node sits at 0.5 -- the same convention the
        // per-hop bias uses, so one LENGTH_BIAS governs both and they cannot
        // disagree about what "long" means. A node with no edges reads 0.5, i.e.
        // no opinion, rather than 0, which would read as "shortest possible" and
        // make every isolated node a high-pitch magnet.
        var ids2 = Object.keys(pos);
        for (i = 0; i < ids2.length; i++) {
          var k = ids2[i];
          pos[k].e = cnt[k] && edgeRef
            ? Math.min(1, (sum[k] / cnt[k]) / (2 * edgeRef))
            : 0.5;
        }
      }],
      ['grid', function () {
        graphSeed.index(pos, deg, TERMINAL_ODDS);
      }],
    ];
    var at = 0;
    (function run() {
      if (at >= steps.length) {
        window.__GP_INIT_MS = t;
        done();
        return;
      }
      var step = steps[at++];
      var t0 = performance.now();
      step[1]();
      t[step[0]] = Math.round(performance.now() - t0);
      requestAnimationFrame(run);
    })();
  }

  // ── firing ─────────────────────────────────────────────────────────────────

  // A node's chance of catching the activation, from its own size. Sizes are
  // geometric in degree, so this is a degree rule in the units it is drawn at.
  function catchOdds(id) {
    if ((deg[id] || 0) <= 1) {
      return TERMINAL_ODDS;
    }
    var r = pos[id].r;
    var t = (r - SIZE_FLOOR) / Math.max(SIZE_CEIL - SIZE_FLOOR, 1);
    var p = P_MIN + (P_MAX - P_MIN) * Math.max(0, Math.min(1, t));
    // REACH follows the level. These odds were fixed, so every cascade died at
    // the same distance however loud the music was: the only thing loudness
    // changed was how many nodes lit at once, never how far the activation got.
    // Branching is degree x p, so a small push here is a large change in how far
    // a chain carries -- which is why the gain is modest.
    return graphBias.reach(p);
  }

  // The hop delay is a MUSICAL subdivision when there is a tempo to divide, and
  // the old constant otherwise. At a flat 110ms the cascade travelled at a rate
  // unrelated to whatever was playing, so even with the seeding perfectly on the
  // grid the SPREAD was arrhythmic -- the one part of the animation the eye
  // actually follows.
  function hopAt(now) {
    var b = beat();
    var base = (b && b.hopMs()) || HOP_MS;
    return now + base * (1 - HOP_JITTER + Math.random() * 2 * HOP_JITTER);
  }

  // One iteration: a seed, then a frontier that walks outward. `seen` is
  // per-iteration, so a node is TRIED once per cascade however many neighbours
  // reach it — which is what stops a dense region from re-rolling itself forever.
  // `pick` is a weighted draw; `at` is a node someone chose. They are the same
  // iteration either way — a tapped node gets the burst, the stagger and the
  // outward walk a randomly seeded one gets, because the interesting thing about
  // a node is what it is connected to, and that is what the cascade draws.
  function startIteration(now, at, count, burst) {
    // `burst` separates the two reasons to name an id. A TAP wants its first hop
    // guaranteed and no extra seeds -- it is one node someone asked about. An
    // AUDIO-CHOSEN PLACE wants the full burst around it, because the place is the
    // answer and the burst is what makes it read as a region.
    var tapped = at !== undefined && at !== null && !burst;
    var want = Math.max(1, Math.min(MAX_SEEDS, count || SEEDS_PER_ITER));
    var id = at !== undefined && at !== null ? at : graphSeed.any();
    if (id === null || !pos[id]) {
      return;
    }
    // The life has to cover the stagger as well, or the last seeds would be
    // dropped before they ever fired.
    var it = {
      queue: [], seen: {},
      until: now + ITER_LIFE + want * Math.min(SEED_STAGGER_MS, SEED_WINDOW_MS / Math.max(1, want)),
    };
    // A tap guarantees its first hop, and seeds none of the extra draws below.
    // Why both: ARCHITECTURE §11.
    ignite(it, id, now, tapped);
    // EXTENT follows the level: a loud hit covers more ground, not just more
    // nodes inside the same 64.
    var pool = tapped ? null
      : graphSeed.near(id, graphBias.pool(64));
    // The stagger is a WINDOW, not a fixed gap per seed. At 100ms each, a 48-seed
    // burst would take 4.8s to fire and span several beats -- so a big burst
    // packs tighter instead of lasting longer, and a burst stays one event
    // however many nodes it lights.
    var stagger = Math.min(SEED_STAGGER_MS, SEED_WINDOW_MS / Math.max(1, want));
    var seeded = 1, tries = want * SEED_TRIES;
    while (pool && seeded < want && tries-- > 0) {
      var extra = graphSeed.from(pool);
      if (extra !== null && !it.seen[extra]) {
        // Claim it NOW so the remaining draws cannot pick it again, but light it
        // later. `seed` marks it as not needing a roll when its turn comes: it
        // was chosen, not caught, so it lights unconditionally and lights no
        // edge — there is no edge it arrived along.
        it.seen[extra] = 1;
        it.queue.push({
          id: extra, from: null, seed: true,
          at: now + seeded * stagger,
        });
        seeded += 1;
      }
    }
    live.push(it);
    if (live.length > MAX_LIVE) {
      live.shift();
    }
  }

  // All the seeds of one iteration share its `seen` and its queue, so the three
  // cascades merge into a single event instead of re-rolling each other's nodes.
  function ignite(it, id, now, force) {
    it.seen[id] = 1;
    graphLit.fire(id, now);
    spread(it, id, now, force);
  }

  // `force`: this hop lights without rolling. First ring out of a tap only.
  function spread(it, from, now, force) {
    var ns = adj[from] || [];
    for (var i = 0; i < ns.length; i++) {
      if (!it.seen[ns[i]]) {
        it.seen[ns[i]] = 1;
        it.queue.push({ id: ns[i], from: from, at: hopAt(now), force: !!force });
      }
    }
  }

  // Everything due this frame is tried at once. A node that fails its roll is
  // spent: it does not light, and nothing walks past it. That is the whole reason
  // a cascade dies out on its own instead of eating the graph every second.
  function advance(it, now) {
    var keep = [];
    for (var i = 0; i < it.queue.length; i++) {
      var q = it.queue[i];
      if (q.at > now) {
        keep.push(q);
        continue;
      }
      if (q.seed) {
        graphLit.fire(q.id, now);
        spread(it, q.id, now);
      } else if (q.force || Math.random() < catchOdds(q.id) * graphBias.length(q.from, q.id)) {
        graphLit.fire(q.id, now);
        graphLit.fireEdge(q.from, q.id, now);
        spread(it, q.id, now);
      }
    }
    it.queue = keep;
  }

  function step(now) {
    // Seeding is on a clock and nothing else — never gated on whether anything
    // is still lit, which is what keeps one cascade always in flight.
    if (now >= nextIter && !(window.graphAudio && graphAudio.driving(now))) {
      startIteration(now);
      nextIter = now + ITER_MS;
    }
    for (var i = 0; i < live.length; i++) {
      advance(live[i], now);
    }
    live = live.filter(function (it) {
      return it.queue.length && now < it.until;
    });
    graphLit.expire(now);
    ring().expire(now);
  }

  var last = 0, idle = true;

  // Skip the draw on a frame with nothing to show. Cascades are sparse by design,
  // so the page is idle most of the time — and a full-viewport canvas layer that
  // repaints every frame is not free even when it paints nothing: it is a
  // composite of the whole viewport, and on this page that is five CRT layers,
  // two of them backdrop-filters. Measured on the droplet's GPU-less headless
  // WebKit, where the difference is the whole frame budget; on hardware with a
  // compositor it is simply free battery.
  function frame(now) {
    if (!running) {
      return;
    }
    // Drain the accumulated opacity. Its rate is the audio level, which is why it
    // is graph-glow.js's business rather than a constant here.
    glow().step(lastFrame ? now - lastFrame : 0);
    lastFrame = now;
    last = now;
    step(now);
    // graphGlow.charged() is part of this: the accumulated opacity outlives every
    // cascade by design, and without it an idle frame would clear the canvas and
    // throw away the picture a whole track had built.
    // A wave outlives the flash that threw it on a big node, so it is part of this
    // too: without it an idle frame would clear the canvas mid-expansion.
    var busy = live.length || graphLit.busy() || glow().charged() > 0
      || ring().busy();
    if (busy) {
      graphPulseDraw.paint(now, graphLit.levels(now));
      firePainted();
      idle = false;
    } else if (!idle) {
      graphPulseDraw.clear();   // one last frame to clear what was lit
      idle = true;
    }
    requestAnimationFrame(frame);
  }

  // Once, on the first painted frame; nulled so later cascades do not call back.
  var onPainted = null;

  function firePainted() {
    var cb = onPainted;
    onPainted = null;
    if (cb) {
      cb();
    }
  }


  return {
    // One cascade, seeded exactly where it was asked for. No-op until init has
    // indexed the graph, and on a node the index does not hold.
    seed: function (id, count) {
      if (running) {
        startIteration(performance.now(), id, count);
      }
    },
    // A cascade at a PLACE the caller chose, with the full burst around it. This
    // is the audio's entry: graphSeed.at() turns a spectral feature into a node
    // and this lights the region around it.
    seedAt: function (id, count) {
      if (running && id !== null && id !== undefined) {
        startIteration(performance.now(), id, count, true);
      }
    },
    // `onReady` fires on the first frame this layer actually PAINTS — not when
    // init returns, which is only the moment the model is wired. The cover waits
    // on it, so "ready" means the animation is running on screen rather than
    // scheduled to.
    init: function (onReady) {
      if (running || typeof network === 'undefined') {
        return;
      }
      // The cascade runs everywhere: every graph size, every pointer. It was
      // gated twice — on `(pointer: coarse)`, then on node count — and both
      // gates turned the animation off on the device that had reported the page
      // as FROZEN, which a still graph reads as. ARCHAEOLOGY §11 has the whole
      // history; the short version is that the cost was never here.
      onPainted = onReady || null;
      index(function () {
        graphLit.index(deg);
        graphBias.index(pos, edgeRef);
        // The wavefront reads a node's own radius off `pos` to decide whether it is
        // one of the big ones, so it is handed the same map.
        ring().index(pos);
        graphPulseDraw.init(pos, graphLit.nodes(), graphLit.edges(),
          graphLit.level, graphLit.satLevel, glow().nodes(), glow().edges());
        running = true;
        requestAnimationFrame(frame);
      });
    },
  };
})();
