// /graph — WHAT IS GLOWING, AND HOW BRIGHTLY. Loaded before graph-pulse.js,
// which owns what spreads where.
//
// The seam: this file holds the two lit registers and the envelopes over them. It
// knows nothing about queues, hops, seeds or tempo — it is handed a node id and a
// timestamp and it answers "how bright is this now". graph-pulse.js decides which
// ids and when.
//
// Split out of graph-pulse.js when the audio work took that file past the
// 500-line cap. The cap is a signal that a file has come to hold too much, and
// the answer is a seam, never a smaller design or shorter comments.
//
// Note the DIVISION OF LABOUR with graph-glow.js, which is easy to confuse: this
// file is the FLASH (wall-clock, a couple of seconds, the thing that reads as
// activity travelling), and graph-glow.js is the CHARGE (how opaque a node has
// become, draining on a rate set by the audio level). Every hit does both.
/* global graphGlow */
var graphLit = (function () {
  'use strict';

  // How long a node stays lit. Degree buys time, on the same argument as size:
  // the busy nodes are the ones worth looking at, so they hold the eye longer.
  // Slowed 50% on 2026-09-21 (from 1100 + 130/edge): the fade is sampled at the
  // frame rate, so a longer fade is also more steps between lit and unlit, which
  // is what the stepping looked like.
  var DUR_MIN = 1650;
  var DUR_PER_DEG = 195;
  var DUR_DEG_CAP = 12;
  var DUR_JITTER = 0.4;
  // EVERY EDGE EFFECT FADES FASTER THAN A NODE'S. 900 against a node's 1845 at
  // minimum (DUR_MIN + DUR_PER_DEG, before jitter) and 3990 at the degree cap, so
  // an edge is roughly half the quickest node and a quarter of the slowest.
  //
  // The reason is what each one MEANS. A node is a place and it stays a place; an
  // edge is a crossing, an event with a direction, and once the activation has
  // arrived the edge has already said what it had to say. Holding it as long as
  // its endpoints turns the picture into a wireframe that happens to have bright
  // corners, instead of nodes lighting up with the paths between them flickering
  // past. The charge drains faster too (graph-glow.js, EDGE_FADE).
  var EDGE_DUR = 900;
  // The saturated second pass outlives the white flash by this much.
  var SAT_MULT = 3;
  // 280, from 90. The decay below is the same as it ever was, but the RISE was a
  // pop, and with a charge layer accumulating underneath it was the only fast
  // edge left on screen -- so it was the whole of what read as flicker.
  var ATTACK_MS = 280;            // rise; the rest of the life is the fade
  var DECAY_POW = 1.2;            // >1 = falls away faster than it lingers. Close
  // to linear on purpose: at 1.8 the light was gone before the eye had followed
  // the chain that lit it.

  var lit = {};                   // id -> {t0, dur}
  var litEdges = {};              // "a\u0000b" -> {t0, dur, a, b}
  var deg = {};                   // id -> edge count, for DUR_PER_DEG

  // Guarded for the same reason graph-pulse.js guards it: this tree is edited
  // live, so a file can reach a browser a moment before its dependency's script
  // tag does, and an unguarded call throws inside the rAF instead of costing a
  // feature.
  function glow() {
    return typeof graphGlow !== 'undefined' ? graphGlow : null;
  }

  return {
    index: function (degrees) {
      deg = degrees;
    },

    // Two things happen on a hit and they are deliberately different. The LIT
    // EFFECT is reset -- a fresh `t0`, the flash re-fires, unchanged timings. The
    // CHARGE is topped up, never reset, and drains on a rate set by the audio
    // level. So the flash keeps saying "something happened here" while the opacity
    // underneath only climbs, which is what builds a picture over a track.
    fire: function (id, now) {
      var d = Math.min(deg[id] || 1, DUR_DEG_CAP);
      var base = DUR_MIN + DUR_PER_DEG * d;
      lit[id] = {
        t0: now,
        dur: base * (1 - DUR_JITTER + Math.random() * 2 * DUR_JITTER),
      };
      var g = glow();
      if (g) {
        g.bump(id);
      }
    },

    fireEdge: function (a, b, now) {
      var k = a + '\u0000' + b;
      litEdges[k] = { t0: now, dur: EDGE_DUR, a: a, b: b };
      var g = glow();
      if (g) {
        g.bumpEdge(k);
      }
    },

    // 1 at the top of the attack, 0 when spent.
    level: function (l, now) {
      var t = now - l.t0;
      if (t < 0 || t >= l.dur) {
        return 0;
      }
      if (t < ATTACK_MS) {
        return t / ATTACK_MS;
      }
      return Math.pow(1 - (t - ATTACK_MS) / (l.dur - ATTACK_MS), DECAY_POW);
    },

    // The saturated pass behind it: the same shape over SAT_MULT times the life.
    // Both envelopes live here, so there is one place that decides how long
    // anything glows.
    satLevel: function (l, now) {
      var t = now - l.t0, dur = l.dur * SAT_MULT;
      if (t < 0 || t >= dur) {
        return 0;
      }
      if (t < ATTACK_MS) {
        return t / ATTACK_MS;
      }
      return Math.pow(1 - (t - ATTACK_MS) / (dur - ATTACK_MS), DECAY_POW);
    },

    // A record is kept for the SATURATED life, which is the longer of the two.
    expire: function (now) {
      var k;
      for (k in lit) {
        if (now - lit[k].t0 >= lit[k].dur * SAT_MULT) {
          delete lit[k];
        }
      }
      for (k in litEdges) {
        if (now - litEdges[k].t0 >= litEdges[k].dur * SAT_MULT) {
          delete litEdges[k];
        }
      }
    },

    // {id: alpha} for everything still worth drawing on the white pass.
    levels: function (now) {
      var out = {};
      for (var id in lit) {
        var a = this.level(lit[id], now);
        if (a > 0.01) {
          out[id] = a;
        }
      }
      return out;
    },

    busy: function () {
      var k;
      for (k in lit) {
        return true;
      }
      for (k in litEdges) {
        return true;
      }
      return false;
    },

    // Read once by the draw half and mutated in place thereafter, the contract
    // `pos` already carries.
    nodes: function () { return lit; },
    edges: function () { return litEdges; },
    reset: function () { lit = {}; litEdges = {}; },
  };
})();
