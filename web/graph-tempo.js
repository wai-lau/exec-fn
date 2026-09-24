// /graph — WHAT THE BEAT IS. Loaded before graph-audio.js, which owns where the
// sound comes from and what to do on a beat.
//
// The seam: this file is handed a stream of onset-energy samples and answers
// "how fast, and when is the next one". It knows nothing about microphones,
// shared tabs, files or cascades, which is what lets the source list grow
// without touching any of the arithmetic below.
var graphTempo = (function () {
  'use strict';

  // ── tempo ────────────────────────────────────────────────────────────────
  // The onset envelope is resampled onto a FIXED 50Hz grid rather than kept per
  // animation frame, so a lag converts to a tempo exactly and a device running at
  // 30 or 144fps measures the same BPM.
  var QUIET_MS = 4000;            // no onset for this long and the lock lapses
  var ENV_HZ = 50;
  var ENV_MS = 1000 / ENV_HZ;
  var ENV_N = 300;                // 6s of history: ~6 beats at 60bpm
  var BPM_MIN = 60, BPM_MAX = 180;
  var TEMPO_MS = 1000;            // re-estimate this often
  var LOCK_MIN = 0.22;            // correlation below this is not a tempo
  var PREF_LO = 90, PREF_MAX = 150;   // the octave the ear usually picks
  var OCT_KEEP = 0.7;             // how well the double must still correlate
  var BEAT_DIV = 1;               // iterations per beat: the "fraction of the bpm"
  var PLL_PULL = 0.25;            // how hard a real onset drags the grid onto it
  var PLL_WINDOW = 0.25;          // ...and how far off it may be to count, in beats

  var env = [], envI = 0, envAcc = 0, envAt = 0;
  var period = 0, nextFire = 0, lastTempo = 0, conf = 0, lastOnset = 0;

  function bpmOf(lag) {
    return 60000 / (lag * ENV_MS);
  }

  function envSeries() {
    return env.length < ENV_N ? env.slice()
      : env.slice(envI).concat(env.slice(0, envI));
  }

  // The onset envelope, resampled onto a fixed ENV_HZ grid. Each bucket keeps its
  // MAXIMUM rather than its mean: a kick is a transient, and averaging it with the
  // 19ms either side of it is how you lose the thing you are trying to find.
  function pushEnv(now, energy) {
    if (!envAt) {
      envAt = now;
    }
    if (energy > envAcc) {
      envAcc = energy;
    }
    while (now - envAt >= ENV_MS) {
      if (env.length < ENV_N) {
        env.push(envAcc);
      } else {
        env[envI] = envAcc;
        envI = (envI + 1) % ENV_N;
      }
      envAt += ENV_MS;
      envAcc = 0;
    }
  }

  // TEMPO, by autocorrelation of that envelope.
  //
  // This IS the Fourier answer, computed directly. Wiener-Khinchin makes the
  // autocorrelation the inverse transform of the power spectrum, so the lag
  // peaking here is the frequency an FFT of the envelope would peak at. Taking it
  // directly avoids hand-rolling a DFT — there is no native FFT for an arbitrary
  // array, AnalyserNode only transforms live audio — and 34 lags over 300 samples
  // once a second is nothing next to what it would cost to be clever.
  function retempo(now) {
    lastTempo = now;
    var x = envSeries(), i;
    if (x.length < ENV_N) {
      return;
    }
    var mean = 0;
    for (i = 0; i < x.length; i++) {
      mean += x[i];
    }
    mean /= x.length;
    var v = 0;
    for (i = 0; i < x.length; i++) {
      v += (x[i] - mean) * (x[i] - mean);
    }
    if (v <= 0) {
      // A flat window is SILENCE, not a wrong answer. Zeroing conf here would
      // destroy a good lock every time the source went quiet for six seconds and
      // then make the page re-learn the tempo from scratch; locked() already
      // lapses on its own when no onset has arrived for QUIET_MS.
      return;
    }
    var loLag = Math.floor(60 / BPM_MAX * ENV_HZ);
    var hiLag = Math.ceil(60 / BPM_MIN * ENV_HZ);
    var best = 0, bestLag = 0, corr = {};
    for (var lag = loLag; lag <= hiLag; lag++) {
      var c = 0;
      for (i = lag; i < x.length; i++) {
        c += (x[i] - mean) * (x[i - lag] - mean);
      }
      c /= v;
      // Prefer the octave the ear picks. A kick pattern correlates just as well
      // at half and at double its tempo, so without this the winner is whichever
      // of the three the noise happened to favour — a grid that is correctly
      // phased and twice too fast, which looks like a bug and is not one.
      corr[lag] = c;
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }

    // OCTAVE CORRECTION, and it is not optional. A periodic kick pattern
    // correlates just as well at half its tempo as at its true one — every other
    // beat still lines up — and the half is the LONGER lag, which on a noisy
    // envelope often edges ahead. Measured here against a 120bpm click track: the
    // raw winner was 61, i.e. exactly half, reported with high confidence.
    //
    // So the winner is explicitly offered its double: if halving the lag lands in
    // the band the ear actually picks and still correlates within OCT_KEEP of the
    // best, take it. A weighting nudge cannot do this job — it only re-ranks
    // candidates that already compete, and at half tempo the two are genuinely
    // equally periodic.
    var half = Math.round(bestLag / 2);
    if (half >= loLag && corr[half] !== undefined
        && bpmOf(half) <= PREF_MAX && bpmOf(bestLag) < PREF_LO
        && corr[half] >= best * OCT_KEEP) {
      bestLag = half;
      best = corr[half];
    }
    conf = best;
    if (best >= LOCK_MIN && bestLag) {
      var p = bestLag * ENV_MS;
      // Only re-anchor on a REAL change. Rewriting the period every second with
      // the same number would restart the grid every second, which is audible as
      // the one thing this is supposed to fix.
      if (!period || Math.abs(p - period) > period * 0.03) {
        period = p;
        nextFire = now;
      }
    }
  }

  function locked(now) {
    return period > 0 && conf >= LOCK_MIN && (now - lastBeat) < QUIET_MS;
  }

  // A detected onset drags the grid ONTO it, rather than the grid being restarted
  // from it. Autocorrelation gives a period and says nothing about phase, so
  // without this the beat is the right length and lands between the kicks.
  function phaseLock(now) {
    if (!period) {
      return;
    }
    var err = now - nextFire;
    err -= period * Math.round(err / period);      // fold to the nearest grid point
    if (Math.abs(err) < period * PLL_WINDOW) {
      nextFire += err * PLL_PULL;
    }
  }

  function tick() {
    if (!on) {
      return;
    }
    raf = requestAnimationFrame(tick);
    ana.getByteFrequencyData(freq);
    var sum = 0, i;
    for (i = 0; i < freq.length; i++) {
      sum += freq[i];
    }
    var energy = sum / freq.length;

    // Time domain as well, the way raVe reads both: RMS of the lowpassed signal
    // is the honest loudness of the bass, where the binned average is a spectrum
    // shape. This is what decides how MANY nodes a beat wakes.
    ana.getByteTimeDomainData(wave);
    var acc = 0;
    for (i = 0; i < wave.length; i++) {
      var v = (wave[i] - 128) / 128;
      acc += v * v;
    }
    rms = Math.sqrt(acc / wave.length);
    peak = Math.max(rms, peak * PEAK_DECAY);

    var now = performance.now();
    pushEnv(now, energy);

    // The onset threshold is the LOCAL average, not a fixed number, so it follows
    // a quiet room or a loud one with no sensitivity setting to get wrong.
    var mean = 0;
    for (i = 0; i < hist.length; i++) {
      mean += hist[i];
    }
    mean = hist.length ? mean / hist.length : 0;

    var onset = hist.length >= HIST_N && energy > FLOOR && mean > 0
      && energy > mean * SENS && (now - lastBeat) > MIN_GAP_MS;
    if (onset) {
      lastBeat = now;
      phaseLock(now);
    }
    if (now - lastTempo >= TEMPO_MS) {
      retempo(now);
    }

    if (locked(now)) {
      // On the grid: steady, and phase-locked to the kicks by phaseLock(). This
      // is the point of measuring tempo at all — raw onset firing is jittery and
      // drops a beat whenever one kick is quieter than the running average.
      var step = period / BEAT_DIV;
      // A backgrounded tab resumes with `now` far ahead. Resync instead of firing
      // the whole gap: cascades last ~2s, so the page would otherwise spend a
      // minute catching up on beats nobody heard.
      if (now - nextFire > step * 4) {
        nextFire = now;
      }
      var guard = 0;
      while (now >= nextFire && guard++ < 4) {
        fire();
        nextFire += step;
      }
    } else if (onset) {
      // No tempo yet, or the music stopped: fall back to firing on what is
      // actually heard, which is where this started.
      fire();
    }

    // Written AFTER the test: a loud frame folded in first raises the very
    // average it is about to be compared against, and the beat tests itself away.
    if (hist.length < HIST_N) {
      hist.push(energy);
    } else {
      hist[histI] = energy;
      histI = (histI + 1) % HIST_N;
    }
  }

  return {
    reset: function () {
      env = []; envI = 0; envAcc = 0; envAt = 0;
      period = 0; nextFire = 0; lastTempo = 0; conf = 0; lastOnset = 0;
    },
    // One envelope sample per frame. Also runs the re-estimate on its own clock,
    // so the caller does not have to keep one.
    push: function (now, energy) {
      pushEnv(now, energy);
      if (now - lastTempo >= TEMPO_MS) {
        retempo(now);
      }
    },
    // A real onset was heard: drag the grid onto it.
    onset: function (now) {
      lastOnset = now;
      phaseLock(now);
    },
    // How many times to fire this frame. 0 unless the grid says so; the caller
    // falls back to firing on raw onsets when this is not locked.
    fires: function (now) {
      if (!this.locked(now)) {
        return 0;
      }
      var step = period / BEAT_DIV, n = 0;
      // A backgrounded tab resumes with `now` far ahead. Resync rather than
      // firing the whole gap: cascades last ~2s, so the page would otherwise
      // spend a minute catching up on beats nobody heard.
      if (now - nextFire > step * 4) {
        nextFire = now;
      }
      while (now >= nextFire && n < 4) {
        nextFire += step;
        n++;
      }
      return n;
    },
    locked: function (now) {
      return period > 0 && conf >= LOCK_MIN && (now - lastOnset) < QUIET_MS;
    },
    bpm: function () {
      return period && conf >= LOCK_MIN ? Math.round(60000 / period) : 0;
    },
    confidence: function () {
      return conf;
    },
    // The analysis is invisible by construction — it produces a clock, not a
    // picture — so this is how a change to it gets checked at all.
    stats: function () {
      var x = envSeries(), i, mean = 0, v = 0, peak = 0;
      for (i = 0; i < x.length; i++) {
        mean += x[i];
        if (x[i] > peak) { peak = x[i]; }
      }
      mean = x.length ? mean / x.length : 0;
      for (i = 0; i < x.length; i++) { v += (x[i] - mean) * (x[i] - mean); }
      return {
        n: x.length, need: ENV_N, mean: +mean.toFixed(3),
        peak: +peak.toFixed(3), variance: +v.toFixed(3),
        period: Math.round(period), conf: +conf.toFixed(3),
      };
    },
  };
})();
