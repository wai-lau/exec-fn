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
/* global graphAudio */
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

  return {
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
