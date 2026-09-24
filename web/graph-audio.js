// /graph — the cascade, timed to whatever is playing. DESKTOP ONLY, by decision.
//
// WHERE THE AUDIO COMES FROM, which is the whole design. A page cannot read the
// device's audio output on iOS at all, and Safari/Firefox do not put audio on a
// getDisplayMedia stream either. Chrome and Edge on the desktop DO: picking a tab
// with "share tab audio" (or a whole screen on Windows) hands over the real
// output. So that is the primary source, and it is the only one that works with
// headphones on.
//
// The MICROPHONE is the fallback, not the first choice. It hears the room, so it
// needs speakers, and it picks up everything else in the room with them. It is
// kept because it is the only source that exists at all where getDisplayMedia
// carries no audio.
//
// The single most common failure is a real one and is reported as such: Chrome
// shows the picker whether or not "share tab audio" is ticked, and an unticked
// box hands back a stream with a video track and NO audio. That looks exactly
// like a broken feature, so it is named.
//
// WHAT raVe DOES, AND WHERE THIS DIFFERS (github.com/ajm13/raVe). raVe is the
// reference for this kind of thing and it does NOT detect beats: it runs the
// signal through a BiquadFilter chain into an AnalyserNode, reads both frequency
// and time-domain data, and maps amplitude continuously onto ring geometry —
// waveforms drawn, not events fired. That works because its output is a shape it
// redraws every frame. Ours is a CASCADE, which is a discrete thing that starts
// somewhere and spreads, so it needs a moment to start ON. Hence onsets decide
// WHEN and raVe's continuous amplitude decides HOW MUCH. The filter-before-the-
// analyser is taken from raVe directly: a lowpass does in the audio thread what
// summing FFT bins does badly on the main one.
//
// COST. Off, this file does nothing: no context, no stream, no rAF. On, it is one
// rAF plus two small reads per frame, with the FFT on the audio thread. What
// actually costs is the cascades it fires — this page's animation is the one
// layer under the CRT stack's two backdrop-filter panes — and that is bounded by
// MIN_GAP_MS here and by the model's own MAX_LIVE.
/* global graphPulse */
var graphAudio = (function () {
  'use strict';

  var FFT = 1024;                 // post-lowpass the band is narrow; 512 bins is plenty
  var CUT_HZ = 200;               // lowpass: the kick band, and nothing above it
  var CUT_Q = 0.7;                // gentle, no resonant peak inventing beats
  var HIST_N = 45;                // ~0.75s of frames = the LOCAL average
  var SENS = 1.32;                // onset = energy over SENS x that average
  var BIG = 1.9;                  // and a second cascade over BIG x it
  var FLOOR = 6;                  // 0..255; under this it counts as silence
  var MIN_GAP_MS = 190;           // debounce -> a ~315bpm ceiling
  var QUIET_MS = 4000;            // silent this long and the ambient clock resumes
  var FLASH_MS = 110;

  var on = false, ctx = null, stream = null, ana = null, freq = null, wave = null;
  var raf = 0, btn = null, note = null, noteT = 0, flash = 0;
  var hist = [], histI = 0, lastBeat = 0, rms = 0;

  function desktop() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
      && !window.matchMedia('(pointer: coarse)').matches;
  }

  // The model's ambient clock asks this before seeding on its own. Enabled is not
  // enough: once the music stops — track ended, tab muted, someone walked away —
  // the page has to hand back to the ambient clock rather than sit still, because
  // a motionless graph is the one thing this page must never look like.
  function driving(now) {
    return on && (now - lastBeat) < QUIET_MS;
  }

  function say(msg, sticky) {
    if (!note) {
      return;
    }
    note.textContent = msg || '';
    note.hidden = !msg;
    clearTimeout(noteT);
    if (msg && !sticky) {
      noteT = setTimeout(function () { say(''); }, 4000);
    }
  }

  function paint() {
    if (!btn) {
      return;
    }
    btn.setAttribute('data-on', on ? '1' : '0');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Listening — the graph lights on the beat'
      : 'Light the graph in time with what is playing';
  }

  function beat(over) {
    if (typeof graphPulse === 'undefined') {
      return;
    }
    // No argument, deliberately. graphPulse.seed(id) is the TAPPED cascade: it
    // guarantees its first hop and draws none of the extra seeds. With no id the
    // model takes its own weighted draw and runs the full ambient burst — eight
    // seeds from one square, staggered — which is the thing worth putting on a
    // beat. raVe's continuous term lands here: a louder onset spends more.
    graphPulse.seed();
    if (over > BIG) {
      graphPulse.seed();
    }
    if (btn) {
      btn.classList.add('gp-beat');
      clearTimeout(flash);
      flash = setTimeout(function () { btn.classList.remove('gp-beat'); }, FLASH_MS);
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
    // shape. It is what a beat's strength is scaled against.
    ana.getByteTimeDomainData(wave);
    var acc = 0;
    for (i = 0; i < wave.length; i++) {
      var v = (wave[i] - 128) / 128;
      acc += v * v;
    }
    rms = Math.sqrt(acc / wave.length);

    var mean = 0;
    for (i = 0; i < hist.length; i++) {
      mean += hist[i];
    }
    mean = hist.length ? mean / hist.length : 0;

    var now = performance.now();
    if (hist.length >= HIST_N && energy > FLOOR && mean > 0
        && energy > mean * SENS && (now - lastBeat) > MIN_GAP_MS) {
      lastBeat = now;
      beat(energy / mean);
    }

    // Written AFTER the test: a loud frame folded in first would raise the very
    // average it is about to be compared against, and the beat tests itself away.
    if (hist.length < HIST_N) {
      hist.push(energy);
    } else {
      hist[histI] = energy;
      histI = (histI + 1) % HIST_N;
    }
  }

  function stop(msg) {
    on = false;
    cancelAnimationFrame(raf);
    clearTimeout(flash);
    if (btn) {
      btn.classList.remove('gp-beat');
    }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (ctx) {
      ctx.close();
    }
    stream = null; ctx = null; ana = null; freq = null; wave = null;
    hist = []; histI = 0; lastBeat = 0; rms = 0;
    paint();
    say(msg || 'ambient');
  }

  // source -> lowpass -> analyser. Never to ctx.destination: the graph is not
  // meant to play the audio back at itself.
  function listen(s, label) {
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
    ctx.createMediaStreamSource(stream).connect(lp).connect(ana);

    // Chrome's own "stop sharing" ends the track, not the page's button.
    stream.getAudioTracks().forEach(function (t) {
      t.addEventListener('ended', function () { stop('sharing ended'); });
    });

    on = true;
    paint();
    say(label);
    raf = requestAnimationFrame(tick);
  }

  function mic(why) {
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      stop(why || 'no audio source available');
      return;
    }
    // All three OFF on purpose. Echo cancellation, auto gain and noise
    // suppression exist to make a voice call intelligible, and every one of them
    // works by flattening the transients a beat IS — autoGainControl will quietly
    // normalise a track's dynamics away. raVe passes a bare `{audio: true}` and
    // inherits whatever the browser defaults to; on a mic that is the processed
    // chain, which is the wrong signal for this.
    md.getUserMedia({
      audio: {
        echoCancellation: false, autoGainControl: false, noiseSuppression: false,
      },
    }).then(function (s) {
      listen(s, 'listening to the room (microphone)');
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
          // The picker appears whether or not the box is ticked, so this is the
          // likeliest outcome by far and it must not read as a broken feature.
          s.getTracks().forEach(function (t) { t.stop(); });
          say('no audio in that share — pick a tab and tick "share tab audio"', true);
          on = false;
          paint();
          return;
        }
        listen(s, 'listening to the shared tab');
      })
      .catch(function () {
        // Cancelled the picker, or a browser that puts no audio on this stream.
        mic('share cancelled');
      });
  }

  function toggle() {
    if (on) {
      stop();
    } else if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      share();
    } else {
      mic();
    }
  }

  return {
    driving: driving,
    // The continuous term, raVe's half of this: bass RMS, 0..1, for anything that
    // wants to scale with loudness rather than fire on a beat.
    level: function () {
      return on ? rms : 0;
    },
    // Built here rather than in graph-overlay.js so the whole feature — control,
    // permission, capture, analysis and seeding — is one file to read or delete.
    init: function () {
      if (btn || !desktop()) {
        return;   // no control where it cannot work; see the header
      }
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'gp-audio';
      btn.className = 'gp-toggle gp-min-btn';
      // A musical note is not in 04b25, which is ASCII-only, so this one control
      // is re-fonted to --font-mono. Same rule and reason as the nav's star.
      btn.textContent = '♪';
      btn.addEventListener('click', toggle);
      note = document.createElement('div');
      note.id = 'gp-audio-note';
      note.hidden = true;
      document.body.appendChild(btn);
      document.body.appendChild(note);
      paint();
    },
  };
})();

// Self-starting, so this feature is genuinely one file: graph-overlay.js does not
// mention it and does not have to. The script is deferred, so the body exists by
// the time this runs, and init() only BUILDS the control — no audio context, no
// stream and no permission prompt until it is tapped. It sits at z-index 41,
// below the loading cover, so it cannot appear over a page that is still loading.
graphAudio.init();
