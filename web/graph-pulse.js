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
/* global network, nodesDS, edgesDS, graphPulseDraw */
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
  // The size range graph_style._size_graph_by_degree emits. Mirrored rather than
  // derived from the data so one enormous outlier can't flatten everything else
  // onto P_MIN; if that range moves, move these with it.
  var SIZE_FLOOR = 12;
  var SIZE_CEIL = 88;
  // Seeds are drawn on size to the SEED_POW, not on size itself. Strictly
  // proportional looks like nothing happening: 76% of nodes sit at the size
  // floor with one edge, so 9 seeds in 10 landed on a leaf that lit itself, rolled
  // its single neighbour at 0.18 and stopped. Squaring the weight splits the
  // difference — about half the seeds still land on small nodes and fizzle, which
  // is what makes the ones that bloom read as events.
  var SEED_POW = 2;
  // The cloud is cut into a GRID x GRID lattice of positional squares, and an
  // iteration lights SEEDS_PER_ITER nodes out of ONE of them. Seeds scattered
  // anywhere in a hairball read as unrelated sparks; eight inside one square
  // read as a region waking up.
  var GRID = 4;
  // Nodes lit at the START of an iteration, all from the one square: a burst,
  // not a spark. The first is the weighted whole-graph draw that CHOOSES the
  // square; the rest come out of that square, staggered. Each of them still
  // spreads, so the burst is a starting condition and not the whole event.
  var SEEDS_PER_ITER = 8;
  // The seeds do not all land at once — one every SEED_STAGGER_MS. Eight
  // hexagons appearing on the same frame reads as a flashbulb; the same eight
  // arriving over 0.8s reads as a region coming awake, and it also gives the
  // first seeds' own spread time to start before the last one has fired.
  var SEED_STAGGER_MS = 100;
  // Draws are weighted and with replacement, so eight draws do not give eight
  // distinct nodes. Retry, but bounded — a square holding four nodes must not
  // spin looking for a fifth.
  var SEED_TRIES = 4;

  // How long a node stays lit. Degree buys time, on the same argument as size:
  // the busy nodes are the ones worth looking at, so they hold the eye longer.
  // Slowed 50% on 2026-09-21 (from 1100 + 130/edge): the fade is sampled at the
  // frame rate, so a longer fade is also more steps between lit and unlit, which
  // is what the stepping looked like.
  var DUR_MIN = 1650;
  var DUR_PER_DEG = 195;
  var DUR_DEG_CAP = 12;
  var DUR_JITTER = 0.4;
  var EDGE_DUR = 1650;
  var ATTACK_MS = 90;             // rise; the rest of the life is the fade
  var DECAY_POW = 1.2;            // >1 = falls away faster than it lingers. Close
  // to linear on purpose: at 1.8 the light was gone before the eye had followed
  // the chain that lit it.

  var pos = {};                   // id -> {x, y, r, c} in world units, read once
  var deg = {};                   // id -> edge count
  var adj = {};                   // id -> [neighbour ids]
  var ids = [];                   // every node id, in cumulative-weight order
  var cum = [];                   // prefix sums of weight, for the seed draw
  var cells = [];                 // GRID*GRID squares, each {ids, cum}
  var cellOf = {};                // id -> square index
  var lit = {};                   // id -> {t0, dur}
  var litEdges = {};              // "a\u0000b" -> {t0, dur, a, b}
  var live = [];                  // iterations in flight: {queue, seen, until}
  var nextIter = 0, running = false;

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
          pos[n.id] = { x: 0, y: 0, r: n.size || 10, s: n.shape };
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
        ids = Object.keys(pos);
        var world = network.getPositions(ids);
        for (var i = 0; i < ids.length; i++) {
          var w = world[ids[i]];
          if (w) {
            pos[ids[i]].x = w.x;
            pos[ids[i]].y = w.y;
          }
        }
      }],
      ['grid', function () {
        cum = weigh(ids);
        partition();
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

  // Seed weight: size to the SEED_POW, knocked down to TERMINAL_ODDS for a dead
  // end. One function so the whole-graph draw and the per-square draws cannot
  // drift apart — an unweighted square pick would bring back the halo of
  // terminal nodes that TERMINAL_ODDS exists to remove.
  function seedWeight(id) {
    var w = Math.pow(pos[id].r, SEED_POW);
    return (deg[id] || 0) <= 1 ? w * TERMINAL_ODDS : w;
  }

  // Prefix sums, so a weighted pick is one binary search rather than a scan or a
  // reject loop.
  function weigh(list) {
    var total = 0;
    return list.map(function (id) {
      total += seedWeight(id);
      return total;
    });
  }

  function pick(list, sums) {
    if (!list.length || !sums[sums.length - 1]) {
      return null;
    }
    var target = Math.random() * sums[sums.length - 1];
    var lo = 0, hi = sums.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sums[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return list[lo];
  }

  function seed() {
    return pick(ids, cum);
  }

  // Cut the node cloud's bounding box into a GRID x GRID lattice of squares and
  // file every node under one. An iteration seeds its extras out of the SEED's
  // OWN square, which is what keeps a burst local: the graph is a hairball, so
  // three unrelated seeds anywhere in it read as three unrelated sparks, while
  // three seeds inside one square read as a region waking up.
  //
  // Squares are POSITIONAL, not structural — they cut across communities on
  // purpose. Spatial neighbours that share no edge still belong to the same part
  // of the picture, and that is what the eye is following.
  function partition() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var p = pos[id];
      if (p.x < minX) { minX = p.x; }
      if (p.x > maxX) { maxX = p.x; }
      if (p.y < minY) { minY = p.y; }
      if (p.y > maxY) { maxY = p.y; }
    });
    var w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    cells = [];
    for (var i = 0; i < GRID * GRID; i++) {
      cells.push({ ids: [], cum: [] });
    }
    ids.forEach(function (id) {
      var col = Math.min(GRID - 1, Math.floor((pos[id].x - minX) / w * GRID));
      var row = Math.min(GRID - 1, Math.floor((pos[id].y - minY) / h * GRID));
      var n = row * GRID + col;
      cellOf[id] = n;
      cells[n].ids.push(id);
    });
    cells.forEach(function (c) { c.cum = weigh(c.ids); });
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
    return P_MIN + (P_MAX - P_MIN) * Math.max(0, Math.min(1, t));
  }

  function fire(id, now) {
    var d = Math.min(deg[id] || 1, DUR_DEG_CAP);
    var base = DUR_MIN + DUR_PER_DEG * d;
    lit[id] = { t0: now, dur: base * (1 - DUR_JITTER + Math.random() * 2 * DUR_JITTER) };
  }

  function fireEdge(a, b, now) {
    litEdges[a + '\u0000' + b] = { t0: now, dur: EDGE_DUR, a: a, b: b };
  }

  // 1 at the top of the attack, 0 when spent.
  function level(l, now) {
    var t = now - l.t0;
    if (t < 0 || t >= l.dur) {
      return 0;
    }
    if (t < ATTACK_MS) {
      return t / ATTACK_MS;
    }
    return Math.pow(1 - (t - ATTACK_MS) / (l.dur - ATTACK_MS), DECAY_POW);
  }

  function hopAt(now) {
    return now + HOP_MS * (1 - HOP_JITTER + Math.random() * 2 * HOP_JITTER);
  }

  // One iteration: a seed, then a frontier that walks outward. `seen` is
  // per-iteration, so a node is TRIED once per cascade however many neighbours
  // reach it — which is what stops a dense region from re-rolling itself forever.
  // `pick` is a weighted draw; `at` is a node someone chose. They are the same
  // iteration either way — a tapped node gets the burst, the stagger and the
  // outward walk a randomly seeded one gets, because the interesting thing about
  // a node is what it is connected to, and that is what the cascade draws.
  function startIteration(now, at) {
    var tapped = at !== undefined && at !== null;
    var id = tapped ? at : seed();
    if (id === null || !pos[id]) {
      return;
    }
    // The life has to cover the stagger as well, or the last seeds would be
    // dropped before they ever fired.
    var it = {
      queue: [], seen: {},
      until: now + ITER_LIFE + SEEDS_PER_ITER * SEED_STAGGER_MS,
    };
    // A tap guarantees its first hop, and seeds none of the extra draws below.
    // Why both: ARCHITECTURE §11.
    ignite(it, id, now, tapped);
    var cell = tapped ? null : cells[cellOf[id]];
    var seeded = 1, tries = SEEDS_PER_ITER * SEED_TRIES;
    while (cell && seeded < SEEDS_PER_ITER && tries-- > 0) {
      var extra = pick(cell.ids, cell.cum);
      if (extra !== null && !it.seen[extra]) {
        // Claim it NOW so the remaining draws cannot pick it again, but light it
        // later. `seed` marks it as not needing a roll when its turn comes: it
        // was chosen, not caught, so it lights unconditionally and lights no
        // edge — there is no edge it arrived along.
        it.seen[extra] = 1;
        it.queue.push({
          id: extra, from: null, seed: true,
          at: now + seeded * SEED_STAGGER_MS,
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
    fire(id, now);
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
        fire(q.id, now);
        spread(it, q.id, now);
      } else if (q.force || Math.random() < catchOdds(q.id)) {
        fire(q.id, now);
        fireEdge(q.from, q.id, now);
        spread(it, q.id, now);
      }
    }
    it.queue = keep;
  }

  function step(now) {
    // Seeding is on a clock and nothing else — never gated on whether anything
    // is still lit, which is what keeps one cascade always in flight.
    if (now >= nextIter) {
      startIteration(now);
      nextIter = now + ITER_MS;
    }
    for (var i = 0; i < live.length; i++) {
      advance(live[i], now);
    }
    live = live.filter(function (it) {
      return it.queue.length && now < it.until;
    });
    expire(lit, now);
    expire(litEdges, now);
  }

  function expire(map, now) {
    for (var k in map) {
      if (now - map[k].t0 >= map[k].dur) {
        delete map[k];
      }
    }
  }

  function levelsNow(now) {
    var out = {};
    for (var id in lit) {
      var a = level(lit[id], now);
      if (a > 0.01) {
        out[id] = a;
      }
    }
    return out;
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
    last = now;
    step(now);
    var busy = live.length || hasAny(lit) || hasAny(litEdges);
    if (busy) {
      graphPulseDraw.paint(now, levelsNow(now));
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

  function hasAny(map) {
    for (var k in map) {
      return true;
    }
    return false;
  }


  return {
    // One cascade, seeded exactly where it was asked for. No-op until init has
    // indexed the graph, and on a node the index does not hold.
    seed: function (id) {
      if (running) {
        startIteration(performance.now(), id);
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
      // as FROZEN, which a still graph reads as. ARCHITECTURE §11 has the whole
      // history; the short version is that the cost was never here.
      onPainted = onReady || null;
      index(function () {
        graphPulseDraw.init(pos, litEdges, level);
        running = true;
        requestAnimationFrame(frame);
      });
    },
  };
})();
