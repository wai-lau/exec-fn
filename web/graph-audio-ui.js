// /graph — the audio control: the button, the name of the live input, and the
// source picker. Loaded AFTER graph-audio.js, which owns capture and analysis and
// calls back here through three functions (say / paint / flash).
//
// The seam: this file knows what a click means and what the reader is told. It
// knows nothing about analysers, onsets or tempo, which is what lets the source
// list grow without touching a line of the arithmetic.
//
// WHY A PICKER. Which input is live is not guessable from the outside — a monitor
// device, a headset mic and a shared tab look identical on screen and sound
// nothing alike to the analysis. So the source is NAMED while it runs and CHOSEN
// here, never inferred.
/* global graphAudio */
var graphAudioUI = (function () {
  'use strict';

  var FLASH_MS = 110;
  var btn = null, note = null, noteT = 0, flashT = 0, menu = null;
  var srcLabel = '', liveT = 0;

  // Desktop only, by decision. No control where it could not work, rather than a
  // control that explains itself after being tapped.
  function desktop() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
      && !window.matchMedia('(pointer: coarse)').matches;
  }

  function say(msg, sticky) {
    if (!note) {
      return;
    }
    // A sticky message IS the source name, so it is remembered: the live line is
    // rebuilt from it every half second to hang the detected tempo off it.
    if (sticky) {
      srcLabel = msg || '';
    }
    note.textContent = msg || '';
    note.hidden = !msg;
    clearTimeout(noteT);
    // While capture runs the note is the readout of WHICH input is live, so it
    // stays up. Only transient messages time out.
    if (msg && !sticky) {
      noteT = setTimeout(function () { say(''); }, 4000);
    }
  }

  // Source + detected tempo. The BPM is polled rather than pushed because it is
  // the product of a once-a-second estimate, not an event, and a readout that
  // updates on its own schedule cannot be wired to the wrong one.
  function liveLine() {
    if (!note || !graphAudio.isOn()) {
      return;
    }
    var bpm = graphAudio.bpm();
    // 0 means no lock: say so rather than showing a stale number or a zero, both
    // of which read as a measurement.
    note.textContent = srcLabel + (bpm ? '   \u00b7   ' + bpm + ' bpm'
      : '   \u00b7   finding the beat\u2026');
    note.hidden = false;
  }

  function paint(on) {
    clearInterval(liveT);
    if (on) {
      liveLine();
      liveT = setInterval(liveLine, 500);
    }
    if (!btn) {
      return;
    }
    btn.setAttribute('data-on', on ? '1' : '0');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Listening — the graph lights on the beat'
      : 'Light the graph in time with what is playing';
  }

  function flash() {
    if (!btn) {
      return;
    }
    btn.classList.add('gp-beat');
    clearTimeout(flashT);
    flashT = setTimeout(function () { btn.classList.remove('gp-beat'); }, FLASH_MS);
  }

  // ── the picker ───────────────────────────────────────────────────────────

  function closeMenu() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function row(text, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'gp-src';
    b.textContent = text;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMenu();
      fn();
    });
    menu.appendChild(b);
  }

  function addDevices(ds) {
    if (!menu) {
      return;
    }
    if (!ds.length || !ds[0].label) {
      // Labels are blank until a capture permission has been granted, so the list
      // is useless until then. Say why rather than showing anonymous rows.
      row('list inputs…', function () {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
          s.getTracks().forEach(function (t) { t.stop(); });
          openMenu();
        }).catch(function () { say('microphone blocked for this site'); });
      });
      return;
    }
    ds.forEach(function (d) {
      var n = d.label;
      row(n + (graphAudio.isLoopback(n) ? '   ← speaker output' : ''),
        function () { graphAudio.use(d); });
    });
  }

  function openMenu() {
    closeMenu();
    menu = document.createElement('div');
    menu.id = 'gp-audio-menu';
    document.body.appendChild(menu);
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      row('shared tab audio', graphAudio.share);
    }
    row('auto  (speaker output if there is one)', graphAudio.auto);
    graphAudio.inputs().then(addDevices);
    // Any click elsewhere dismisses it. Deferred, or the click that OPENED the
    // menu closes it again on its way back up the tree.
    setTimeout(function () {
      document.addEventListener('click', closeMenu, { once: true });
    }, 0);
  }

  function toggle(e) {
    if (e) {
      e.stopPropagation();
    }
    if (graphAudio.isOn()) {
      closeMenu();
      graphAudio.off();
    } else {
      openMenu();
    }
  }

  return {
    say: say,
    paint: paint,
    flash: flash,
    init: function () {
      if (btn || !desktop()) {
        return;
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
      // Dropping a file needs no permission and no picker, so it is wired
      // whatever the capture APIs offer. dragover must be cancelled or the browser
      // navigates to the file instead of handing it over.
      window.addEventListener('dragover', function (e) { e.preventDefault(); });
      window.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || f.type.indexOf('audio/') !== 0) {
          return;
        }
        e.preventDefault();
        graphAudio.playFile(f);
      });
      paint(false);
    },
  };
})();

graphAudioUI.init();
