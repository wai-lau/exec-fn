// /graph — WHAT THE NUMBERS MEAN. Loaded before graph-audio.js, which owns where
// the sound comes from and when to fire.
//
// The seam, and it is one subject rather than a pile of helpers: EVERY RAW
// MEASUREMENT OUT OF graph-bands.js IS MEANINGLESS IN ABSOLUTE TERMS. A shared tab
// and a microphone across a room arrive at wildly different amplitudes and neither
// is wrong. A centroid's log range is 60Hz..8kHz but any real track uses a narrow
// slice of it. A treble share sits wherever the mastering put it. A flux value
// means nothing at all except against the flux either side of it.
//
// So nothing reaches the visuals raw. Each measurement is normalised against its
// OWN OBSERVED HISTORY and handed over as 0..1, and this file is the four windows
// that do it:
//
//   amp        a peak-held level against a slowly decaying peak  -- loud FOR THIS
//              SOURCE, and loud FOR THIS TRACK
//   pitch      a centroid against the range this material has shown
//   sharpness  a treble share against the range this material has shown
//   hit        a flux value against its own local average
//
// They differ in TIMESCALE and every one of those choices is load-bearing, so each
// is argued where it sits rather than here.
//
// Split out of graph-audio.js at 521 lines. The cap is a signal that a file has
// come to hold two subjects, and the second subject here was always this one:
// graph-audio.js is capture, onsets and firing, and none of that needs to know how
// a centroid becomes a screen position.
var graphNorm = (function () {
  'use strict';

  // ── level ────────────────────────────────────────────────────────────────
  // A ~80ms PEAK HOLD. `rms` was read on the one frame a fire happened, and with
  // grid firing that instant can land in a trough between two transients -- so a
  // loud beat could be counted quiet. The hold means a reading reflects the HIT
  // rather than the sampling moment.
  var HOLD_FALL = 0.78;
  // 0.99995, from 0.999. The old value fell to 1/e in about 17 seconds, so a quiet
  // intro renormalised to "full" within seconds and the DROP did not look like a
  // drop -- the track's dynamic arc, which is the most legible thing in music, was
  // being removed by the AGC. At this rate the reference spans minutes, so the loud
  // parts of a track read as loud RELATIVE TO THE TRACK.
  var PEAK_DECAY = 0.99995;
  var PEAK_FLOOR = 0.02;          // so silence cannot divide by nothing
  // A SMOOTHED loudness, for anything that needs "is the music playing" rather than
  // "how loud is this instant". Instantaneous RMS is near zero between two kicks,
  // so the cascade's fade clock -- which decays fast when quiet -- would race away
  // in the gaps inside a bar and undo the whole point. This is an envelope
  // follower: every kick tops it back up, and it takes about 1.5s of real silence
  // to fall away, which is the gap between tracks and not the gap between beats.
  var LOUD_FALL = 0.97;           // per frame; ~1.5s from full to nothing at 60fps

  // ── the onset window, and the strength inside it ─────────────────────────
  var HIST_N = 45;                // ~0.75s of frames = the LOCAL average
  // HOW HARD THE HIT LANDED, which the onset test throws away. That test reduces
  // flux to a boolean -- over SENS times the local average, or not -- so a snare at
  // three times the average and one barely over the line produced the same picture.
  // The RATIO is computed on the way to that boolean anyway and it is the one thing
  // on this page that says how hard something was struck.
  //
  // Deliberately a SEPARATE channel from `amp`: amplitude decides HOW MANY nodes a
  // beat lights, strength decides HOW BRIGHTLY each one lights. Both crowding onto
  // one channel is what made a quiet passage and a peak differ only in node count,
  // and count saturates at SEEDS_MAX long before music does.
  var HIT_SPAN = 2.6;             // ratio at or above this is a maximal hit
  // Never zero: a sustained passage sits near ratio 1 and it is still playing. A
  // floor of 0 would black out everything between the transients, which misreports
  // the music worse than a flat picture does.
  var HIT_FLOOR = 0.45;

  // ── pitch ────────────────────────────────────────────────────────────────
  // PITCH DECIDES HEIGHT, and the mapping ADAPTS to the material. A raw centroid
  // maps to almost nothing: its log range is 60Hz..8kHz but any real track uses a
  // narrow slice of that, sitting near the middle, so mapping it straight onto the
  // graph's height put every cascade in a band across the centre and left most of
  // the picture permanently dark.
  //
  // The window expands INSTANTLY to admit a new value and contracts SLOWLY toward
  // whatever the music is actually doing, so the full height gets used whatever the
  // material is -- and a track that genuinely narrows its range narrows its band
  // rather than being stretched to fill the screen forever.
  var CENT_RELAX = 0.0008;        // per read, toward the observed range
  var CENT_MIN_SPAN = 0.06;       // floor, so a steady tone cannot divide by ~0

  // ── timbre ───────────────────────────────────────────────────────────────
  // The treble SHARE, which is self-normalising by construction: graph-bands cuts
  // the crossovers at the EQUAL-ENERGY thirds of the averaged spectrum, so the
  // share sits near a third whatever the material and moves around that with the
  // instant. On fixed 200Hz/2kHz splits this would have said more about the
  // mastering than about the playing.
  var SHARP_RELAX = 0.0008;
  var SHARP_MIN_SPAN = 0.08;

  // ── placement ────────────────────────────────────────────────────────────
  // X WALKS, it does not teleport. Independent random X per beat is the thing that
  // read as "too random": every beat landed somewhere unrelated to the last, so a
  // sequence of beats was a scatter rather than a movement. A random WALK keeps
  // successive beats near each other, so the eye follows a travelling locus and the
  // picture looks intentional -- while X still carries no audio meaning, which is
  // what "ignore left and right" asked for.
  var X_STEP = 0.07;              // per fire, as a fraction of the width
  // The walk STARTS CENTRED. It began at Math.random(), which can land hard left or
  // hard right, so the first bars of a track drifted in from an edge for no reason
  // -- and the reflecting bound means an edge start also spends its first steps
  // bouncing rather than wandering. 0.5 has neither problem.
  var X_HOME = 0.5;

  var rms = 0, hold = 0, peak = PEAK_FLOOR, loud = 0, amp = 0;
  var hist = [], histI = 0, ratio = 1;
  // Inverted on purpose: the first reading seeds both ends.
  var centLo = 1, centHi = 0;
  var sharpLo = 1, sharpHi = 0, sharp = 0.5;
  var xWalk = X_HOME;

  // One window, three call sites. Expands instantly, contracts slowly, and cannot
  // collapse past `floor` -- which is what stops a steady tone dividing by ~0 and
  // reporting wild swings on a signal that is not moving.
  function window_(v, lo, hi, relax, floor) {
    if (v < lo) {
      lo = v;
    }
    if (v > hi) {
      hi = v;
    }
    var span = hi - lo;
    if (span > floor) {
      lo += span * relax;
      hi -= span * relax;
    }
    span = Math.max(hi - lo, floor);
    return { lo: lo, hi: hi, v: Math.min(1, Math.max(0, (v - lo) / span)) };
  }

  return {
    // ONE FRAME, folded in. Called from graph-audio.js's tick before anything
    // reads back, so every getter below answers about this frame.
    step: function (b) {
      rms = b.rms;
      // PEAK HOLD, then the slow reference. `hold` is what the seed count reads, so
      // a fire landing between two transients still sees the hit; `peak` spans
      // minutes, so a track's own dynamics survive instead of being normalised
      // flat.
      hold = Math.max(rms, hold * HOLD_FALL);
      peak = Math.max(rms, Math.max(PEAK_FLOOR, peak * PEAK_DECAY));
      amp = Math.min(1, hold / peak);
      loud = Math.max(amp, loud * LOUD_FALL);

      // The local average of FLUX, not a fixed number, so the onset threshold
      // follows a quiet room or a loud one with no sensitivity setting to get
      // wrong.
      var mean = 0, i;
      for (i = 0; i < hist.length; i++) {
        mean += hist[i];
      }
      mean = hist.length ? mean / hist.length : 0;
      // Peak-held on the same ~80ms envelope as the level, and for the same reason:
      // a cascade seeded a frame or two after the transient must still see it.
      ratio = Math.max(mean > 0 ? b.flux / mean : 1, 1 + (ratio - 1) * HOLD_FALL);

      // Folded in AFTER the ratio is taken: a loud frame folded in first raises the
      // very average it is about to be compared against, and the beat tests itself
      // away.
      if (hist.length < HIST_N) {
        hist.push(b.flux);
      } else {
        hist[histI] = b.flux;
        histI = (histI + 1) % HIST_N;
      }

      // TIMBRE steps ONCE PER FRAME, here, rather than on every read -- a
      // deliberate departure from `pitch` below. `pitch` is read per catch roll, so
      // its window contracts at a rate set by how busy the graph is; sharpness is
      // read per LIT NODE, which is busier still, and a window relaxing dozens of
      // times a frame would collapse to its floor within seconds of anything
      // interesting happening.
      var tot = b.bass + b.mid + b.treb;
      if (tot > 0) {
        var w = window_(b.treb / tot, sharpLo, sharpHi, SHARP_RELAX, SHARP_MIN_SPAN);
        sharpLo = w.lo; sharpHi = w.hi; sharp = w.v;
      }
    },

    // Enough history to judge an onset against.
    ready: function () { return hist.length >= HIST_N; },
    // Flux against its own local average. The onset test thresholds it; `hit`
    // reports how far past the threshold it went.
    fluxRatio: function () { return ratio; },

    rms: function () { return rms; },
    amp: function () { return amp; },
    loud: function () { return loud; },

    // 0..1: how hard the most recent transient landed, for anything that wants to
    // draw a hit BRIGHTER rather than draw more of them.
    hit: function () {
      var t = (ratio - 1) / (HIT_SPAN - 1);
      return HIT_FLOOR + (1 - HIT_FLOOR) * Math.min(1, Math.max(0, t));
    },

    // 0 = as bass-weighted as this material gets, 1 = as treble-weighted.
    sharpness: function () { return sharp; },

    // Centroid -> 0..1 against its own observed range: 0 is the lowest pitch this
    // material has shown, 1 the highest. ONE window, shared by the height mapping
    // and by the cascade's edge-length bias, so the two cannot disagree about what
    // counts as "low" for the track that is actually playing.
    pitch: function (c) {
      var w = window_(c, centLo, centHi, CENT_RELAX, CENT_MIN_SPAN);
      centLo = w.lo; centHi = w.hi;
      return w.v;
    },

    // Screen Y. Inverted, because bright sounds belong at the TOP.
    placeY: function (c) { return 1 - this.pitch(c); },

    // A reflecting random walk: it drifts, and it turns back at the edges rather
    // than wrapping, because wrapping would teleport across the whole picture and
    // that is the behaviour being removed.
    placeX: function () {
      xWalk += (Math.random() * 2 - 1) * X_STEP;
      if (xWalk < 0) {
        xWalk = -xWalk;
      } else if (xWalk > 1) {
        xWalk = 2 - xWalk;
      }
      return xWalk;
    },

    // The observed centroid window, for checking the height mapping is actually
    // using the graph rather than a band across its middle.
    centroidRange: function () {
      return { lo: +centLo.toFixed(3), hi: +centHi.toFixed(3) };
    },

    reset: function () {
      rms = 0; hold = 0; peak = PEAK_FLOOR; loud = 0; amp = 0;
      hist = []; histI = 0; ratio = 1;
      centLo = 1; centHi = 0;
      sharpLo = 1; sharpHi = 0; sharp = 0.5;
      xWalk = X_HOME;
    },
  };
})();
