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
// WHAT IT LOOKS LIKE. Brain activity: a region goes active, and inside it nodes
// fire stochastically rather than all at once, weighted by degree — a node with
// more edges fires more often and stays lit longer, so hubs read as the loud ones
// and leaves flicker. Every node fades out on its own curve instead of blinking
// off, and an edge only lights while BOTH its endpoints are lit, which is what
// makes the activity look like it is travelling rather than blinking in place.
/* global network, nodesDS, edgesDS */
var graphPulse = (function () {
  'use strict';

  // ── the firing model ───────────────────────────────────────────────────────
  // A region is active for REGION_MS, jittered by DWELL_JITTER, and then the
  // activity moves on. It is deliberately short: a stop that lingers is a
  // slideshow, and what is worth watching is modules picking themselves out of
  // the whole graph one after another.
  var REGION_MS = 800;
  var DWELL_JITTER = 0.4;         // dwell = REGION_MS * (1 +/- this)
  var REGION_MIN = 8;             // a region smaller than this is skipped: two
  // hexagons lighting up on the far edge reads as a rendering glitch, not a
  // module. It still lights in full when hovered, like any other.

  // Firing odds per node per second, before the degree weight. Tuned so a region
  // is busy without being solid: at ~2.2/s a 200-node region holds roughly a
  // third of itself lit at any moment.
  var FIRE_HZ = 2.2;
  var DEG_FULL = 10;              // degree at which weight saturates
  var DEG_FLOOR = 0.10;           // a degree-1 node still fires, rarely

  // How long a node stays lit. Degree buys time, on the same argument as size:
  // the busy nodes are the ones worth looking at, so they hold the eye longer.
  var DUR_MIN = 420;
  var DUR_PER_DEG = 55;
  var DUR_DEG_CAP = 12;
  var DUR_JITTER = 0.4;
  var ATTACK_MS = 90;             // rise; the rest of the life is the fade
  var DECAY_POW = 1.8;            // >1 = falls away fast then lingers, like a
  // phosphor trail rather than a linear ramp

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
  var TRAIL_REGIONS = 3;          // regions whose edges are still worth testing,
  // so a node still fading from the last region can keep its edge lit

  var cv = null, ctx = null, cw = 0, ch = 0, dpr = 1;
  var pos = {};                   // id -> {x, y, r} in world units, read once
  var deg = {};                   // id -> edge count
  var memb = {};                  // region id -> node ids
  var intra = {};                 // region id -> [[from, to], ...]
  var lit = {};                   // id -> {t0, dur}
  var regions = [];               // tourable region ids
  var recent = [];                // most recent first, capped at TRAIL_REGIONS
  var region = null, pinned = null, nextSwitch = 0, running = false;

  function index() {
    nodesDS.forEach(function (n) {
      pos[n.id] = { x: 0, y: 0, r: n.size || 10 };
      deg[n.id] = 0;
      var c = n._community;
      if (c !== undefined && c !== null) {
        (memb[c] = memb[c] || []).push(n.id);
        pos[n.id].c = c;
      }
    });
    edgesDS.forEach(function (e) {
      deg[e.from] = (deg[e.from] || 0) + 1;
      deg[e.to] = (deg[e.to] || 0) + 1;
      var a = pos[e.from], b = pos[e.to];
      if (a && b && a.c !== undefined && a.c === b.c) {
        (intra[a.c] = intra[a.c] || []).push([e.from, e.to]);
      }
    });
    var world = network.getPositions(Object.keys(pos));
    Object.keys(pos).forEach(function (id) {
      if (world[id]) {
        pos[id].x = world[id].x;
        pos[id].y = world[id].y;
      }
    });
    regions = Object.keys(memb)
      .filter(function (c) { return memb[c].length >= REGION_MIN; });
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

  function weight(id) {
    return DEG_FLOOR + (1 - DEG_FLOOR) * Math.min(1, (deg[id] || 1) / DEG_FULL);
  }

  function fire(id, now) {
    var d = Math.min(deg[id] || 1, DUR_DEG_CAP);
    var base = DUR_MIN + DUR_PER_DEG * d;
    lit[id] = { t0: now, dur: base * (1 - DUR_JITTER + Math.random() * 2 * DUR_JITTER) };
  }

  // 1 at the top of the attack, 0 when spent. Anything already fading keeps
  // fading after its region goes quiet — that continuity is most of why this
  // reads as activity travelling rather than a light switch.
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

  function nextRegion() {
    if (regions.length < 2) {
      return region;
    }
    var pick = region;
    while (pick === region) {
      pick = regions[Math.floor(Math.random() * regions.length)];
    }
    return pick;
  }

  function enterRegion(now) {
    region = nextRegion();
    recent.unshift(region);
    if (recent.length > TRAIL_REGIONS) {
      recent.pop();
    }
    nextSwitch = now + REGION_MS
      * (1 - DWELL_JITTER + Math.random() * 2 * DWELL_JITTER);
  }

  function step(now, dt) {
    if (pinned !== null) {
      return;   // a hover holds its whole community; nothing stochastic runs
    }
    if (now >= nextSwitch) {
      enterRegion(now);
    }
    var ids = memb[region] || [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!lit[id] && Math.random() < FIRE_HZ * weight(id) * dt) {
        fire(id, now);
      }
    }
    for (var k in lit) {
      if (now - lit[k].t0 >= lit[k].dur) {
        delete lit[k];
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

  // An edge lights only while BOTH ends are lit, at the dimmer end's level — so
  // it comes up as the second end fires and dies with the first to go.
  function drawEdges(levels, scale, view) {
    ctx.lineWidth = EDGE_W;
    var seen = {};
    for (var r = 0; r < recent.length; r++) {
      var list = intra[recent[r]] || [];
      for (var i = 0; i < list.length; i++) {
        var a = levels[list[i][0]], b = levels[list[i][1]];
        if (!a || !b) {
          continue;
        }
        var key = list[i][0] + '\u0000' + list[i][1];
        if (seen[key]) {
          continue;
        }
        seen[key] = 1;
        var p = pos[list[i][0]], q = pos[list[i][1]];
        ctx.globalAlpha = Math.min(a, b) * A_EDGE;
        ctx.beginPath();
        ctx.moveTo((p.x - view.x) * scale + cw / 2, (p.y - view.y) * scale + ch / 2);
        ctx.lineTo((q.x - view.x) * scale + cw / 2, (q.y - view.y) * scale + ch / 2);
        ctx.stroke();
      }
    }
  }

  function levelsNow(now) {
    var out = {};
    if (pinned !== null) {
      (memb[pinned] || []).forEach(function (id) { out[id] = 1; });
      return out;
    }
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
    drawEdges(levels, scale, view);
    for (var id in levels) {
      if (pos[id]) {
        drawNode(pos[id], levels[id], scale, view);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  var last = 0;

  function frame(now) {
    if (!running) {
      return;
    }
    var dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    step(now, dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  return {
    init: function () {
      if (running || typeof network === 'undefined') {
        return;
      }
      index();
      makeCanvas();
      running = true;
      enterRegion(performance.now());
      requestAnimationFrame(frame);
    },
    // Hover/tap: hold one whole community lit and steady. The question a hover
    // asks is "what is this module", and an answer that flickers is a worse
    // answer — so the stochastic firing stands down until it is released.
    pin: function (nodeId) {
      var c = pos[nodeId] ? pos[nodeId].c : undefined;
      pinned = c === undefined ? null : c;
      if (pinned !== null) {
        recent = [pinned];
        lit = {};
      }
    },
    unpin: function () {
      if (pinned === null) {
        return;
      }
      pinned = null;
      recent = [];
      nextSwitch = 0;   // next frame picks a fresh region
    },
    resize: resize,
  };
})();
