// /graph — the firing overlay. Loaded by the /graph route BEFORE graph-overlay.js
// (same global scope, no modules), which wires it to hover and taps.
//
// WHY THIS IS ITS OWN CANVAS. vis draws every node and every edge on each
// redraw, and a warm full redraw of this graph measured ~1.5s at 4561 nodes on
// the droplet's headless WebKit. An animation that redrew vis per frame would be
// the camera tour's 0.4 fps all over again, which is the exact thing the tour was
// rebuilt to stop doing. So the layout is frozen, vis's canvas is left alone, and
// a transparent canvas sits on top drawing ONLY what is currently lit — a few
// dozen nodes and their edges. Cost per frame is O(lit), not O(graph).
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
/* global network, nodesDS, edgesDS */
var graphPulse = (function () {
  'use strict';

  // ── the cascade model ──────────────────────────────────────────────────────
  // One iteration per ITER_MS, each given ITER_LIFE to finish, so a couple are
  // always in flight and the graph never goes fully dark between them.
  // MAX_LIVE bounds the cost: a hub bloom can be hundreds of nodes, and four
  // overlapping blooms is the most this canvas should ever be asked to draw.
  var ITER_MS = 1000;
  var ITER_LIFE = 2000;
  var MAX_LIVE = 4;
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

  // How long a node stays lit. Degree buys time, on the same argument as size:
  // the busy nodes are the ones worth looking at, so they hold the eye longer.
  var DUR_MIN = 1100;
  var DUR_PER_DEG = 130;
  var DUR_DEG_CAP = 12;
  var DUR_JITTER = 0.4;
  var EDGE_DUR = 1100;
  var ATTACK_MS = 90;             // rise; the rest of the life is the fade
  var DECAY_POW = 1.2;            // >1 = falls away faster than it lingers. Close
  // to linear on purpose: at 1.8 the light was gone before the eye had followed
  // the chain that lit it.

  // Ink. Drawn with globalCompositeOperation 'lighter', so these stack into a
  // bloom instead of painting over each other — two soft discs under a crisp
  // hexagon is a cheaper glow than shadowBlur and does not cost per-node state.
  var HALO_OUTER = 2.6;           // x node radius
  var HALO_INNER = 1.5;
  var A_HALO_OUTER = 0.10;
  var A_HALO_INNER = 0.18;
  var A_FILL = 0.55;
  var A_STROKE = 0.95;
  var A_EDGE = 0.8;
  var EDGE_W = 1.6;

  var cv = null, ctx = null, cw = 0, ch = 0, dpr = 1;
  var pos = {};                   // id -> {x, y, r, c} in world units, read once
  var deg = {};                   // id -> edge count
  var adj = {};                   // id -> [neighbour ids]
  var ids = [];                   // every node id, in cumulative-weight order
  var cum = [];                   // prefix sums of size, for the weighted seed
  var lit = {};                   // id -> {t0, dur}
  var litEdges = {};              // "a\u0000b" -> {t0, dur, a, b}
  var live = [];                  // iterations in flight: {queue, seen, until}
  var nextIter = 0, running = false;

  function index() {
    nodesDS.forEach(function (n) {
      pos[n.id] = { x: 0, y: 0, r: n.size || 10 };
      deg[n.id] = 0;
      adj[n.id] = [];
    });
    edgesDS.forEach(function (e) {
      if (!adj[e.from] || !adj[e.to]) {
        return;
      }
      deg[e.from] += 1;
      deg[e.to] += 1;
      adj[e.from].push(e.to);
      adj[e.to].push(e.from);
    });
    // The layout is frozen, so world positions are read ONCE here. Losing this
    // read is not a subtle failure: every node keeps x=0, y=0 and the whole
    // cascade draws on top of itself in the dead centre of the screen.
    var world = network.getPositions(Object.keys(pos));
    Object.keys(pos).forEach(function (id) {
      if (world[id]) {
        pos[id].x = world[id].x;
        pos[id].y = world[id].y;
      }
    });
    // Prefix sums over node size, so a seed can be drawn in proportion to size
    // with one binary search instead of a scan or a reject loop.
    var total = 0;
    ids = Object.keys(pos);
    cum = ids.map(function (id) {
      total += Math.pow(pos[id].r, SEED_POW);
      return total;
    });
  }

  function seed() {
    if (!ids.length) {
      return null;
    }
    var target = Math.random() * cum[cum.length - 1];
    var lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return ids[lo];
  }

  function makeCanvas() {
    cv = document.createElement('canvas');
    cv.id = 'gp-pulse';
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    var host = document.getElementById('graph');
    if (!host || !cv) {
      return;
    }
    var r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cw = r.width;
    ch = r.height;
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    cv.style.top = r.top + 'px';
    cv.style.left = r.left + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── firing ─────────────────────────────────────────────────────────────────

  // A node's chance of catching the activation, from its own size. Sizes are
  // geometric in degree, so this is a degree rule in the units it is drawn at.
  function catchOdds(id) {
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
  function startIteration(now) {
    var id = seed();
    if (id === null) {
      return;
    }
    var it = { queue: [], seen: {}, until: now + ITER_LIFE };
    it.seen[id] = 1;
    fire(id, now);
    spread(it, id, now);
    live.push(it);
    if (live.length > MAX_LIVE) {
      live.shift();
    }
  }

  function spread(it, from, now) {
    var ns = adj[from] || [];
    for (var i = 0; i < ns.length; i++) {
      if (!it.seen[ns[i]]) {
        it.seen[ns[i]] = 1;
        it.queue.push({ id: ns[i], from: from, at: hopAt(now) });
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
      if (Math.random() < catchOdds(q.id)) {
        fire(q.id, now);
        fireEdge(q.from, q.id, now);
        spread(it, q.id, now);
      }
    }
    it.queue = keep;
  }

  function step(now) {
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

  // ── drawing ────────────────────────────────────────────────────────────────

  function hexagon(x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = i * Math.PI / 3;
      var px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  }

  // Alpha rides on ctx.globalAlpha over a flat white fill, never a colour string
  // built per call: this runs per lit node per frame, and a fresh string 60 times
  // a second per node is garbage for the collector to chase. It also keeps the
  // one colour on this canvas to a single literal, which is what the palette lint
  // wants to see.
  var INK = '#ffffff';

  function drawNode(p, a, scale, view) {
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    var r = Math.max(p.r * scale, 1.2);
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;   // offscreen: the camera can be zoomed anywhere
    }
    ctx.globalAlpha = a * A_HALO_OUTER;
    ctx.beginPath();
    ctx.arc(x, y, r * HALO_OUTER, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * A_HALO_INNER;
    ctx.beginPath();
    ctx.arc(x, y, r * HALO_INNER, 0, Math.PI * 2);
    ctx.fill();
    hexagon(x, y, r);
    ctx.globalAlpha = a * A_FILL;
    ctx.fill();
    ctx.globalAlpha = a * A_STROKE;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // The edge the activation travelled along, lit as the far end catches. Both its
  // ends are lit by construction — it is drawn because something crossed it.
  function drawEdges(now, scale, view) {
    ctx.lineWidth = EDGE_W;
    for (var k in litEdges) {
      var e = litEdges[k];
      var a = level(e, now);
      if (a <= 0.01) {
        continue;
      }
      var p = pos[e.a], q = pos[e.b];
      if (!p || !q) {
        continue;
      }
      ctx.globalAlpha = a * A_EDGE;
      ctx.beginPath();
      ctx.moveTo((p.x - view.x) * scale + cw / 2, (p.y - view.y) * scale + ch / 2);
      ctx.lineTo((q.x - view.x) * scale + cw / 2, (q.y - view.y) * scale + ch / 2);
      ctx.stroke();
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

  function draw(now) {
    ctx.clearRect(0, 0, cw, ch);
    var levels = levelsNow(now);
    var scale = network.getScale();
    var view = network.getViewPosition();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    drawEdges(now, scale, view);
    for (var id in levels) {
      if (pos[id]) {
        drawNode(pos[id], levels[id], scale, view);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
      draw(now);
      idle = false;
    } else if (!idle) {
      ctx.clearRect(0, 0, cw, ch);   // one last frame to clear what was lit
      idle = true;
    }
    requestAnimationFrame(frame);
  }

  function hasAny(map) {
    for (var k in map) {
      return true;
    }
    return false;
  }

  return {
    init: function () {
      if (running || typeof network === 'undefined') {
        return;
      }
      index();
      makeCanvas();
      running = true;
      requestAnimationFrame(frame);
    },
    resize: resize,
  };
})();
