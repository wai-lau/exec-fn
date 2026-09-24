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
/* global network, graphInk, graphAudio, graphGlyph */
var graphPulseDraw = (function () {
  'use strict';

  // Ink. Drawn with globalCompositeOperation 'lighter', so these stack into a
  // bloom instead of painting over each other — two soft discs under a crisp
  // hexagon is a cheaper glow than shadowBlur and does not cost per-node state.
  var HALO_OUTER = 2.6;           // x node radius
  var HALO_INNER = 1.5;
  var A_HALO_OUTER = 0.10;
  var A_HALO_INNER = 0.18;
  var A_STROKE = 0.95;
  var A_EDGE = 0.8;
  var EDGE_W = 1.6;

  // TWO OF THESE BREATHE WITH THE SOUND, and until now none of them did. Every
  // number on this canvas was a literal, so a peak and a whisper drew identically
  // sized, identically weighted marks and the ONLY thing the music changed was how
  // many of them there were. Count is one channel and it saturates at SEEDS_MAX
  // long before music stops getting louder.
  //
  // They are driven on DELIBERATELY DIFFERENT TIMESCALES, which is the whole point
  // of having two:
  //
  //   the HALO follows `bloom` -- amp x (1 - sharpness), peak-held ~80ms. That is
  //   per-KICK: the picture swells on a low hit and does not on a hat, because the
  //   low end is the part you feel and a bloom is the visual answer to it.
  //
  //   the EDGE WEIGHT follows `loudness` -- the envelope follower, ~1.5s to fall.
  //   That is per-PASSAGE: the web thickens through a chorus and thins through a
  //   breakdown, a slow structural change rather than a flicker.
  //
  // A single term driving both would make them say the same thing twice, and the
  // fast one would win.
  var HALO_SWELL = 0.55;          // halo radius: up to 1.55x on a full low hit
  var EDGE_SWELL = 0.6;           // lit edge width: up to 1.6x through a loud part

  // The STROKE is deliberately NOT in that list. The outline is what a lit node IS
  // -- it carries the shape, which carries the node's type -- and a weight that
  // moved with the music would blur the one mark on this canvas that has to stay
  // readable. The halo around it is the part that is allowed to breathe.

  // Recomputed once per frame at the top of paint(), never per node: they are
  // properties of the MOMENT, not of any particular node, and reading the audio
  // once per lit node would be the same number fetched a hundred times.
  var haloK = 1, edgeW = EDGE_W;

  // ONLY THE BIG NODES OCCLUDE. MIRRORS graph_style._OCCLUDE_MIN (_SIZE_MAX / 2)
  // and the two must move together: that file clears the opaque interior on the
  // UNLIT layer and this one skips the same nodes on the LIT layer, so a node that
  // occludes in one and not the other reads as a rendering bug. It is a WORLD size
  // (`pos[id].r` is graphify's own `size`, 12..88), never a drawn pixel radius —
  // whether a node occludes is a property of the node, not of the current zoom.
  var OCCLUDE_MIN = 44;

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
  var A_SAT = {
    halo1: 0.14, halo2: 0.22, stroke: 0.95, edge: 0.7,
  };
  var A_WHITE = {
    halo1: A_HALO_OUTER, halo2: A_HALO_INNER, stroke: A_STROKE,
    edge: A_EDGE,
  };

  var cv = null, ctx = null, cw = 0, ch = 0, dpr = 1;
  // Set once by graph-pulse.js. Mutated in place by it thereafter, never
  // reassigned, which is the whole contract that makes reading them here safe.
  var pos = {}, lit = {}, litEdges = {}, level = null, satLevel = null;
  var chargeN = {}, chargeE = {};
  // The page background, read off a real node rather than written as a literal:
  // it is graphify's own `color.background` and this file has no business
  // holding a second copy of it.
  var BG = null;

  function makeCanvas() {
    cv = document.createElement('canvas');
    cv.id = 'gp-pulse';
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
    // One context for the life of the page, handed over once — the same handover
    // contract `init` uses for the state the model mutates in place.
    graphGlyph.bind(ctx);
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

  // THE SHAPES LIVE IN graph-glyph.js, which reproduces vis's own geometry --
  // including the offset that stops a triangle's glow sitting off the node it
  // belongs to. Split out at the 500-line cap, at the seam where a file that
  // knows about alpha, charge and paint order stops and one that only builds
  // paths begins. `graphGlyph.path` leaves a path current; `graphGlyph.centre`
  // answers where the glyph actually sits, for the passes that draw round things.

  // Alpha rides on ctx.globalAlpha over a flat white fill, never a colour string
  // built per call: this runs per lit node per frame, and a fresh string 60 times
  // a second per node is garbage for the collector to chase. It also keeps the
  // one colour on this canvas to a single literal, which is what the palette lint
  // wants to see.
  // Colour conversion lives in graph-ink.js.
  var INK = graphInk.WHITE;

  // A LIT NODE IS AN OUTLINE AND A HALO. Its interior stays BLACK -- the page
  // background, opaque -- however brightly it is lit.
  //
  // It used to fill: `A_FILL` was 1 so the centre clipped to white and the halos
  // ringed it. That reads as a blob at any real brightness, it buries the SHAPE
  // (which carries the node's type) under its own glow, and a filled node loses
  // the thing that made the unlit graph legible in the first place. So the fill is
  // gone and the interior is punched out instead.
  //
  // Which forces the pass ORDER, and it is the whole of why these are two
  // functions rather than one: halos first (they are additive and spill inside
  // the glyph), then the opaque black fill over every node at once, then the
  // outlines. A fill after the halos erases them; an outline before the fill gets
  // erased by it.
  function nodeHalos(p, a, scale, view, A) {
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    var r = Math.max(p.r * scale, 1.2);
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;   // offscreen: the camera can be zoomed anywhere
    }
    // The halo follows the GLYPH, not the node point, or a triangle glows
    // off-centre — the same offset, seen from the other side.
    var gy = graphGlyph.centre(y, r, p.s);
    ctx.globalAlpha = a * A.halo1;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_OUTER * haloK, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * A.halo2;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_INNER * haloK, 0, Math.PI * 2);
    ctx.fill();
  }

  function nodeStroke(p, a, scale, view, A) {
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    var r = Math.max(p.r * scale, 1.2);
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;
    }
    graphGlyph.path(x, y, r, p.s);
    ctx.globalAlpha = a * A.stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // The edge the activation travelled along, lit as the far end catches. Both its
  // ends are lit by construction — it is drawn because something crossed it.
  function drawEdges(now, scale, view, A, lvl, tint) {
    ctx.lineWidth = edgeW;
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

  // THE ACCUMULATED OPACITY, drawn UNDER both flash passes. This is graph-glow.js's
  // charge: how opaque a node has become over a track, draining on a rate set by
  // the audio level rather than on the cascade's couple of seconds.
  //
  // No halos here, deliberately. Late in a loud track this pass can cover a large
  // part of the graph, so it is the one that has to stay cheap — a glyph fill and
  // a stroke and nothing else, where a lit node pays for two soft discs as well.
  var A_CHARGE = { stroke: 0.85 };   // outline only: the interior stays black

  // A BIG node the overlay draws gets its glyph filled with the page background
  // FIRST, opaque, before any glow goes on top. That is what makes it occlude the
  // edges behind it: an edge should arrive AT a hub, not cross over it. vis does
  // the same for the unlit layer by drawing edges before nodes with an opaque
  // fill; this is that rule for the lit one.
  //
  // SMALL NODES ARE SKIPPED (`OCCLUDE_MIN`). They are 76% of this graph and sit at
  // the size floor, so all the fill bought them was a notch cut out of the one
  // edge running in — the structure between nodes read as broken rather than as
  // arriving somewhere.
  //
  // Which costs them the other thing this pass does, and the two cannot both be
  // had from one opaque fill: it is also what punches out the halo spilling inside
  // a lit glyph, so a small node's interior now carries its own faint glow instead
  // of staying black. Letting an edge through and blocking a halo are the same
  // pixel asked for opposite things. The big nodes -- the ones whose interior is
  // large enough on screen for a glow to read as a FILL -- keep it black.
  //
  // Double-filling a node that is both charged and lit costs nothing -- the same
  // opaque colour twice -- so there is no need to build the union first.
  function fillGlyph(p, scale, view) {
    if (p.r <= OCCLUDE_MIN) {
      return;                   // small: the edges behind it show through
    }
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;
    }
    graphGlyph.path(x, y, Math.max(p.r * scale, 1.2), p.s);
    ctx.fill();
  }

  function punchNodes(scale, view) {
    if (!BG) {
      return;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    var id;
    for (id in chargeN) {
      if (pos[id]) {
        fillGlyph(pos[id], scale, view);
      }
    }
    for (id in lit) {
      if (pos[id]) {
        fillGlyph(pos[id], scale, view);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
  }

  function chargeOutlines(scale, view) {
    for (var id in chargeN) {
      var a = chargeN[id];
      if (a <= 0.02) {
        continue;
      }
      var p = pos[id];
      if (!p) {
        continue;
      }
      var x = (p.x - view.x) * scale + cw / 2;
      var y = (p.y - view.y) * scale + ch / 2;
      if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
        continue;
      }
      var r = Math.max(p.r * scale, 1.2);
      var ink = p.c || INK;
      ctx.strokeStyle = ink;
      graphGlyph.path(x, y, r, p.s);
      ctx.globalAlpha = a * A_CHARGE.stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  // The charge map is keyed by the model's own "a\0b" edge key and carries only a
  // number, so the endpoints are read back out of the key rather than duplicated
  // into every entry.
  function drawChargeEdges(scale, view) {
    ctx.lineWidth = edgeW;
    for (var k in chargeE) {
      var a = chargeE[k];
      if (a <= 0.02) {
        continue;
      }
      var cut = k.indexOf('\u0000');
      var p = pos[k.slice(0, cut)], q = pos[k.slice(cut + 1)];
      if (!p || !q) {
        continue;
      }
      ctx.strokeStyle = p.c || INK;
      ctx.globalAlpha = a * A_SAT.edge;
      ctx.beginPath();
      ctx.moveTo((p.x - view.x) * scale + cw / 2, (p.y - view.y) * scale + ch / 2);
      ctx.lineTo((q.x - view.x) * scale + cw / 2, (q.y - view.y) * scale + ch / 2);
      ctx.stroke();
    }
  }

  // Iterates `lit` rather than the level map the model hands in: that map holds
  // only what is still above the threshold on the WHITE envelope, and this layer's
  // whole point is the two thirds after that has run out.
  // Called twice a frame, once for the halos and once for the outlines, because
  // the opaque black fill has to land between them.
  function satNodes(now, scale, view, fn) {
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
      fn(p, a, scale, view, A_SAT);
    }
  }

  return {
    // `lit` joins `litEdges` and `pos` on the mutated-in-place contract: the model
    // declares it once and only ever adds and deletes keys.
    init: function (positions, litMap, edges, levelFn, satLevelFn, cn, ce) {
      pos = positions;
      lit = litMap;
      litEdges = edges;
      // BOTH envelopes are the model's. They used to be one function here plus a
      // scratch record with a multiplied duration; one place deciding how long
      // anything glows is worth more than saving the argument.
      level = levelFn;
      satLevel = satLevelFn;
      // The charge maps, on the same mutated-in-place contract as everything else
      // handed over here: graph-glow.js declares them once and only ever adds and
      // deletes keys.
      chargeN = cn;
      chargeE = ce;
      makeCanvas();
    },
    satInk: graphInk.sat,
    setBg: function (c) { BG = c || BG; },
    // One frame. `levels` is {nodeId: alpha} from the model; lit edges are read
    // straight off the bound object and levelled here, because an edge's alpha
    // is min(both ends) and the model has no reason to build that list twice.
    paint: function (now, levels) {
      var scale = network.getScale();
      var view = network.getViewPosition();
      // Guarded like every other audio read on this page: the tree is edited live,
      // so a file can reach a browser a moment before its dependency's script tag
      // does, and an unguarded read inside the rAF takes the whole canvas down
      // rather than costing a feature. With nothing listening both collapse to the
      // literals they were.
      var au = typeof graphAudio !== 'undefined' && graphAudio.isOn() ? graphAudio : null;
      haloK = 1 + HALO_SWELL * (au ? au.bloom() : 0);
      edgeW = EDGE_W * (1 + EDGE_SWELL * (au ? au.loudness() : 0));
      ctx.clearRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      // ALL EDGES, THEN ALL NODES -- and inside the nodes, HALOS then a black
      // FILL then OUTLINES. Three orderings, each forced by the one before it.
      //
      // Edges before nodes: the passes used to interleave (charge-edges,
      // charge-nodes, white-edges, white-nodes, ...), so a later edge pass drew
      // straight over an earlier node pass and edges crossed the very glyphs they
      // were supposed to be arriving at.
      //
      // Edges are TINTED on every pass, never white: an edge belongs to a
      // community and its colour says which, so it may vary in saturation but
      // never in hue.
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      drawChargeEdges(scale, view);
      drawEdges(now, scale, view, A_WHITE, level, true);
      drawEdges(now, scale, view, A_SAT, satLevel, true);

      // Halos next, while the interiors are still open: they are additive discs
      // and they spill inside the glyph, which the black fill is about to cover.
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      var id;
      for (id in levels) {
        if (pos[id]) {
          nodeHalos(pos[id], levels[id], scale, view, A_WHITE);
        }
      }
      satNodes(now, scale, view, nodeHalos);

      // Every BIG node's interior goes BLACK, opaque, in one pass: it occludes
      // the edges behind it AND the halo that just spilled inside it. The small
      // ones are skipped, which is what lets an edge cross them.
      punchNodes(scale, view);

      // Outlines last, on top of the black. This is what a lit node actually IS.
      chargeOutlines(scale, view);
      ctx.strokeStyle = INK;
      for (id in levels) {
        if (pos[id]) {
          nodeStroke(pos[id], levels[id], scale, view, A_WHITE);
        }
      }
      satNodes(now, scale, view, nodeStroke);
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
