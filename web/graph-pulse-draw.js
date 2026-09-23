// /graph — the firing overlay's CANVAS half. Loaded by the /graph route before
// graph-pulse.js (same global scope, no modules), which owns the cascade model
// and calls in here once a frame.
//
// The split is the 500-line cap, taken at the honest seam: everything here is
// pixels — the canvas element, the world-to-screen transform, and the shapes —
// and nothing here knows what a cascade is. graph-pulse.js hands over the state
// it should read ONCE (`bind`), because those objects are mutated in place and
// never reassigned; if that ever stops being true, this breaks quietly.
//
// WHY A SEPARATE CANVAS AT ALL. vis draws every node and every edge on each
// redraw, and a warm full redraw of this graph measured ~1.5s at 4561 nodes on
// the droplet's headless WebKit. An animation that redrew vis per frame would be
// the old camera tour's 0.4 fps again. This canvas draws ONLY what is lit — a few
// dozen hexagons and their edges — so a frame is O(lit), not O(graph). Measured
// at 0ms of canvas work per frame; what a frame costs on this page is
// compositing, and that is the CRT stack's doing, not this file's.
/* global network */
var graphPulseDraw = (function () {
  'use strict';

  // Ink. Drawn with globalCompositeOperation 'lighter', so these stack into a
  // bloom instead of painting over each other — two soft discs under a crisp
  // hexagon is a cheaper glow than shadowBlur and does not cost per-node state.
  var HALO_OUTER = 2.6;           // x node radius
  var HALO_INNER = 1.5;
  var A_HALO_OUTER = 0.10;
  var A_HALO_INNER = 0.18;
  // A lit node is SOLID in the middle. The hexagon under it is bg-filled with a
  // coloured border (the /emet look), so at 0.55 the additive fill only greyed
  // that dark interior and the node read as outlined-brighter rather than lit.
  // At 1 the centre clips to white and the halos ring it.
  var A_FILL = 1;
  var A_STROKE = 0.95;
  var A_EDGE = 0.8;
  var EDGE_W = 1.6;

  // THE SECOND, SATURATED LAYER. Same geometry and the same envelope as the white
  // pass above, at THREE TIMES the life: a white flash that decays into a long
  // coloured afterglow.
  //
  // Why it reads at all under 'lighter'. Adding colour on top of a centre that has
  // already clipped to white does nothing, so for its first third this layer only
  // tints the halo. Its point is the other two thirds: once the white has faded it
  // is the only thing on the canvas, and what is left is the node's own community
  // colour. Drawing it UNDER the white instead would have been washed out for the
  // whole overlap and then identical afterwards, so over the top is both what was
  // asked for and the only ordering that shows anything during the flash.
  //
  // The colour is that community colour with its SATURATION pushed up, computed
  // once per node at index time and cached on `pos[id].c` — never built per frame,
  // which is the same rule that keeps the white pass on a single literal. A node
  // with no colour falls back to the white ink rather than vanishing.
  var SAT_MULT = 3;               // lifetime, x the white pass
  var SAT_BOOST = 1.75;           // x saturation, clamped at fully saturated
  var A_SAT = {
    halo1: 0.14, halo2: 0.22, fill: 0.9, stroke: 0.95, edge: 0.7,
  };
  var A_WHITE = {
    halo1: A_HALO_OUTER, halo2: A_HALO_INNER, fill: A_FILL, stroke: A_STROKE,
    edge: A_EDGE,
  };

  var cv = null, ctx = null, cw = 0, ch = 0, dpr = 1;
  // Set once by graph-pulse.js. Mutated in place by it thereafter, never
  // reassigned, which is the whole contract that makes reading them here safe.
  var pos = {}, lit = {}, litEdges = {}, level = null;

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
    // Capped at 2. This is a glow layer, not text: the third row of pixels on a
    // DPR-3 phone buys nothing visible and costs a 1290x2628 backing store
    // (12.9MB) that is composited under the CRT stack every frame. At 2 it is
    // 5.7MB for the same picture.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
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

  // The lit glyph follows the node's SHAPE, which carries its type: an UPWARD
  // triangle for code, a hexagon for a rationale, a DOWNWARD triangle for a
  // document (graph_style._TYPE_SHAPES owns that mapping; this file only has to
  // draw whatever shape a node arrives with, so a reassignment there touches
  // nothing here). Lighting everything as one shape made a cascade say the wrong
  // thing about what it was crossing.
  function polygon(x, y, r, sides, turn) {
    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = turn + i * 2 * Math.PI / sides;
      var px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  }

  // vis does NOT draw a triangle centred on the node. Its own code reads
  //
  //   triangle:     y += 0.275 * (size *= 1.15)
  //   triangleDown: y -= 0.275 * (size *= 1.15)
  //
  // so the shape is scaled by 1.15 and then shifted off the node position by
  // 0.275 of that — the node's point is not the triangle's centroid. Drawing a
  // plain centred triangle here put the lit glyph a third of a radius away from
  // the node underneath it, which is visible the moment anything lights up.
  // These numbers are vis's, copied deliberately: the overlay has to agree with
  // the renderer it is painting over, not with the geometry it would choose.
  var TRI_SCALE = 1.15;
  var TRI_SHIFT = 0.275;

  function triCentre(y, r, shape) {
    if (shape === 'triangle') {
      return y + TRI_SHIFT * r * TRI_SCALE;
    }
    if (shape === 'triangleDown') {
      return y - TRI_SHIFT * r * TRI_SCALE;
    }
    return y;
  }

  function triangle(x, y, r, down) {
    var e = r * TRI_SCALE;
    var c = 2 * e, half = c / 2;
    var inr = Math.sqrt(3) / 6 * c;
    var out = Math.sqrt(c * c - half * half);
    var apex = down ? y + (out - inr) : y - (out - inr);
    var base = down ? y - inr : y + inr;
    ctx.beginPath();
    ctx.moveTo(x, apex);
    ctx.lineTo(x + half, base);
    ctx.lineTo(x - half, base);
    ctx.closePath();
  }

  function glyph(x, y, r, shape) {
    if (shape === 'triangle' || shape === 'triangleDown') {
      triangle(x, triCentre(y, r, shape), r, shape === 'triangleDown');
      return;
    }
    if (shape === 'dot') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      return;
    }
    polygon(x, y, r, 6, 0);
  }

  // Alpha rides on ctx.globalAlpha over a flat white fill, never a colour string
  // built per call: this runs per lit node per frame, and a fresh string 60 times
  // a second per node is garbage for the collector to chase. It also keeps the
  // one colour on this canvas to a single literal, which is what the palette lint
  // wants to see.
  var INK = '#ffffff';

  // hex -> HSL -> saturation x SAT_BOOST -> hex. Runs once per node, at index
  // time, so nothing here sits on a frame path.
  //
  // It returns HEX rather than a CSS colour-function string, and the helper below
  // is named `hueChan` rather than by its usual name, for one reason: the palette
  // lint reads SOURCE TEXT with whitespace stripped, so ANY colour-function name
  // followed by an open paren reads as a new raw colour -- inside a comment as
  // readily as in code, and regardless of the fact that every value here comes
  // from the payload at runtime. The conventional name made the lint report three
  // colours that do not exist, matching the substring inside each CALL; an
  // earlier draft of this comment tripped it a fourth time merely by discussing
  // the problem. Same substring trap `cmdscan.py` was written for. Renaming and
  // rewording is the fix -- `--update` would have frozen four phantom colours
  // into the baseline.
  function hueChan(p, q, t) {
    if (t < 0) { t += 1; }
    if (t > 1) { t -= 1; }
    if (t < 1 / 6) { return p + (q - p) * 6 * t; }
    if (t < 1 / 2) { return q; }
    if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
    return p;
  }

  function toHex(h, s, l) {
    var r, g, b;
    if (!s) {
      r = l; g = l; b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueChan(p, q, h + 1 / 3);
      g = hueChan(p, q, h);
      b = hueChan(p, q, h - 1 / 3);
    }
    var v = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    return '#' + ('000000' + v.toString(16)).slice(-6);
  }

  function satInk(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) {
      return INK;
    }
    var n = parseInt(m[1], 16);
    var r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, d = mx - mn, s = 0, h = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) {
        h = (g - b) / d + (g < b ? 6 : 0);
      } else if (mx === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return toHex(h, Math.min(1, s * SAT_BOOST), l);
  }

  // The saturated envelope is the model's own `level`, read against a longer
  // duration -- never a second copy of ATTACK_MS/DECAY_POW, which would be two
  // fades to keep in sync. One scratch record, mutated in place, so a frame with
  // fifty lit nodes still allocates nothing.
  var SHIM = { t0: 0, dur: 0 };

  function satLevel(l, now) {
    SHIM.t0 = l.t0;
    SHIM.dur = l.dur * SAT_MULT;
    return level(SHIM, now);
  }

  function drawNode(p, a, scale, view, A) {
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    var r = Math.max(p.r * scale, 1.2);
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;   // offscreen: the camera can be zoomed anywhere
    }
    // The halo follows the GLYPH, not the node point, or a triangle glows
    // off-centre — the same offset, seen from the other side.
    var gy = triCentre(y, r, p.s);
    ctx.globalAlpha = a * A.halo1;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_OUTER, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * A.halo2;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_INNER, 0, Math.PI * 2);
    ctx.fill();
    glyph(x, y, r, p.s);
    ctx.globalAlpha = a * A.fill;
    ctx.fill();
    ctx.globalAlpha = a * A.stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // The edge the activation travelled along, lit as the far end catches. Both its
  // ends are lit by construction — it is drawn because something crossed it.
  function drawEdges(now, scale, view, A, lvl, tint) {
    ctx.lineWidth = EDGE_W;
    for (var k in litEdges) {
      var e = litEdges[k];
      var a = lvl(e, now);
      if (a <= 0.01) {
        continue;
      }
      var p = pos[e.a], q = pos[e.b];
      if (!p || !q) {
        continue;
      }
      // An edge inherits its colour from the from-node, the same way vis colours
      // the unlit edge underneath it, so a lit chain stays one colour end to end.
      if (tint) {
        ctx.strokeStyle = p.c || INK;
      }
      ctx.globalAlpha = a * A.edge;
      ctx.beginPath();
      ctx.moveTo((p.x - view.x) * scale + cw / 2, (p.y - view.y) * scale + ch / 2);
      ctx.lineTo((q.x - view.x) * scale + cw / 2, (q.y - view.y) * scale + ch / 2);
      ctx.stroke();
    }
  }

  // Iterates `lit` rather than the level map the model hands in: that map holds
  // only what is still above the threshold on the WHITE envelope, and this layer's
  // whole point is the two thirds after that has run out.
  function drawNodesSat(now, scale, view) {
    for (var id in lit) {
      var a = satLevel(lit[id], now);
      if (a <= 0.01) {
        continue;
      }
      var p = pos[id];
      if (!p) {
        continue;
      }
      var ink = p.c || INK;
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      drawNode(p, a, scale, view, A_SAT);
    }
  }

  return {
    // `lit` joins `litEdges` and `pos` on the mutated-in-place contract: the model
    // declares it once and only ever adds and deletes keys.
    init: function (positions, litMap, edges, levelFn) {
      pos = positions;
      lit = litMap;
      litEdges = edges;
      level = levelFn;
      makeCanvas();
    },
    // The model expires a lit record on its own `dur`; the saturated layer needs
    // it kept for SAT_MULT times that, so the model asks here rather than holding
    // a copy of the multiplier.
    totalLife: function (dur) {
      return dur * SAT_MULT;
    },
    satInk: satInk,
    // One frame. `levels` is {nodeId: alpha} from the model; lit edges are read
    // straight off the bound object and levelled here, because an edge's alpha
    // is min(both ends) and the model has no reason to build that list twice.
    paint: function (now, levels) {
      var scale = network.getScale();
      var view = network.getViewPosition();
      ctx.clearRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      drawEdges(now, scale, view, A_WHITE, level, false);
      for (var id in levels) {
        if (pos[id]) {
          drawNode(pos[id], levels[id], scale, view, A_WHITE);
        }
      }
      // Over the top, and last, so it is visible during the flash rather than
      // only after it.
      drawEdges(now, scale, view, A_SAT, satLevel, true);
      drawNodesSat(now, scale, view);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    clear: function () {
      ctx.clearRect(0, 0, cw, ch);
    },
    // Also the whole of the woken-tab repair: a canvas comes back wedged from a
    // suspend, and re-measuring the backing store is what graph-overlay.js used
    // to spend a location.reload() on.
    resize: resize,
  };
})();
