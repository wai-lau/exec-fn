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
  // 12s of history, up from 6. THE WINDOW IS THE STABILITY: 6 seconds is only
  // about twelve beats at 120bpm, and on that little evidence noise moves the
  // autocorrelation peak from one estimate to the next, so the reported tempo
  // wandered. Twice the window is twice the beats agreeing before anything is
  // believed.
  var ENV_N = 600;
  // ...but estimating starts at 6s rather than waiting for the full window, so
  // the first lock is no slower than it was. The window only has to be FULL for
  // the estimate to be at its steadiest, not for it to exist.
  var ENV_MIN = 300;
  var BPM_MIN = 60, BPM_MAX = 180;
  var TEMPO_MS = 1000;            // re-estimate this often
  var LOCK_MIN = 0.22;            // correlation below this is not a tempo
  var PREF_LO = 90, PREF_MAX = 150;   // the octave the ear usually picks
  var OCT_KEEP = 0.7;             // how well the double must still correlate
  var BEAT_DIV = 1;               // iterations per beat: the "fraction of the bpm"
  var PLL_PULL = 0.25;            // how hard a real onset drags the grid onto it
  var PLL_WINDOW = 0.25;          // ...and how far off it may be to count, in beats
  // A ROLLING VOTE on top of the longer window. Each re-estimate is one ballot and
  // the MEDIAN of the last VOTE_N wins, so a single bad second cannot move the
  // reported tempo at all — it has to out-vote the last eight. Median rather than
  // mean because a wrong estimate is usually wrong by a whole octave, and an
  // average of 120 and 60 is 90, which is neither.
  var VOTE_N = 8;
  var PERIOD_TOL = 0.03;          // ignore a change smaller than this
  // onBeat was LINEAR across the half-period, which made almost everything read
  // as "somewhat on beat" and blunted the multiplier that depends on it. Squared,
  // a quarter-beat off is worth 0.25 instead of 0.5, so the term discriminates.
  var ONBEAT_POW = 2;
  // Music is hierarchical and the visuals were flat: beat 3 looked exactly like
  // the downbeat. Beats are counted so the caller can accent the bar.
  var BEATS_PER_BAR = 4;

  var env = [], envI = 0, envAcc = 0, envAt = 0;
  var period = 0, nextFire = 0, lastTempo = 0, conf = 0, lastOnset = 0;
  var votes = [], beatN = 0;

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
    if (x.length < ENV_MIN) {
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
    if (best < LOCK_MIN || !bestLag) {
      return;
    }

    votes.push(bestLag);
    if (votes.length > VOTE_N) {
      votes.shift();
    }
    var sorted = votes.slice().sort(function (x1, x2) { return x1 - x2; });
    var p = sorted[sorted.length >> 1] * ENV_MS;

    // Only move on a REAL change, and DO NOT reset the phase when it moves. The
    // old line set `nextFire = now`, which threw the grid's alignment away every
    // time the estimate wobbled by 3% — so the beat kept restarting from whatever
    // instant the estimate happened to land on. phaseLock() drags the grid onto
    // real onsets and `fires()` resyncs anything wildly stale, so phase looks
    // after itself and the period can change underneath it.
    if (!period || Math.abs(p - period) > period * PERIOD_TOL) {
      period = p;
      if (!nextFire) {
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

  return {
    reset: function () {
      env = []; envI = 0; envAcc = 0; envAt = 0;
      period = 0; nextFire = 0; lastTempo = 0; conf = 0; lastOnset = 0;
      votes = []; beatN = 0;
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
        beatN++;
        n++;
      }
      return n;
    },
    locked: function (now) {
      return period > 0 && conf >= LOCK_MIN && (now - lastOnset) < QUIET_MS;
    },
    // 1 exactly on a grid point, 0 exactly between two, and 1 whenever there is
    // no lock at all — with no tempo the page is firing on raw onsets, which are
    // on the beat by construction, so an unlocked reading must not be a penalty.
    onBeat: function (now) {
      if (!period || conf < LOCK_MIN) {
        return 1;
      }
      var err = now - nextFire;
      err -= period * Math.round(err / period);     // fold to the nearest beat
      var lin = Math.max(0, 1 - Math.abs(err) / (period / 2));
      return Math.pow(lin, ONBEAT_POW);
    },

    // Which beat of the bar the last fire was, and whether it was the downbeat.
    // The count is only as good as the phase lock, which is why nothing here
    // claims to know where bar ONE is -- only that every fourth fire is the same
    // position in the bar as the one four before it. That is enough to accent a
    // pulse; it is not enough to claim a time signature.
    beatInBar: function () {
      return beatN % BEATS_PER_BAR;
    },
    isDownbeat: function () {
      return period > 0 && (beatN % BEATS_PER_BAR) === 0;
    },

    // A hop delay that is a MUSICAL subdivision rather than a constant. The
    // cascade spread at a fixed 110ms, which is unrelated to whatever is playing,
    // so the travel itself was arrhythmic even when the seeding was on the grid.
    // A sixteenth is short enough to read as travel and long enough to be felt.
    hopMs: function () {
      return period > 0 && conf >= LOCK_MIN ? period / 4 : 0;
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
        n: x.length, need: ENV_N, votes: votes.length,
        spread: votes.length ? Math.max.apply(null, votes) - Math.min.apply(null, votes) : 0,
        mean: +mean.toFixed(3),
        peak: +peak.toFixed(3), variance: +v.toFixed(3),
        period: Math.round(period), conf: +conf.toFixed(3),
      };
    },
  };
})();
