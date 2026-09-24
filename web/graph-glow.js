// /graph — THE ACCUMULATED OPACITY. Loaded before graph-pulse.js.
//
// Two different things glow on this page and they are deliberately not the same
// mechanism:
//
//   * the LIT EFFECT (graph-pulse.js) is the cascade — a fast flash and a
//     coloured afterglow on wall-clock timings, a couple of seconds, the thing
//     that reads as activity travelling;
//   * the CHARGE, here, is how OPAQUE a node has become. Every hit adds to it,
//     and it drains on a rate set by the audio level: barely at all while a track
//     is loud, and away to nothing in the two or three seconds of quiet between
//     songs. That is what makes a song BUILD the picture.
//
// Keeping them separate is the whole design. Charge on the cascade's timings
// would never accumulate; the cascade on the charge's would smear into a
// permanent wash and stop reading as movement at all.
//
// The rate is why this is a clock rather than a duration: one full drain takes
// FADE_LOUD seconds at peak level and FADE_SILENT at silence, so the same charge
// is an eternity across a chorus and gone in a gap. A fixed half-life cannot say
// that.
/* global graphAudio, graphGlyph */
var graphGlow = (function () {
  'use strict';

  var GAIN = 0.22;                // added per hit; ~5 hits to full
  var MIN = 0.01;                 // below this it is dropped, not drawn
  var FADE_LOUD = 110;            // seconds for a full drain at peak level
  var FADE_SILENT = 1.6;          // ...and at silence, so a gap clears the screen
  var FADE_AMBIENT = 2.0;         // with no audio at all: the old snappy feel
  var DT_CAP = 100;               // ms
  // Edges drain on the same loudness rate, scaled DOWN: dividing the fade time by
  // 0.45 makes the exponent larger, so an edge's charge is gone in 0.45x the time
  // a node's takes — roughly 2.2x FASTER. Same argument as the lit
  // edge being shorter than the lit node — an edge is a crossing that has already
  // happened, a node is a place that stays one — and if both accumulated equally
  // a long track would end as a solid web with the nodes lost inside it.
  var EDGE_FADE = 0.45;

  var nodes = {}, edges = {};
  // The canvas and the layout, handed over once. graph-pulse-draw.js still owns
  // the context, the camera and the paint ORDER — it calls the two passes below at
  // the two different points in that order where they belong, which is the thing
  // that genuinely has to be decided globally.
  //
  // THE PIXELS LIVE HERE for the same reason graph-ring.js's do: this is an effect
  // with its own register and two passes over it, and nothing in those passes is
  // shared with anything else on the canvas. graph-lit.js is the counter-example
  // that keeps the split honest — its flash feeds five passes, so it stays a model
  // a draw half reads.
  var ctx = null, ink = '#ffffff', pos = {};

  // THE ACCUMULATED OPACITY, drawn UNDER both flash passes. This is graph-glow.js's
  // charge: how opaque a node has become over a track, draining on a rate set by
  // the audio level rather than on the cascade's couple of seconds.
  //
  // No halos here, deliberately. Late in a loud track this pass can cover a large
  // part of the graph, so it is the one that has to stay cheap — a glyph fill and
  // a stroke and nothing else, where a lit node pays for two soft discs as well.
  var A_CHARGE = { stroke: 0.85 };   // outline only: the interior stays black


  // 0..1 from the audio, or null when nothing is listening. graphAudio smooths it
  // with an envelope follower, which matters here: instantaneous RMS is near zero
  // between two kicks, so an unsmoothed level would drain the charge in the gaps
  // INSIDE a bar and undo the accumulation entirely.
  function loudness() {
    if (typeof graphAudio === 'undefined' || !graphAudio.isOn()) {
      return null;
    }
    return graphAudio.loudness();
  }

  function fadeSecs() {
    var v = loudness();
    if (v === null) {
      return FADE_AMBIENT;
    }
    return FADE_SILENT + (FADE_LOUD - FADE_SILENT) * Math.min(1, Math.max(0, v));
  }

  function drain(map, k) {
    for (var id in map) {
      map[id] *= k;
      if (map[id] < MIN) {
        delete map[id];
      }
    }
  }

  function outlines(scale, view, w, h) {
    for (var id in nodes) {
      var a = nodes[id];
      if (a <= 0.02) {
        continue;
      }
      var p = pos[id];
      if (!p) {
        continue;
      }
      var x = (p.x - view.x) * scale + w / 2;
      var y = (p.y - view.y) * scale + h / 2;
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) {
        continue;
      }
      var r = Math.max(p.r * scale, 1.2);
      ctx.strokeStyle = p.c || ink;
      graphGlyph.path(x, y, r, p.s);
      ctx.globalAlpha = a * A_CHARGE.stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  // The charge map is keyed by the model's own "a\0b" edge key and carries only a
  // number, so the endpoints are read back out of the key rather than duplicated
  // into every entry.
  function chargeEdges(scale, view, w, h, width, edgeAlpha) {
    ctx.lineWidth = width;
    for (var k in edges) {
      var a = edges[k];
      if (a <= 0.02) {
        continue;
      }
      var cut = k.indexOf('\u0000');
      var p = pos[k.slice(0, cut)], q = pos[k.slice(cut + 1)];
      if (!p || !q) {
        continue;
      }
      ctx.strokeStyle = p.c || ink;
      ctx.globalAlpha = a * edgeAlpha;
      ctx.beginPath();
      ctx.moveTo((p.x - view.x) * scale + w / 2, (p.y - view.y) * scale + h / 2);
      ctx.lineTo((q.x - view.x) * scale + w / 2, (q.y - view.y) * scale + h / 2);
      ctx.stroke();
    }
  }

  return {
    bind: function (context, fallbackInk) {
      ctx = context;
      ink = fallbackInk || ink;
    },

    index: function (positions) { pos = positions; },

    // The two passes, called by graph-pulse-draw.js at the two points in the paint
    // order where a charge belongs: the edges with the other edges, the outlines
    // with the other outlines. `width` and `edgeAlpha` arrive from there so the
    // charge cannot drift out of step with the flash it sits under.
    drawEdges: function (scale, view, w, h, width, edgeAlpha) {
      if (ctx) {
        chargeEdges(scale, view, w, h, width, edgeAlpha);
      }
    },

    drawOutlines: function (scale, view, w, h) {
      if (ctx) {
        outlines(scale, view, w, h);
      }
    },

    // Every hit tops a node up rather than resetting it: that is the difference
    // between accumulating and merely being re-lit.
    // `gain` is 0..1, how hard the hit that caused this was (graph-lit.js reads it
    // off graphAudio). Defaulted to 1 so the ambient animation, which knows
    // nothing about hits, charges exactly as it always did.
    bump: function (id, gain) {
      nodes[id] = Math.min(1, (nodes[id] || 0) + GAIN * (gain === undefined ? 1 : gain));
    },
    bumpEdge: function (key, gain) {
      edges[key] = Math.min(1, (edges[key] || 0) + GAIN * (gain === undefined ? 1 : gain));
    },
    // Exponential, so the drain is a RATE and has no edge to it. `dt` is capped
    // because a backgrounded tab returns with a huge one, and that gap was not
    // silence — it was nobody looking.
    step: function (dtMs) {
      var dt = Math.min(dtMs, DT_CAP) / 1000;
      var secs = fadeSecs();
      drain(nodes, Math.exp(-dt / secs));
      drain(edges, Math.exp(-dt / (secs * EDGE_FADE)));
    },
    // Read once by the draw half and mutated in place thereafter, the same
    // contract `pos` and `litEdges` already carry.
    nodes: function () { return nodes; },
    edges: function () { return edges; },
    reset: function () { nodes = {}; edges = {}; },
    // For a readout: how much of the graph is currently charged.
    charged: function () { return Object.keys(nodes).length; },
  };
})();
