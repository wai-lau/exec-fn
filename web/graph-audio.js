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
/* global graphPulse, graphTempo, graphAudioUI, graphBands, graphSeed */
var graphAudio = (function () {
  'use strict';

  var HIST_N = 45;                // ~0.75s of frames = the LOCAL average
  var SENS = 1.32;                // onset = flux over SENS x that average
  var FLUX_FLOOR = 0.002;         // under this the room counts as silent
  var MIN_GAP_MS = 190;           // debounce -> a ~315bpm ceiling
  // ONSETS ARE SPECTRAL FLUX now, not band energy. An energy rise misses an onset
  // that changes timbre without getting louder, and it re-triggers on sustained
  // bass; flux is the sum of POSITIVE bin-to-bin changes, which is the standard
  // onset function and costs one extra pass over bins we already have.
  //
  // TEMPO still runs on BASS energy, deliberately: a kick's periodicity is the
  // clearest thing in most music, and flux is periodic at every subdivision at
  // once, which is exactly what an autocorrelation should not be fed.

  // A ~80ms PEAK HOLD on loudness. `rms` was read on the one frame a fire
  // happened, and with grid firing that instant can land in a trough between two
  // transients -- so a loud beat could be counted quiet. The hold means the count
  // reflects the HIT rather than the sampling moment.
  var HOLD_FALL = 0.78;

  // Music is hierarchical and the visuals were flat: beat 3 looked exactly like
  // the downbeat. The bar gets an accent.
  var DOWNBEAT_BOOST = 1.6;

  // How many starting points a beat gets. Level is judged against a DECAYING PEAK
  // rather than an absolute number, because a shared tab and a microphone across a
  // room arrive at wildly different amplitudes and neither is wrong; what matters
  // is loud FOR THIS SOURCE. The peak decays so a track that gets quieter is not
  // judged against its own loudest moment for the rest of its life.
  var SEEDS_MIN = 4, SEEDS_MAX = 20;
  // 0.99995, from 0.999. The old value fell to 1/e in about 17 seconds, so a quiet
  // intro renormalised to "full" within seconds and the DROP did not look like a
  // drop -- the track's dynamic arc, which is the most legible thing in music, was
  // being removed by the AGC. At this rate the reference spans minutes, so the
  // loud parts of a track read as loud RELATIVE TO THE TRACK.
  var PEAK_DECAY = 0.99995;
  var PEAK_FLOOR = 0.02;          // so silence cannot divide by nothing
  // Amplitude and rhythm are MULTIPLIED, not added. Loud ON the beat is the moment
  // worth spending the graph on, and neither term says that alone: a loud
  // off-grid noise is a noise, and a quiet tick exactly on the grid is a tick.
  // Their product is the only thing that means "the track just landed".
  //
  // The boost applies on top of the amplitude count, so a full-level hit dead on
  // the beat asks for BEAT_BOOST times what its loudness alone would have bought.
  // It is scaled BY the amplitude as well, so an on-beat whisper gets no boost —
  // otherwise every grid point would bloom regardless of what was played on it.
  var BEAT_BOOST = 2.5;

  // A SMOOTHED loudness, for anything that needs "is the music playing" rather
  // than "how loud is this instant". Instantaneous RMS is near zero between two
  // kicks, so the cascade's fade clock — which decays fast when quiet — would
  // race away in the gaps inside a bar and undo the whole point. This is an
  // envelope follower: every kick tops it back up, and it takes about 1.5s of real
  // silence to fall away, which is the gap between tracks and not the gap between
  // beats.
  var LOUD_FALL = 0.97;           // per frame; ~1.5s from full to nothing at 60fps

  // All three processors OFF on purpose. Echo cancellation, auto gain and noise
  // suppression exist to make a voice call intelligible, and every one of them
  // works by flattening the transients a beat IS — autoGainControl in particular
  // will quietly normalise a track's dynamics away. raVe passes a bare
  // `{audio: true}` and inherits the processed chain, which is the wrong signal.
  var RAW = { echoCancellation: false, autoGainControl: false, noiseSuppression: false };

  var LOOPBACK = /monitor of|stereo mix|loopback|what ?u ?hear|blackhole|soundflower|vb-?audio|voicemeeter/i;

  var on = false, ctx = null, stream = null;
  var raf = 0, el = null;
  var hist = [], histI = 0, lastBeat = 0;
  var rms = 0, hold = 0, peak = PEAK_FLOOR, loud = 0, amp = 0;

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

  function seedsForLevel(now) {
    var beat = graphTempo.onBeat(now);
    var boost = 1 + (BEAT_BOOST - 1) * amp * beat;
    var n = (SEEDS_MIN + amp * (SEEDS_MAX - SEEDS_MIN)) * boost;
    // The bar gets an accent. Counting beats is only as good as the phase lock and
    // nothing here claims to know where bar ONE is -- only that every fourth fire
    // is the same position in the bar as the one four before it, which is enough
    // to put a pulse in the picture.
    if (graphTempo.isDownbeat()) {
      n *= DOWNBEAT_BOOST;
    }
    return Math.round(n);
  }

  function fire() {
    if (typeof graphPulse === 'undefined') {
      return;
    }
    // WHERE, not just how many. Seeding used to be a uniform random draw over the
    // whole graph, so the spatial pattern was noise and two different songs at the
    // same tempo and level produced statistically identical pictures.
    //
    // pan -> X and brightness -> Y, because both readings are already spatial
    // metaphors the eye accepts without being told: left is left, and a spectrum
    // is drawn with the low end at the bottom. Centroid is INVERTED for that
    // reason -- bright sounds belong at the top.
    var b = graphBands.read();
    var id = graphSeed.at((b.pan + 1) / 2, 1 - b.centroid);
    graphPulse.seedAt(id, seedsForLevel(performance.now()));
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

    var b = graphBands.read();
    rms = b.rms;

    // PEAK HOLD, then the slow reference. `hold` is what the seed count reads, so
    // a fire landing between two transients still sees the hit; `peak` spans
    // minutes, so a track's own dynamics survive instead of being normalised flat.
    hold = Math.max(rms, hold * HOLD_FALL);
    peak = Math.max(rms, Math.max(PEAK_FLOOR, peak * PEAK_DECAY));
    amp = Math.min(1, hold / peak);
    loud = Math.max(amp, loud * LOUD_FALL);

    var now = performance.now();
    // Tempo on BASS energy: a kick's periodicity is the clearest thing in most
    // music, where flux is periodic at every subdivision at once.
    graphTempo.push(now, b.bass * 255);

    // The onset threshold is the LOCAL average of FLUX, not a fixed number, so it
    // follows a quiet room or a loud one with no sensitivity setting to get wrong.
    var mean = 0, i;
    for (i = 0; i < hist.length; i++) {
      mean += hist[i];
    }
    mean = hist.length ? mean / hist.length : 0;

    var onset = hist.length >= HIST_N && b.flux > FLUX_FLOOR && mean > 0
      && b.flux > mean * SENS && (now - lastBeat) > MIN_GAP_MS;
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
      hist.push(b.flux);
    } else {
      hist[histI] = b.flux;
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
    stream = null; ctx = null;
    graphBands.detach();
    hist = []; histI = 0; lastBeat = 0;
    rms = 0; hold = 0; peak = PEAK_FLOOR; loud = 0; amp = 0;
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
    // NO LOWPASS. There was one at 200Hz, and it meant everything above that was
    // discarded before analysis: a snare, a hat, a vocal, a lead and a chord
    // change were all invisible, and -- worse, because it is a misreport rather
    // than a limitation -- "loudness" was BASS loudness, so a bright loud passage
    // with no low end read as quiet and got fewer seeds and a faster decay.
    // graph-bands.js takes the full spectrum and splits it.
    var src = make(ctx);
    graphBands.attach(ctx, src);
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
    bands: function () { return graphBands.read(); },
    // Smoothed 0..1: what the cascade's fade rate follows.
    loudness: function () { return on ? loud : 0; },
    seeds: function () { return on ? seedsForLevel(performance.now()) : 0; },
    bpm: function () { return on ? graphTempo.bpm() : 0; },
    confidence: function () { return on ? graphTempo.confidence() : 0; },
    stats: function () { return graphTempo.stats(); },
  };
})();
