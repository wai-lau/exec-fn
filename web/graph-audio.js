// /graph — capture and analysis: where the sound comes from, and what a beat is
// worth. DESKTOP ONLY, by decision. The control that drives it is
// graph-audio-ui.js; the tempo arithmetic is graph-tempo.js.
//
// WHERE THE AUDIO COMES FROM, which is the whole design.
//
// A page cannot read the device's audio OUTPUT directly. There is no system-audio
// capture on iOS at all, and Safari and Firefox put no audio on a getDisplayMedia
// stream either. What IS available, in rough order of how good the signal is:
//
//   1. A local FILE, played by the page itself. No permission, no picker, no
//      room: createMediaElementSource sees the exact signal. This is raVe's
//      Playlist.js (`this.audio.src = song.blob`). Drop a file on the page.
//   2. A SHARED TAB on Chrome/Edge desktop, which is the real output of whatever
//      is playing in it and works with headphones on.
//   3. A LOOPBACK input device, if the machine has one — PulseAudio's
//      "Monitor of ...", Stereo Mix on Windows, BlackHole or Loopback on macOS.
//      These are the speaker output wearing a microphone's clothes, so they need
//      no share prompt. There is no web API for them: they exist only where the
//      machine has been set up for it, which is why they are offered and never
//      assumed.
//   4. The MICROPHONE, which hears the room. Needs speakers, and hears everything
//      else in the room with them. This is raVe's Microphone.js.
//
// NOTHING LIGHTS UP WHEN IT IS QUIET. While capture is on, the model's ambient
// self-seeding stays off even in silence — see `driving()`.
//
// COST. Off, this file does nothing: no context, no stream, no rAF. On, it is one
// rAF plus two small reads per frame, with the FFT on the audio thread. What
// costs is the cascades it fires; this page's animation is the one layer under
// the CRT stack's two backdrop-filter panes, so MIN_GAP_MS here and the model's
// own MAX_LIVE are what bound it.
/* global graphPulse, graphTempo, graphAudioUI */
var graphAudio = (function () {
  'use strict';

  var FFT = 1024;                 // post-lowpass the band is narrow; 512 bins is plenty
  var CUT_HZ = 200;               // lowpass: the kick band, and nothing above it
  var CUT_Q = 0.7;                // gentle, no resonant peak inventing beats
  var HIST_N = 45;                // ~0.75s of frames = the LOCAL average
  var SENS = 1.32;                // onset = energy over SENS x that average
  var FLOOR = 6;                  // 0..255; under this it counts as silence
  var MIN_GAP_MS = 190;           // debounce -> a ~315bpm ceiling

  // How many starting points a beat gets. Level is judged against a DECAYING PEAK
  // rather than an absolute number, because a shared tab and a microphone across a
  // room arrive at wildly different amplitudes and neither is wrong; what matters
  // is loud FOR THIS SOURCE. The peak decays so a track that gets quieter is not
  // judged against its own loudest moment for the rest of its life.
  var SEEDS_MIN = 4, SEEDS_MAX = 20;
  var PEAK_DECAY = 0.999;

  // All three processors OFF on purpose. Echo cancellation, auto gain and noise
  // suppression exist to make a voice call intelligible, and every one of them
  // works by flattening the transients a beat IS — autoGainControl in particular
  // will quietly normalise a track's dynamics away. raVe passes a bare
  // `{audio: true}` and inherits the processed chain, which is the wrong signal.
  var RAW = { echoCancellation: false, autoGainControl: false, noiseSuppression: false };

  var LOOPBACK = /monitor of|stereo mix|loopback|what ?u ?hear|blackhole|soundflower|vb-?audio|voicemeeter/i;

  var on = false, ctx = null, stream = null, ana = null, freq = null, wave = null;
  var raf = 0, el = null, binHi = 0;
  var hist = [], histI = 0, lastBeat = 0, rms = 0, peak = 0.02;

  // ── the control, reached through a shim ──────────────────────────────────
  // Guarded so the analysis runs with no UI present at all, which is what a test
  // harness wants.
  function ui() {
    return typeof graphAudioUI !== 'undefined' ? graphAudioUI : null;
  }

  function say(msg, sticky) {
    var u = ui();
    if (u) {
      u.say(msg, sticky);
    }
  }

  function paint() {
    var u = ui();
    if (u) {
      u.paint(on);
    }
  }

  // ── what the model asks ──────────────────────────────────────────────────

  // The ambient clock asks this before seeding on its own, and while capture is ON
  // the answer is always yes — even in silence. NOTHING SHOULD LIGHT UP WHEN IT IS
  // QUIET: handing back to the self-seeding animation during a gap would look
  // exactly like the audio still driving it, which is worse than a dark graph
  // because it is a lie about what the page is doing. Turning the control off is
  // what restores ambient.
  function driving() {
    return on;
  }

  function seedsForLevel() {
    var norm = peak > 0 ? Math.min(1, rms / peak) : 0;
    return SEEDS_MIN + Math.round(norm * (SEEDS_MAX - SEEDS_MIN));
  }

  function fire() {
    if (typeof graphPulse === 'undefined') {
      return;
    }
    // No id, deliberately: graphPulse.seed(id) is the smaller TAPPED cascade,
    // while no id lets the model take its own weighted draw and run a full burst.
    // The COUNT is where the loudness lands.
    graphPulse.seed(null, seedsForLevel());
    var u = ui();
    if (u) {
      u.flash();
    }
  }

  // ── the frame ────────────────────────────────────────────────────────────

  function tick() {
    if (!on) {
      return;
    }
    raf = requestAnimationFrame(tick);

    // Only the bins the lowpass actually passes. Averaging all 512 of them after
    // filtering everything above CUT_HZ divides the signal by ~128: measured, a
    // kick peaked at 6.7 of 255, which sits ON the silence FLOOR and made onsets
    // fire only by luck — so the phase lock had almost nothing to lock to. With
    // the band alone the same kick peaks at 252.
    ana.getByteFrequencyData(freq);
    var sum = 0, i;
    for (i = 0; i <= binHi; i++) {
      sum += freq[i];
    }
    var energy = sum / (binHi + 1);

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
    graphTempo.push(now, energy);

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
      graphTempo.onset(now);
    }

    var n = graphTempo.fires(now);
    if (n) {
      // On the grid: steady, and phase-locked to the kicks. This is the point of
      // measuring tempo at all — raw onset firing is jittery and drops a beat
      // whenever one kick is quieter than the running average.
      while (n-- > 0) {
        fire();
      }
    } else if (onset && !graphTempo.locked(now)) {
      // No tempo yet: fall back to firing on what is actually heard, which is
      // where this started.
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

  // ── opening and closing a source ─────────────────────────────────────────

  function stop(msg) {
    on = false;
    cancelAnimationFrame(raf);
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (el) {
      el.pause();
      URL.revokeObjectURL(el.src);   // or the blob is held for the life of the tab
      el = null;
    }
    if (ctx) {
      ctx.close();
    }
    stream = null; ctx = null; ana = null; freq = null; wave = null;
    hist = []; histI = 0; lastBeat = 0; rms = 0; peak = 0.02;
    graphTempo.reset();
    paint();
    say(msg === '' ? '' : (msg || 'ambient'));
  }

  function listen(make, label, s, audible) {
    stream = s;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume();
    }
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = CUT_HZ;
    lp.Q.value = CUT_Q;
    ana = ctx.createAnalyser();
    ana.fftSize = FFT;
    // Default 0.8 averages across frames, which is precisely what onset detection
    // must not do: the frame-to-frame JUMP is the beat.
    ana.smoothingTimeConstant = 0;
    freq = new Uint8Array(ana.frequencyBinCount);
    wave = new Uint8Array(ana.fftSize);
    var perBin = ctx.sampleRate / 2 / ana.frequencyBinCount;
    binHi = Math.max(2, Math.min(ana.frequencyBinCount - 1, Math.ceil(CUT_HZ / perBin)));

    var src = make(ctx);
    src.connect(lp);
    lp.connect(ana);
    // A CAPTURED stream must never reach the speakers — that is feedback, and on
    // a loopback device it is feedback into its own source. A file WE are playing
    // is the opposite case: createMediaElementSource reroutes the element's output
    // into the graph, so without this the page goes silent.
    if (audible) {
      src.connect(ctx.destination);
    }
    if (stream) {
      // Chrome's own "stop sharing", or a device being unplugged.
      stream.getAudioTracks().forEach(function (t) {
        t.addEventListener('ended', function () { stop('capture ended'); });
      });
    }
    on = true;
    paint();
    say(label, true);   // sticky: the note is the readout of WHICH input is live
    raf = requestAnimationFrame(tick);
  }

  function nameOf(d) {
    return (d && d.label) || '';
  }

  function fromStream(s, label) {
    listen(function (c) { return c.createMediaStreamSource(s); }, label, s, false);
  }

  function inputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve([]);
    }
    return navigator.mediaDevices.enumerateDevices().then(function (ds) {
      return ds.filter(function (d) { return d.kind === 'audioinput'; });
    }).catch(function () { return []; });
  }

  function useDevice(dev) {
    var want = {
      echoCancellation: false, autoGainControl: false, noiseSuppression: false,
    };
    if (dev && dev.deviceId) {
      want.deviceId = { exact: dev.deviceId };
    }
    navigator.mediaDevices.getUserMedia({ audio: want }).then(function (s) {
      var n = nameOf(dev) || 'default microphone';
      fromStream(s, 'in: ' + n + (LOOPBACK.test(n) ? '  (speaker output)' : ''));
    }).catch(function (e) {
      stop(e && e.name === 'NotAllowedError'
        ? 'microphone blocked for this site' : 'could not open that input');
    });
  }

  // The "just work" path: the loopback device if the machine has one, else the
  // default mic. Device LABELS are empty until a capture permission has been
  // granted, which is why this opens a stream FIRST and may then re-open on a
  // better device — enumerating up front returns a list of anonymous ids.
  function auto() {
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      stop('no audio source available');
      return;
    }
    md.getUserMedia({ audio: RAW }).then(function (s) {
      return inputs().then(function (ds) {
        var hit = null;
        for (var i = 0; i < ds.length; i++) {
          if (LOOPBACK.test(nameOf(ds[i]))) {
            hit = ds[i];
            break;
          }
        }
        if (!hit) {
          fromStream(s, 'in: default microphone');
          return;
        }
        // Two live captures is two recording indicators for one feature.
        s.getTracks().forEach(function (t) { t.stop(); });
        useDevice(hit);
      });
    }).catch(function (e) {
      stop(e && e.name === 'NotAllowedError'
        ? 'microphone blocked for this site' : 'no microphone available');
    });
  }

  function share() {
    // Chrome will not do audio-only: video must be requested, and the video track
    // is stopped the moment it arrives so nothing is captured or encoded.
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then(function (s) {
        s.getVideoTracks().forEach(function (t) { t.stop(); });
        if (!s.getAudioTracks().length) {
          // The picker appears whether or not "share tab audio" is ticked, so this
          // is the likeliest outcome by far and it must not read as a broken
          // feature.
          s.getTracks().forEach(function (t) { t.stop(); });
          on = false;
          paint();
          say('no audio in that share — pick a tab and tick "share tab audio"', true);
          return;
        }
        fromStream(s, 'in: shared tab audio');
      })
      .catch(function (e) {
        // A cancelled picker is ordinary and silent. Any OTHER error is ours and
        // must say so: this catch covers the whole then() chain, so a bug in
        // listen() would otherwise be reported as a cancelled share while the page
        // sat there doing nothing.
        if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
          return;
        }
        on = false;
        paint();
        say('capture failed: ' + ((e && (e.name || e.message)) || 'unknown'), true);
      });
  }

  // raVe's other source, and the one that needs no permission at all: the page
  // PLAYS the file, so the analyser sees the signal exactly — no room, no
  // re-recording, no picker.
  function playFile(f) {
    if (on) {
      stop('');
    }
    el = new Audio();
    el.src = URL.createObjectURL(f);
    el.loop = true;
    listen(function (c) { return c.createMediaElementSource(el); },
      'in: ' + f.name, null, true);
    el.play().catch(function () { stop('could not play that file'); });
  }

  return {
    driving: driving,
    isOn: function () { return on; },
    // The four ways in, for the control.
    share: share,
    auto: auto,
    use: useDevice,
    inputs: inputs,
    playFile: playFile,
    isLoopback: function (n) { return LOOPBACK.test(n || ''); },
    off: function () { stop(); },
    // The continuous term, raVe's half of this: bass RMS, 0..1, for anything that
    // wants to scale with loudness rather than fire on a beat.
    level: function () { return on ? rms : 0; },
    seeds: function () { return on ? seedsForLevel() : 0; },
    bpm: function () { return on ? graphTempo.bpm() : 0; },
    confidence: function () { return on ? graphTempo.confidence() : 0; },
    stats: function () { return graphTempo.stats(); },
  };
})();
