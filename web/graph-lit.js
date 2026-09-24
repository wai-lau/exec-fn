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
/* global graphGlow, graphAudio */
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
  // TIMBRE BENDS BOTH OF THOSE. A hat and a kick are equally loud transients at
  // equally valid moments and they used to draw the same flash; the only thing
  // that told them apart was where they landed. graphAudio.sharpness() is 0 when
  // the sound is as bass-weighted as this material gets and 1 when it is as
  // treble-weighted, so the multiplier `1 + K * (1 - 2 * sharp)` runs from 1+K at
  // the bass end through exactly 1 at the middle to 1-K at the treble end.
  //
  // Sharp reads SHORT and FAST: a hat is a click, and a click that swells over
  // 280ms and hangs for two seconds is not a click. Broad reads LONG and SLOW: a
  // kick is a body, and the eye should have time to see it arrive.
  //
  // The centre being exactly 1 is what makes this free: sharpness returns 0.5 with
  // nothing listening, so every timing here is unchanged when the audio is off.
  var DUR_SHARP = 0.55;           // life:   1.55x at the bass end, 0.45x at treble
  var ATT_SHARP = 0.6;            // attack: 448ms at the bass end, 112ms at treble
  var DECAY_POW = 1.2;            // >1 = falls away faster than it lingers. Close
  // to linear on purpose: at 1.8 the light was gone before the eye had followed
  // the chain that lit it.

  // HOW HARD THE HIT WAS, as a multiplier on the whole envelope. Everything on
  // this canvas used to be drawn at exactly one brightness: a peak and a whisper
  // lit their nodes identically and differed only in HOW MANY, which is a single
  // channel doing the work of two and one that saturates at SEEDS_MAX.
  //
  // It is read at FIRE time, per node, not captured once per cascade -- so a
  // cascade still travelling while the music swells brightens along its length,
  // and one crossing a decay dims. That is more of the sound on screen, not less,
  // and it is the same rate graph-glow.js already reads the level at.
  var lit = {};                   // id -> {t0, dur, g}
  var litEdges = {};              // "a\u0000b" -> {t0, dur, a, b, g}
  var deg = {};                   // id -> edge count, for DUR_PER_DEG

  // Guarded for the same reason graph-pulse.js guards it: this tree is edited
  // live, so a file can reach a browser a moment before its dependency's script
  // tag does, and an unguarded call throws inside the rAF instead of costing a
  // feature.
  function glow() {
    return typeof graphGlow !== 'undefined' ? graphGlow : null;
  }

  // 1 with nothing listening, so every number below is unchanged when the audio
  // is off and the ambient animation looks exactly as it did.
  function hit() {
    return typeof graphAudio !== 'undefined' ? graphAudio.hit() : 1;
  }

  // 0.5 -- dead centre, every multiplier 1 -- with nothing listening.
  function sharpness() {
    return typeof graphAudio !== 'undefined' ? graphAudio.sharpness() : 0.5;
  }

  function bend(k, sharp) {
    return 1 + k * (1 - 2 * sharp);
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
      var h = hit(), sh = sharpness();
      lit[id] = {
        t0: now,
        dur: base * (1 - DUR_JITTER + Math.random() * 2 * DUR_JITTER)
          * bend(DUR_SHARP, sh),
        g: h,
        // The attack is stored per record rather than read at draw time: it is a
        // property of the sound that caused THIS flash, and a node lit by a kick
        // should keep swelling slowly even if a hat lands while it is still rising.
        at: ATTACK_MS * bend(ATT_SHARP, sh),
      };
      var g = glow();
      if (g) {
        // The CHARGE takes the strength too, so a soft passage builds the picture
        // slowly and a hard one builds it fast. Accumulation that ignored how hard
        // each hit was would say every track arrives at the same place at the same
        // rate, which is the flattening this whole change is undoing.
        g.bump(id, h);
      }
    },

    fireEdge: function (a, b, now) {
      var k = a + '\u0000' + b;
      var h = hit(), sh = sharpness();
      litEdges[k] = {
        t0: now, dur: EDGE_DUR * bend(DUR_SHARP, sh), a: a, b: b, g: h,
        at: ATTACK_MS * bend(ATT_SHARP, sh),
      };
      var g = glow();
      if (g) {
        g.bumpEdge(k, h);
      }
    },

    // 1 at the top of the attack, 0 when spent.
    level: function (l, now) {
      var t = now - l.t0;
      if (t < 0 || t >= l.dur) {
        return 0;
      }
      var g = l.g === undefined ? 1 : l.g;
      var att = l.at === undefined ? ATTACK_MS : l.at;
      if (t < att) {
        return g * t / att;
      }
      return g * Math.pow(1 - (t - att) / (l.dur - att), DECAY_POW);
    },

    // The saturated pass behind it: the same shape over SAT_MULT times the life.
    // Both envelopes live here, so there is one place that decides how long
    // anything glows.
    satLevel: function (l, now) {
      var t = now - l.t0, dur = l.dur * SAT_MULT;
      if (t < 0 || t >= dur) {
        return 0;
      }
      var g = l.g === undefined ? 1 : l.g;
      var att = l.at === undefined ? ATTACK_MS : l.at;
      if (t < att) {
        return g * t / att;
      }
      return g * Math.pow(1 - (t - att) / (dur - att), DECAY_POW);
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
