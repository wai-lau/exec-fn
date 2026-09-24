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
//   bass    30-200Hz    onsets and tempo, as before
//   mid     200-2000    the body of most music
//   treble  2000-8000   hats, snare transients, air
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
  var BANDS = {
    bass: [30, 200],
    mid: [200, 2000],
    treb: [2000, 8000],
  };
  var CENT_LO = 60, CENT_HI = 8000;

  var ana = null, anaL = null, anaR = null;
  var freq = null, prev = null, wave = null, sideL = null, sideR = null;
  var range = {}, perBin = 0;

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
      ana = null; anaL = null; anaR = null;
      freq = null; prev = null; wave = null; sideL = null; sideR = null;
      out.bass = 0; out.mid = 0; out.treb = 0; out.rms = 0;
      out.flux = 0; out.centroid = 0.5; out.pan = 0;
    },

    // One frame. Returns the same mutated object every time.
    read: function () {
      if (!ana) {
        return out;
      }
      ana.getByteFrequencyData(freq);

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
