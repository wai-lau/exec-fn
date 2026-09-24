// /graph — WHAT THE SOUND IS. Loaded before graph-audio.js, which owns where the
// sound comes from and what the graph does with it.
//
// This file replaces a single 200Hz lowpass. That filter was taken from raVe and
// it did its job for onset detection, but it meant EVERYTHING above 200Hz was
// discarded before analysis: a snare, a hat, a vocal, a lead, a chord change were
// all invisible, a track with no kick drove almost nothing, and — worst, because
// it is a misreport rather than a limitation — "loudness" was BASS loudness, so a
// bright loud passage with no low end read as quiet and got fewer seeds and a
// faster decay.
//
// So the analyser is unfiltered now and the bands are taken from its bins:
//
//   bass    onsets and tempo, as before
//   mid     the body of most music
//   treble  hats, snare transients, air
//
// THE CROSSOVERS BETWEEN THEM ARE NOT FIXED. They are re-cut every couple of
// seconds at the equal-energy thirds of a slowly-averaged spectrum, so what counts
// as bass is what is bass FOR THIS MATERIAL. Fixed at 200Hz and 2kHz they were
// fine for a typical mix and useless either side of it: a dark master has almost
// nothing above 2kHz, so one of the three inputs read ~0 for the whole song.
//
// plus three things no single band can say:
//
//   rms       full-band time-domain loudness -- what "loud" should always have meant
//   flux      spectral FLUX, the standard onset function: the sum of POSITIVE
//             bin-to-bin changes, which catches an onset that changes timbre
//             without raising band energy, and does not re-trigger on sustained
//             bass the way an energy rise does
//   centroid  where the energy sits, log-mapped to 0..1 -- a rough "brightness",
//             and the one cheap feature that distinguishes a bassline from a lead
//   pan       from a channel SPLITTER. Two channels arrive and were being summed
//             to mono; the graph is spatial and pan is free expressiveness.
var graphBands = (function () {
  'use strict';

  // 4096 over the 1024 the lowpassed version used: at 48kHz that is ~11.7Hz per
  // bin instead of ~23.4, so the bass band is ~15 bins rather than 8. Low
  // frequencies are where the resolution is needed and the FFT is on the audio
  // thread, so the cost is not ours to pay.
  var FFT = 4096;
  var SIDE_FFT = 1024;            // per-channel, level only: no spectrum needed
  // THE CROSSOVERS MOVE. They were fixed at 200Hz and 2kHz, which is fine for a
  // typical mix and useless for anything else: a dark-mastered track has almost
  // nothing above 2kHz, so its treble band read ~0 for the whole song and one of
  // the three inputs was simply dead. The same in reverse for a thin, bright mix,
  // where everything piled into `treb` and the bass band said nothing.
  //
  // So the splits are placed at EQUAL-ENERGY THIRDS of a slowly-averaged
  // spectrum: whatever the material, each band carries about a third of what is
  // actually there, and all three stay informative. Recomputed every RECALC_MS
  // from an EMA, never per frame — a crossover that moved at frame rate would
  // make "bass" mean something different from one beat to the next.
  var SPAN = [20, 12000];         // the range the thirds are taken over
  // CLAMPS, and they are not decoration. Tempo runs on the bass band, so if the
  // lower split drifted up into the mids the beat detector would start tracking
  // a vocal; and a split that collapsed toward either end would leave a band
  // empty again, which is the problem this is solving.
  var SPLIT1 = [80, 400];         // bass | mid
  var SPLIT2 = [1000, 6000];      // mid  | treble
  var RECALC_MS = 2000;
  var AVG_A = 0.003;              // EMA per frame: ~5s of history
  var BANDS = {
    bass: [30, 200],
    mid: [200, 2000],
    treb: [2000, 8000],
  };
  var CENT_LO = 60, CENT_HI = 8000;

  var ana = null, anaL = null, anaR = null;
  var freq = null, prev = null, wave = null, sideL = null, sideR = null;
  var range = {}, perBin = 0;
  var avg = null, lastCalc = 0, split1 = 200, split2 = 2000;

  // One object, mutated in place and read by the caller — never a fresh one per
  // frame, which at 60fps is garbage for the collector to chase.
  var out = {
    bass: 0, mid: 0, treb: 0, rms: 0, flux: 0, centroid: 0.5, pan: 0,
  };

  function bins(loHz, hiHz) {
    return {
      lo: Math.max(1, Math.floor(loHz / perBin)),
      hi: Math.min(freq.length - 1, Math.ceil(hiHz / perBin)),
    };
  }

  // Equal-energy thirds over SPAN, from the averaged spectrum. Returns nothing;
  // it moves `split1`/`split2` and rebuilds the bin ranges.
  function recut() {
    var lo = Math.max(1, Math.floor(SPAN[0] / perBin));
    var hi = Math.min(avg.length - 1, Math.ceil(SPAN[1] / perBin));
    var total = 0, i;
    for (i = lo; i <= hi; i++) {
      total += avg[i];
    }
    if (total <= 0) {
      return;                     // silence has no thirds
    }
    var run = 0, a = 0, b = 0;
    for (i = lo; i <= hi; i++) {
      run += avg[i];
      if (!a && run >= total / 3) {
        a = i * perBin;
      }
      if (!b && run >= total * 2 / 3) {
        b = i * perBin;
        break;
      }
    }
    split1 = Math.min(SPLIT1[1], Math.max(SPLIT1[0], a || split1));
    split2 = Math.min(SPLIT2[1], Math.max(SPLIT2[0], b || split2));
    // Ordering is enforced rather than assumed: clamping two values independently
    // can cross them, and a band with hi < lo reads as silence forever.
    if (split2 <= split1) {
      split2 = Math.min(SPLIT2[1], split1 * 2);
    }
    range.bass = bins(BANDS.bass[0], split1);
    range.mid = bins(split1, split2);
    range.treb = bins(split2, BANDS.treb[1]);
  }

  function bandLevel(r) {
    var sum = 0;
    for (var i = r.lo; i <= r.hi; i++) {
      sum += freq[i];
    }
    return sum / ((r.hi - r.lo + 1) * 255);
  }

  function chanRms(a, buf) {
    if (!a) {
      return 0;
    }
    a.getByteTimeDomainData(buf);
    var acc = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      acc += v * v;
    }
    return Math.sqrt(acc / buf.length);
  }

  return {
    // `src` is whatever node the capture half built — a stream source or a media
    // element source. This attaches and owns nothing else.
    attach: function (ctx, src) {
      ana = ctx.createAnalyser();
      ana.fftSize = FFT;
      // 0, against the default 0.8: averaging across frames is precisely what
      // onset detection must not do, because the frame-to-frame JUMP is the beat.
      ana.smoothingTimeConstant = 0;
      freq = new Uint8Array(ana.frequencyBinCount);
      prev = new Uint8Array(ana.frequencyBinCount);
      wave = new Uint8Array(ana.fftSize);
      avg = new Float32Array(ana.frequencyBinCount);
      lastCalc = 0; split1 = 200; split2 = 2000;
      src.connect(ana);

      perBin = ctx.sampleRate / 2 / ana.frequencyBinCount;
      range.bass = bins(BANDS.bass[0], BANDS.bass[1]);
      range.mid = bins(BANDS.mid[0], BANDS.mid[1]);
      range.treb = bins(BANDS.treb[0], BANDS.treb[1]);
      range.cent = bins(CENT_LO, CENT_HI);

      // Stereo, for pan alone. Wrapped because a mono source has one channel and
      // a splitter asked for two on it is a way to throw rather than a reading.
      try {
        var split = ctx.createChannelSplitter(2);
        src.connect(split);
        anaL = ctx.createAnalyser();
        anaR = ctx.createAnalyser();
        anaL.fftSize = SIDE_FFT;
        anaR.fftSize = SIDE_FFT;
        split.connect(anaL, 0);
        split.connect(anaR, 1);
        sideL = new Uint8Array(anaL.fftSize);
        sideR = new Uint8Array(anaR.fftSize);
      } catch (e) {
        anaL = null;
        anaR = null;
      }
    },

    detach: function () {
      ana = null; anaL = null; anaR = null; avg = null;
      freq = null; prev = null; wave = null; sideL = null; sideR = null;
      out.bass = 0; out.mid = 0; out.treb = 0; out.rms = 0;
      out.flux = 0; out.centroid = 0.5; out.pan = 0;
    },

    // Where the splits currently sit, for the readout and for checking that they
    // actually move with the material.
    crossovers: function () {
      return { bass_mid: Math.round(split1), mid_treble: Math.round(split2) };
    },

    // One frame. Returns the same mutated object every time.
    read: function () {
      if (!ana) {
        return out;
      }
      ana.getByteFrequencyData(freq);

      // The slow average the crossovers are cut from. It is deliberately a
      // different timescale from everything else here: the bands react per frame,
      // where what COUNTS as a band should change over a song, not over a bar.
      var now = performance.now();
      for (var k = 0; k < freq.length; k++) {
        avg[k] += (freq[k] - avg[k]) * AVG_A;
      }
      if (now - lastCalc >= RECALC_MS) {
        lastCalc = now;
        recut();
      }

      out.bass = bandLevel(range.bass);
      out.mid = bandLevel(range.mid);
      out.treb = bandLevel(range.treb);

      // Spectral flux: POSITIVE changes only. A falling bin is a sound ending,
      // which is not an onset, and counting it would make every decay look like
      // an attack.
      var f = 0, i;
      for (i = 1; i < freq.length; i++) {
        var d = freq[i] - prev[i];
        if (d > 0) {
          f += d;
        }
        prev[i] = freq[i];
      }
      out.flux = f / (freq.length * 255);

      // Centroid, log-mapped: pitch is logarithmic, so a linear centroid spends
      // almost its whole range on the top two octaves and reports every piece of
      // music as "low".
      var num = 0, den = 0;
      for (i = range.cent.lo; i <= range.cent.hi; i++) {
        var m = freq[i];
        if (!m) {
          continue;
        }
        num += Math.log(i * perBin) * m;
        den += m;
      }
      if (den > 0) {
        var lg = num / den;
        out.centroid = Math.min(1, Math.max(0,
          (lg - Math.log(CENT_LO)) / (Math.log(CENT_HI) - Math.log(CENT_LO))));
      }

      // FULL-BAND loudness. This is the line that fixes the old misreport: `rms`
      // used to be taken off a lowpassed signal, so a bright loud passage with no
      // low end was reported quiet.
      ana.getByteTimeDomainData(wave);
      var acc = 0;
      for (i = 0; i < wave.length; i++) {
        var v = (wave[i] - 128) / 128;
        acc += v * v;
      }
      out.rms = Math.sqrt(acc / wave.length);

      if (anaL) {
        var l = chanRms(anaL, sideL), r = chanRms(anaR, sideR);
        out.pan = (l + r) > 0.0001 ? (r - l) / (r + l) : 0;
      }
      return out;
    },
  };
})();
