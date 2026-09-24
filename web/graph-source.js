// /graph — WHERE THE SOUND COMES FROM. Loaded before graph-audio.js, which owns
// what the graph does with it.
//
// The seam is the one graph-audio.js's own header already described: acquiring a
// stream is a different subject from analysing one. Nothing here touches an
// AudioContext, an analyser or a canvas — every entry point resolves to a plain
// descriptor `{stream, el, label, audible}` and the caller wires the audio graph.
//
// WHAT IS AVAILABLE, best signal first. A page cannot read the device's audio
// OUTPUT directly: there is no system-audio capture on iOS at all, and Safari and
// Firefox put no audio on a getDisplayMedia stream either.
//
//   file()   a local file the page PLAYS itself. No permission, no picker, no
//            room: the analyser sees the exact signal. raVe's Playlist.js.
//   share()  a shared tab on Chrome/Edge desktop — the real output, and the only
//            capture that works with headphones on.
//   use()    a named input. If the machine exposes its output as a capture device
//            ("Monitor of ...", Stereo Mix, BlackHole) this reaches the speakers
//            with no share prompt. There is no web API for that: it exists only
//            where the machine was set up for it, so it is offered, never assumed.
//   auto()   the loopback device if there is one, else the default microphone.
//
// Failures reject with a `why` tag rather than a message, because the wording is
// the UI's business and this file should not be choosing it.
var graphSource = (function () {
  'use strict';

  // All three processors OFF on purpose. Echo cancellation, auto gain and noise
  // suppression exist to make a voice call intelligible, and every one of them
  // works by flattening the transients a beat IS — autoGainControl in particular
  // will quietly normalise a track's dynamics away. raVe passes a bare
  // `{audio: true}` and inherits the processed chain, which is the wrong signal.
  var RAW = { echoCancellation: false, autoGainControl: false, noiseSuppression: false };

  var LOOPBACK = /monitor of|stereo mix|loopback|what ?u ?hear|blackhole|soundflower|vb-?audio|voicemeeter/i;

  function fail(why) {
    var e = new Error(why);
    e.why = why;
    return e;
  }

  function nameOf(d) {
    return (d && d.label) || '';
  }

  function desc(stream, label) {
    return { stream: stream, el: null, label: label, audible: false };
  }

  function inputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve([]);
    }
    return navigator.mediaDevices.enumerateDevices().then(function (ds) {
      return ds.filter(function (d) { return d.kind === 'audioinput'; });
    }).catch(function () { return []; });
  }

  function use(dev) {
    var want = {
      echoCancellation: false, autoGainControl: false, noiseSuppression: false,
    };
    if (dev && dev.deviceId) {
      want.deviceId = { exact: dev.deviceId };
    }
    return navigator.mediaDevices.getUserMedia({ audio: want }).then(function (s) {
      var n = nameOf(dev) || 'default microphone';
      return desc(s, 'in: ' + n + (LOOPBACK.test(n) ? '  (speaker output)' : ''));
    }).catch(function (e) {
      throw fail(e && e.name === 'NotAllowedError' ? 'denied' : 'no-device');
    });
  }

  return {
    inputs: inputs,
    use: use,
    isLoopback: function (n) { return LOOPBACK.test(n || ''); },

    // Device LABELS are empty until a capture permission has been granted, which
    // is why this opens a stream FIRST and may then re-open on a better device:
    // enumerating up front returns a list of anonymous ids.
    auto: function () {
      var md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) {
        return Promise.reject(fail('no-device'));
      }
      return md.getUserMedia({ audio: RAW }).then(function (s) {
        return inputs().then(function (ds) {
          var hit = null;
          for (var i = 0; i < ds.length; i++) {
            if (LOOPBACK.test(nameOf(ds[i]))) {
              hit = ds[i];
              break;
            }
          }
          if (!hit) {
            return desc(s, 'in: default microphone');
          }
          // Two live captures is two recording indicators for one feature.
          s.getTracks().forEach(function (t) { t.stop(); });
          return use(hit);
        });
      }).catch(function (e) {
        throw e.why ? e : fail(e && e.name === 'NotAllowedError' ? 'denied' : 'no-device');
      });
    },

    share: function () {
      // Chrome will not do audio-only: video must be requested, and the video
      // track is stopped the moment it arrives so nothing is captured or encoded.
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        .then(function (s) {
          s.getVideoTracks().forEach(function (t) { t.stop(); });
          if (!s.getAudioTracks().length) {
            // The picker appears whether or not "share tab audio" is ticked, so
            // this is the likeliest outcome by far and it must not read as a
            // broken feature.
            s.getTracks().forEach(function (t) { t.stop(); });
            throw fail('no-share-audio');
          }
          return desc(s, 'in: shared tab audio');
        })
        .catch(function (e) {
          if (e && e.why) {
            throw e;
          }
          // A cancelled picker is ordinary. Anything else is ours, and must be
          // distinguishable: this catch covers the whole then() chain, so a bug
          // downstream would otherwise be reported as a cancelled share while the
          // page sat there doing nothing.
          throw fail(e && (e.name === 'NotAllowedError' || e.name === 'AbortError')
            ? 'cancelled' : 'failed');
        });
    },

    // The page PLAYS it, so the analyser sees the signal exactly. `audible` is
    // true because createMediaElementSource reroutes the element's output into
    // the graph — without a connection to the destination the page goes silent.
    file: function (f) {
      var el = new Audio();
      el.src = URL.createObjectURL(f);
      el.loop = true;
      return { stream: null, el: el, label: 'in: ' + f.name, audible: true };
    },
  };
})();
