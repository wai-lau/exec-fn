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
/* global network, graphInk, graphAudio, graphGlyph, graphRing, graphGlow */
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

  // THE LIT EDGE WEIGHT BREATHES, and it is the only thing on this canvas that
  // does. Every number here was a literal once, so a peak and a whisper drew
  // identically weighted marks and the ONLY thing the music changed was how many
  // of them there were -- one channel, and the one that saturates at SEEDS_MAX
  // long before music stops getting louder.
  //
  // It follows `loudness`, the envelope follower, ~1.5s to fall. That is
  // per-PASSAGE: the web thickens through a chorus and thins through a breakdown,
  // a slow structural change rather than a flicker.
  //
  // THE NODE HALO USED TO PULSE TOO and deliberately no longer does. It followed
  // `bloom` (amp x (1 - sharpness), peak-held ~80ms), so the whole picture swelled
  // on every low hit. That per-KICK pulse now drives the WAVEFRONT instead
  // (graph-ring.js, BLOOM_GROW): one triangle thrown off a hub carries the kick
  // outward, where a halo swelling on every lit node made the entire graph throb
  // in place and said nothing about where anything happened. The halo is back to a
  // fixed radius and the kick is a thing that travels.
  var EDGE_SWELL = 0.6;           // lit edge width: up to 1.6x through a loud part

  // The STROKE is deliberately not in that list either. The outline is what a lit
  // node IS -- it carries the shape, which carries the node's type -- and a weight
  // that moved with the music would blur the one mark on this canvas that has to
  // stay readable.

  // Recomputed once per frame at the top of paint(), never per node: a property of
  // the MOMENT, not of any particular node, and reading the audio once per lit node
  // would be the same number fetched a hundred times.
  var edgeW = EDGE_W;

  // ONLY THE BIG NODES OCCLUDE, and WHICH ONES IS THE SERVER'S ANSWER — shipped as
  // `window.GRAPH_OCCLUDE_MIN`, a percentile of the real size distribution
  // that graph_style computed while clearing the fill on the UNLIT layer. This file
  // skips the same nodes on the LIT layer, and graph-ring.js throws waves off the
  // same set: one number, three layers, because a node that occludes in one and not
  // another reads as a rendering bug rather than as a rule.
  //
  // It is a WORLD size (`pos[id].r` is graphify's own `size`, 12..88), never a drawn
  // pixel radius — whether a node occludes is a property of the node, not of the
  // current zoom.
  var OCCLUDE_FALLBACK = 20;
  var occludeMin = OCCLUDE_FALLBACK;

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
    graphRing.bind(ctx, INK);
    graphGlow.bind(ctx, INK);
    // Resolved once, here, rather than at evaluation time: the head injection has
    // certainly run by the time the model builds the canvas.
    var v = window.GRAPH_OCCLUDE_MIN;
    occludeMin = typeof v === 'number' && v > 0 ? v : OCCLUDE_FALLBACK;
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
  // `p.t` is the node's rotation and every glyph pass hands it on — see graph-glyph.js.

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
    ctx.arc(x, gy, r * HALO_OUTER, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * A.halo2;
    ctx.beginPath();
    ctx.arc(x, gy, r * HALO_INNER, 0, Math.PI * 2);
    ctx.fill();
  }

  function nodeStroke(p, a, scale, view, A) {
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    var r = Math.max(p.r * scale, 1.2);
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;
    }
    graphGlyph.path(x, y, r, p.s, p.t);
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
    var x = (p.x - view.x) * scale + cw / 2;
    var y = (p.y - view.y) * scale + ch / 2;
    if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) {
      return;
    }
    var gr = Math.max(p.r * scale, 1.2);
    graphGlyph.path(x, y, gr, p.s, p.t);
    ctx.fill();
    // AND AGAIN UNROTATED, whenever this node has been turned. vis drew the node
    // on ITS canvas, a layer down, at the original angle — we cannot reach those
    // pixels, so a rotated overlay glyph left the unrotated one showing through
    // beside it as a GHOST TRIANGLE. Covering both orientations hides it.
    //
    // It costs nothing visually: the fill is the page background over the page
    // background, so the extra area is invisible against it. What it does cost is a
    // slightly wider occlusion footprint at a rotated node, which is the union of
    // the two orientations rather than one of them.
    if (p.t) {
      graphGlyph.path(x, y, gr, p.s, 0);
      ctx.fill();
    }
  }

  function eachDrawn(scale, view, bigOnly) {
    var id;
    for (id in chargeN) {
      if (pos[id] && !(bigOnly && pos[id].r <= occludeMin)) {
        fillGlyph(pos[id], scale, view);
      }
    }
    for (id in lit) {
      if (pos[id] && !(bigOnly && pos[id].r <= occludeMin)) {
        fillGlyph(pos[id], scale, view);
      }
    }
  }

  // THE INTERIOR OF EVERY NODE IS CLEARED OF THIS CANVAS'S OWN GLOW, and it is
  // done with `destination-out` rather than by filling with the background colour.
  // That distinction is the whole of why this is a separate pass from the punch
  // below.
  //
  // An OPAQUE bg fill hides everything underneath it — including vis's canvas,
  // which is a layer down and carries the UNLIT graph. Using one here would mask
  // the unlit edges behind every lit node, undoing `_unocclude_small_nodes` for
  // exactly the nodes a cascade is touching. `destination-out` instead ERASES the
  // overlay's own accumulated pixels inside the glyph, so the halo and the
  // wavefront stop at a node's edge while vis's own node and edges show through it
  // untouched.
  function clearNodes(scale, view) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    eachDrawn(scale, view, false);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
  }

  // And a BIG node goes OPAQUE, which is what hides the edges behind it — ours and
  // vis's both. Only the big ones, on the shipped percentile.
  function punchNodes(scale, view) {
    if (!BG) {
      return;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    eachDrawn(scale, view, true);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
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
    // REJECTS `transparent`, not merely empty: four fifths of the nodes carry that
    // exact string (graph_geometry._unocclude_small_nodes) and it is TRUTHY, so a
    // falsy-only guard sets a background that paints nothing and turns the
    // occlusion pass into a silent no-op. Incident: ARCHAEOLOGY.md §11.
    setBg: function (c) { BG = (c && c !== 'transparent') ? c : BG; },
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
      // THE SPILLING EFFECTS GO FIRST -- the wavefront and the halos -- because a
      // node's interior is cleared of them before anything else is drawn. Under
      // 'lighter' every additive layer COMMUTES, so moving these above the edges
      // costs nothing visually and buys the ordering the two opaque passes need.
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      var id;
      for (id in levels) {
        if (pos[id]) {
          nodeHalos(pos[id], levels[id], scale, view, A_WHITE);
        }
      }
      satNodes(now, scale, view, nodeHalos);

      // EVERY node's interior is now cleared of this canvas's glow, so a halo and
      // a 50x wavefront both stop at a node's edge instead of washing over it.
      // Erased, not painted: vis's own unlit graph is a layer down and must still
      // show through a small node.
      clearNodes(scale, view);

      // THEN the edges, so they cross a node that does not occlude them.
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      graphGlow.drawEdges(scale, view, cw, ch, edgeW, A_SAT.edge);
      drawEdges(now, scale, view, A_WHITE, level, true);
      drawEdges(now, scale, view, A_SAT, satLevel, true);

      // And the BIG nodes go opaque over the top of them, which is the occlusion
      // rule: an edge arrives AT a hub rather than crossing it.
      punchNodes(scale, view);

      // Outlines last, on top of the black. This is what a lit node actually IS.
      graphGlow.drawOutlines(scale, view, cw, ch);
      ctx.strokeStyle = INK;
      for (id in levels) {
        if (pos[id]) {
          nodeStroke(pos[id], levels[id], scale, view, A_WHITE);
        }
      }
      satNodes(now, scale, view, nodeStroke);

      // THE WAVEFRONT GOES LAST, and it is the one pass that is not additive. It
      // draws `source-atop`, so it paints ONLY where this canvas already has
      // pixels — the nodes and their glow — and not across the empty space
      // between them. Under 'lighter' it was a bright line sweeping the void,
      // which is the thing it should not be.
      //
      // `multiply` was the other candidate and does not do this on its own: a
      // blend mode still composites onto a transparent destination, so the stroke
      // would keep showing over the gaps. Restricting WHERE a thing paints is
      // `source-atop`'s job, not a blend function's.
      //
      // The cost is honest and worth naming: this canvas only holds the nodes it
      // has drawn, which is the lit and charged ones. A front passing over a node
      // that is neither shows nothing there, because vis's copy of that node is a
      // layer down and unreachable for compositing.
      graphRing.draw(now, scale, view, cw, ch);

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
