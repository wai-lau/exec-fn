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
/* global graphPulse, graphTempo, graphAudioUI, graphBands, graphSeed, graphSource */
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

  // HOW HARD THE HIT LANDED, which the onset test was throwing away. `onset` is a
  // boolean -- flux over SENS x the local average -- so a snare at three times the
  // average and one barely over the line produced exactly the same picture. The
  // RATIO is already computed on the way to that boolean and it is the one thing
  // on this page that says how hard something was struck.
  //
  // It is deliberately a SEPARATE channel from `amp`. Amplitude decides HOW MANY
  // nodes a beat lights; strength decides HOW BRIGHTLY each one lights. Two
  // different facts about the sound on two different visual channels beats having
  // both drive the same one, which is what made a quiet passage and a peak differ
  // only in node count -- and count saturates at SEEDS_MAX long before music does.
  var HIT_SPAN = 2.6;             // ratio at or above this is a maximal hit
  // Never zero: a sustained passage sits near ratio 1 and it is still playing.
  // A floor of 0 would make everything between the transients invisible, which is
  // a worse misreport than a flat picture.
  var HIT_FLOOR = 0.45;

  // A ~80ms PEAK HOLD on loudness. `rms` was read on the one frame a fire
  // happened, and with grid firing that instant can land in a trough between two
  // transients -- so a loud beat could be counted quiet. The hold means the count
  // reflects the HIT rather than the sampling moment.
  var HOLD_FALL = 0.78;

  // Music is hierarchical and the visuals were flat: beat 3 looked exactly like
  // the downbeat. The bar gets an accent.
  var DOWNBEAT_BOOST = 1.6;

  // PITCH DECIDES HEIGHT, and the mapping ADAPTS to the material. A raw centroid
  // maps to almost nothing: its log range is 60Hz..8kHz but any real track uses a
  // narrow slice of that, sitting near the middle, so mapping it straight onto the
  // graph's height put every cascade in a band across the centre and left most of
  // the picture permanently dark.
  //
  // The window expands INSTANTLY to admit a new value and contracts SLOWLY toward
  // whatever the music is actually doing, so the full height gets used whatever
  // the material is -- and a track that genuinely narrows its range narrows its
  // band rather than being stretched to fill the screen forever.
  var CENT_RELAX = 0.0008;        // per frame, toward the observed range
  var CENT_MIN_SPAN = 0.06;       // floor, so a steady tone cannot divide by ~0

  // X WALKS, it does not teleport. Independent random X per beat is the thing
  // that read as "too random": every beat landed somewhere unrelated to the last,
  // so a sequence of beats was a scatter rather than a movement. A random WALK
  // keeps successive beats near each other, so the eye follows a travelling locus
  // and the picture looks intentional -- while X still carries no audio meaning,
  // which is what "ignore left and right" asked for.
  var X_STEP = 0.07;              // per fire, as a fraction of the width
  var X_HOME = 0.5;               // and where it starts: the middle

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

  // Capture and device selection live in graph-source.js.

  var on = false, ctx = null, stream = null;
  var raf = 0, el = null;
  var hist = [], histI = 0, lastBeat = 0;
  var rms = 0, hold = 0, peak = PEAK_FLOOR, loud = 0, amp = 0;
  // Held on the same ~80ms envelope as `hold`, and for the same reason: a cascade
  // seeded a frame or two after the transient must still see the transient.
  var ratio = 1;
  // Inverted on purpose: the first reading seeds both ends.
  // The walk STARTS CENTRED. It began at Math.random(), which can land hard left
  // or hard right, so the first bars of a track drifted in from an edge for no
  // reason -- and the reflecting bound means an edge start also spends its first
  // steps bouncing rather than wandering. 0.5 has neither problem.
  var centLo = 1, centHi = 0, xWalk = X_HOME;

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

  // Centroid -> 0..1 against its own observed range: 0 is the lowest pitch this
  // material has shown, 1 the highest. ONE window, shared by the height mapping
  // and by the cascade's edge-length bias, so the two cannot disagree about what
  // counts as "low" for the track that is actually playing.
  function pitchNorm(c) {
    if (c < centLo) {
      centLo = c;
    }
    if (c > centHi) {
      centHi = c;
    }
    var span = centHi - centLo;
    if (span > CENT_MIN_SPAN) {
      centLo += span * CENT_RELAX;
      centHi -= span * CENT_RELAX;
    }
    span = Math.max(centHi - centLo, CENT_MIN_SPAN);
    return Math.min(1, Math.max(0, (c - centLo) / span));
  }

  // Screen Y. Inverted, because bright sounds belong at the TOP.
  function placeY(c) {
    return 1 - pitchNorm(c);
  }

  // A reflecting random walk: it drifts, and it turns back at the edges rather
  // than wrapping, because wrapping would teleport across the whole picture and
  // that is the behaviour being removed.
  function placeX() {
    xWalk += (Math.random() * 2 - 1) * X_STEP;
    if (xWalk < 0) {
      xWalk = -xWalk;
    } else if (xWalk > 1) {
      xWalk = 2 - xWalk;
    }
    return xWalk;
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
    var id = graphSeed.at(placeX(), placeY(b.centroid));
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

    // The same ratio the onset test is about to reduce to a boolean, kept as a
    // number and peak-held so it survives the frame it happened on.
    ratio = Math.max(mean > 0 ? b.flux / mean : 1, 1 + (ratio - 1) * HOLD_FALL);

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
    centLo = 1; centHi = 0; xWalk = X_HOME; ratio = 1;
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
    level: function () { return on ? rms : 0; },
    bands: function () { return graphBands.read(); },
    // Smoothed 0..1: what the cascade's fade rate follows.
    loudness: function () { return on ? loud : 0; },
    seeds: function () { return on ? seedsForLevel(performance.now()) : 0; },
    // 0 = the lowest pitch this material has shown, 1 = the highest. The cascade
    // reads it to bias which EDGES it prefers; 0.5 with nothing playing, so a
    // silent page gets no bias in either direction.
    pitch: function () {
      return on ? pitchNorm(graphBands.read().centroid) : 0.5;
    },
    // 0..1: how hard the most recent transient landed, for anything that wants to
    // draw a hit BRIGHTER rather than draw more of them. 1 with nothing listening,
    // so the ambient animation is unchanged by its existence.
    hit: function () {
      if (!on) {
        return 1;
      }
      var t = (ratio - 1) / (HIT_SPAN - 1);
      return HIT_FLOOR + (1 - HIT_FLOOR) * Math.min(1, Math.max(0, t));
    },
    bpm: function () { return on ? graphTempo.bpm() : 0; },
    confidence: function () { return on ? graphTempo.confidence() : 0; },
    stats: function () { return graphTempo.stats(); },
    // The observed centroid window, for checking the height mapping is
    // actually using the graph rather than a band across its middle.
    centroidRange: function () {
      return { lo: +centLo.toFixed(3), hi: +centHi.toFixed(3) };
    },
  };
})();
