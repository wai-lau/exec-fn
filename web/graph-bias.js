// /graph — HOW THE AUDIO BENDS THE CASCADE. Loaded before graph-pulse.js, which
// owns what a cascade is.
//
// The seam: graph-pulse.js knows about queues, hops and catch rolls and nothing
// about sound; this file turns a level and a pitch into the three numbers that
// lean on them. Split out when the pitch bias took graph-pulse.js past the
// 500-line cap, which is the cap working — a signal that a file has come to hold
// two subjects.
//
// Every read is GUARDED. This tree is edited live, so a file can reach a browser
// a moment before its dependency's script tag does, and an unguarded read inside
// the rAF takes the whole cascade down rather than costing a feature. With
// nothing listening every bias returns its neutral value, so the ambient
// animation behaves exactly as it did before any of this existed.
/* global graphAudio */
var graphBias = (function () {
  'use strict';

  // Both cut hard after the picture read as noise. REACH compounds — branching is
  // degree x p, so a small rise carries a chain much further than it looks — and
  // EXTENT was taking the seed pool to 320 nodes, which is not a burst but a
  // region the size of the argument. A cascade has to be able to DIE for the next
  // one to mean anything.
  var REACH_GAIN = 0.18;
  var EXTENT_GAIN = 0.8;

  // PITCH BIASES EDGE LENGTH. A low pitch is a long wavelength, so it travels:
  // the cascade prefers LONG edges and sweeps across the picture. A high pitch
  // stays close and the activation stays local. The mapping is symmetric, so the
  // opposite holds at the other end rather than one end being special.
  //
  // It MULTIPLIES the catch odds rather than replacing them: degree still decides
  // most of whether a node catches, and this leans on the result. At 0.6 a maximal
  // pairing (lowest pitch across the longest edge) is 1.6x as likely to carry and
  // the opposite pairing 0.4x — enough to feel, not enough to override the
  // structure of the graph.
  var LENGTH_BIAS = 0.6;

  var pos = {}, edgeRef = 0;

  function on() {
    return typeof graphAudio !== 'undefined' && graphAudio.isOn();
  }

  function loud() {
    return on() ? graphAudio.loudness() : 0;
  }

  // 0 low, 1 high, and 0.5 with nothing playing so silence biases nothing.
  function pitch() {
    return on() ? graphAudio.pitch() : 0.5;
  }

  return {
    // `meanEdge` is measured after the layout's positions are read, not with the
    // rest of the edge indexing: that runs before getPositions, when every node is
    // still at 0,0 and every edge would measure zero.
    index: function (positions, meanEdge) {
      pos = positions;
      edgeRef = meanEdge;
    },

    loud: loud,
    pitch: pitch,

    // Catch odds, leaned on by the level: loud cascades travel further.
    reach: function (p) {
      return Math.min(1, p * (1 + REACH_GAIN * loud()));
    },

    // Seed-pool size, leaned on by the level: loud reads as WIDER, not merely
    // denser.
    pool: function (base) {
      return Math.round(base * (1 + EXTENT_GAIN * loud()));
    },

    // Both terms are centred on 0, so their product is POSITIVE when they agree
    // (a low pitch crossing a long edge, or a high pitch staying short) and
    // negative when they do not. That is the whole mapping in one line.
    length: function (from, to) {
      var a = pos[from], b = pos[to];
      if (!a || !b || !edgeRef) {
        return 1;
      }
      var dx = a.x - b.x, dy = a.y - b.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      // Against TWICE the mean, so an average edge sits at 0.5 and only a
      // genuinely long one reaches 1.
      var longness = Math.min(1, len / (2 * edgeRef));
      var lowness = 1 - pitch();
      return 1 + LENGTH_BIAS * (2 * lowness - 1) * (2 * longness - 1);
    },
  };
})();
