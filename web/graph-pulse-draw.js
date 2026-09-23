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

  var cv = null, ctx = null, cw = 0, ch = 0, dpr = 1;
  // Set once by graph-pulse.js. Mutated in place by it thereafter, never
  // reassigned, which is the whole contract that makes reading them here safe.
  var pos = {}, litEdges = {}, level = null;

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

  function drawNode(p, a, scale, view) {
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    var r = Math.max(p.r * scale, 1.2);
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;   // offscreen: the camera can be zoomed anywhere
    }
    // The halo follows the GLYPH, not the node point, or a triangle glows
    // off-centre — the same offset, seen from the other side.
    var gy = triCentre(y, r, p.s);
    ctx.globalAlpha = a * A_HALO_OUTER;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_OUTER, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * A_HALO_INNER;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_INNER, 0, Math.PI * 2);
    ctx.fill();
    glyph(x, y, r, p.s);
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

  return {
    init: function (positions, edges, levelFn) {
      pos = positions;
      litEdges = edges;
      level = levelFn;
      makeCanvas();
    },
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
      drawEdges(now, scale, view);
      for (var id in levels) {
        if (pos[id]) {
          drawNode(pos[id], levels[id], scale, view);
        }
      }
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
