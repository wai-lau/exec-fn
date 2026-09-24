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
/* global graphPulse, graphTempo, graphAudioUI, graphBands, graphSeed, graphSource,
   graphNorm */
var graphAudio = (function () {
  'use strict';

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

  // EVERY ADAPTIVE WINDOW LIVES IN graph-norm.js -- level, pitch, timbre, onset
  // strength and the placement walk, which are one subject: no raw measurement out
  // of graph-bands.js means anything in absolute terms, so each is normalised
  // against its own observed history before the visuals see it. This file measures
  // onsets, keeps time and decides when to fire; it reads those terms rather than
  // owning them, and the exports at the bottom are the page's one door onto them.

  // Music is hierarchical and the visuals were flat: beat 3 looked exactly like
  // the downbeat. The bar gets an accent -- scaled by how much the tempo lock is
  // BELIEVED (graphTempo.barAccent), so the page accents a bar exactly as much as
  // it thinks there is one, instead of asserting the same certainty about a bar it
  // half-guessed as about one it is sure of.
  var DOWNBEAT_BOOST = 1.6;

  // How many starting points a beat gets. Level is judged against a DECAYING PEAK
  // rather than an absolute number, because a shared tab and a microphone across a
  // room arrive at wildly different amplitudes and neither is wrong; what matters
  // is loud FOR THIS SOURCE. The peak decays so a track that gets quieter is not
  // judged against its own loudest moment for the rest of its life.
  // 2..8, down from 4..20. With BEAT_BOOST and DOWNBEAT_BOOST on top, the old
  // range asked for up to 80 seeds on a loud downbeat (clamped to 48), which with
  // a wide pool lit a large fraction of the graph every beat -- and a burst that
  // covers everything says nothing about anything.
  var SEEDS_MIN = 2, SEEDS_MAX = 8;
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

  // Capture and device selection live in graph-source.js.

  var on = false, ctx = null, stream = null;
  var raf = 0, el = null;
  var lastBeat = 0;

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
    var amp = graphNorm.amp();
    var boost = 1 + (BEAT_BOOST - 1) * amp * beat;
    var n = (SEEDS_MIN + amp * (SEEDS_MAX - SEEDS_MIN)) * boost;
    // The bar gets an accent. Counting beats is only as good as the phase lock and
    // nothing here claims to know where bar ONE is -- only that every fourth fire
    // is the same position in the bar as the one four before it, which is enough
    // to put a pulse in the picture. How MUCH of a pulse is the lock's confidence.
    n *= 1 + (DOWNBEAT_BOOST - 1) * graphTempo.barAccent();
    return Math.round(n);
  }

  function fire() {
    if (typeof graphPulse === 'undefined') {
      return;
    }
    // PITCH DECIDES HEIGHT. X IS RANDOM, DELIBERATELY.
    //
    // Pan drove X for one commit and it was wrong twice over: a mixed track sits
    // near centre, so `(pan + 1) / 2` was ~0.5 almost always, and with the raw
    // centroid also sitting mid-range every cascade seeded within a few nodes of
    // the middle -- a vertical column with most of the graph never lighting at
    // all. Pan is still MEASURED (graphBands, for the readout) and deliberately
    // not used here; left-and-right carries nothing.
    //
    // Random X is not a placeholder. It is what makes the whole width available,
    // so height stays the one axis that MEANS something: a rising line climbs the
    // picture, and nothing competes with it for the eye.
    var b = graphBands.read();
    var id = graphSeed.at(graphNorm.placeX(), graphNorm.placeY(b.centroid));
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
    // Every adaptive window folded forward for this frame, before anything reads
    // back off them.
    graphNorm.step(b);

    var now = performance.now();
    // Tempo on BASS energy: a kick's periodicity is the clearest thing in most
    // music, where flux is periodic at every subdivision at once.
    graphTempo.push(now, b.bass * 255);

    // The onset threshold is the LOCAL average of FLUX, not a fixed number, so it
    // follows a quiet room or a loud one with no sensitivity setting to get wrong.
    // graph-norm.js keeps that average and hands back the ratio against it; the
    // BOOLEAN is this file's, and so is what counts as loud enough to bother with.
    var onset = graphNorm.ready() && b.flux > FLUX_FLOOR
      && graphNorm.fluxRatio() > SENS && (now - lastBeat) > MIN_GAP_MS;
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
    graphNorm.reset();
    lastBeat = 0;
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

  // One place turns a descriptor from graph-source.js into a running analysis.
  function open(d) {
    listen(function (c) {
      return d.el ? c.createMediaElementSource(d.el)
        : c.createMediaStreamSource(d.stream);
    }, d.label, d.stream, d.audible);
    if (d.el) {
      el = d.el;
      d.el.play().catch(function () { stop('could not play that file'); });
    }
  }

  // The wording is this layer's business, not graph-source.js's: it rejects with
  // a `why` tag and nothing else, so the same failure can be phrased differently
  // here without touching the capture code.
  var WHY = {
    denied: 'microphone blocked for this site',
    'no-device': 'no microphone available',
    'no-share-audio': 'no audio in that share — pick a tab and tick "share tab audio"',
    failed: 'capture failed',
  };

  function refuse(e) {
    var why = (e && e.why) || 'failed';
    if (why === 'cancelled') {
      return;                     // an ordinary dismissal says nothing
    }
    on = false;
    paint();
    say(WHY[why] || WHY.failed, true);
  }

  return {
    driving: driving,
    isOn: function () { return on; },
    // The four ways in, for the control.
    share: function () { graphSource.share().then(open).catch(refuse); },
    auto: function () { graphSource.auto().then(open).catch(refuse); },
    use: function (d) { graphSource.use(d).then(open).catch(refuse); },
    inputs: graphSource.inputs,
    playFile: function (f) {
      if (on) {
        stop('');
      }
      open(graphSource.file(f));
    },
    isLoopback: graphSource.isLoopback,
    off: function () { stop(); },
    // The continuous term, raVe's half of this: bass RMS, 0..1, for anything that
    // wants to scale with loudness rather than fire on a beat.
    level: function () { return on ? graphNorm.rms() : 0; },
    bands: function () { return graphBands.read(); },
    // Smoothed 0..1: what the cascade's fade rate follows.
    loudness: function () { return on ? graphNorm.loud() : 0; },
    seeds: function () { return on ? seedsForLevel(performance.now()) : 0; },
    // 0 = the lowest pitch this material has shown, 1 = the highest. The cascade
    // reads it to bias which EDGES it prefers; 0.5 with nothing playing, so a
    // silent page gets no bias in either direction.
    pitch: function () {
      return on ? graphNorm.pitch(graphBands.read().centroid) : 0.5;
    },
    // 0..1: how hard the most recent transient landed, for anything that wants to
    // draw a hit BRIGHTER rather than draw more of them. 1 with nothing listening,
    // so the ambient animation is unchanged by its existence.
    hit: function () { return on ? graphNorm.hit() : 1; },
    // 0 = as bass-weighted as this material gets, 1 = as treble-weighted. 0.5 with
    // nothing listening, which is the exact centre of the mapping that reads it, so
    // silence bends no timing in either direction.
    sharpness: function () { return on ? graphNorm.sharpness() : 0.5; },
    // 0..1, how much low end just landed. 0 with nothing listening, so the draw
    // half's swell multipliers all collapse to 1.
    bloom: function () { return on ? graphNorm.bloom() : 0; },
    // 0..1, how much bar accent this instant has earned: a downbeat, scaled by how
    // much the tempo lock is believed. 0 with nothing listening.
    accent: function () { return on ? graphTempo.barAccent() : 0; },
    // Where the adaptive band splits currently sit, for the readout. null when
    // nothing is listening, so the line has nothing to append rather than a pair
    // of stale numbers that read as a measurement.
    crossovers: function () { return on ? graphBands.crossovers() : null; },
    bpm: function () { return on ? graphTempo.bpm() : 0; },
    confidence: function () { return on ? graphTempo.confidence() : 0; },
    stats: function () { return graphTempo.stats(); },
    // The observed centroid window, for checking the height mapping is
    // actually using the graph rather than a band across its middle.
    centroidRange: graphNorm.centroidRange,
  };
})();
