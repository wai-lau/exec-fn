/* /zombo — the CSS reproduction's caption crawl, and the one gesture.
 *
 * This file owns the FALLBACK — the reproduction measured off the capture — and
 * the single gesture. Until that click the page is ONLY the begin line: the
 * reproduction and the movie are both built but hidden, so the click reveals
 * and starts rather than unmuting something already on screen.
 * zombo-flash.js owns the real movie and calls zbTakeOver() if it lands.
 *
 * The capture only ever shows one caption ("Sign Up For The NewZLetter"), but
 * the intro's whole substance is the litany the voice reads over the loader, so
 * the line under the loader cycles it. `show` is Title Case with every Z in red,
 * the one typographic rule the original applies; `say` is the line as the voice
 * pronounces it.
 *
 * Same global scope as zombo-audio.js, which owns the bed and the voice.
 */

var zbLines = [
  { show: 'Welcome To Zombo.com', say: 'welcome, to zombo com' },
  { show: 'This Is Zombo.com', say: 'this is zombo com' },
  { show: 'Welcome', say: 'welcome' },
  { show: 'You Can Do Anything At Zombo.com', say: 'you can do anything at zombo com' },
  { show: 'Anything At All', say: 'anything at all' },
  { show: 'The Only Limit Is Yourself', say: 'the only limit, is yourself' },
  { show: 'Welcome To Zombo.com', say: 'welcome, to zombo com' },
  { show: 'The Infinite Is Possible At Zombo.com', say: 'the infinite is possible at zombo com' },
  { show: 'The Unattainable Is Unknown At Zombo.com', say: 'the unattainable is unknown at zombo com' },
  { show: 'Sign Up For The NewZLetter', say: 'sign up, for the newzletter' },
];

var ZB_BEGIN_COPY = 'click anywhere to begin the experience';

var zbLineEl = null;
var zbAt = -1;
var zbTimer = null;
var zbLive = false;   // reproduction's audio armed (needs a gesture)
var zbPlayer = null;  // the Ruffle player, once zombo-flash.js has one
/* Bumped on every line change. A line's fade-out timer and its voice callback
 * both capture the value and bail if it moved, because arming the sound mid-
 * fade restarts the cycle — and without this the abandoned callback would keep
 * its own chain running alongside the new one, advancing the caption twice. */
var zbGen = 0;

/* Title Case line with every Z reddened, built as nodes rather than a markup
 * string so the caption can never be anything but text. */
function zbPaint(text) {
  zbLineEl.textContent = '';
  text.split(/(Z)/).forEach(function (part) {
    if (!part) return;
    var node;
    if (part === 'Z') {
      node = document.createElement('span');
      node.className = 'zb-z';
      node.textContent = part;
    } else {
      node = document.createTextNode(part);
    }
    zbLineEl.appendChild(node);
  });
}

/* One span per character so the CSS can cycle the wordmark's seven hues with
 * :nth-child — the overlay is the only other place the palette is spoken. */
function zbTint(el, text) {
  el.textContent = '';
  text.split('').forEach(function (ch) {
    var s = document.createElement('span');
    s.className = 'zb-c';
    s.textContent = ch;
    el.appendChild(s);
  });
}

/* Fade out, swap, fade in. The next advance is scheduled by whoever knows how
 * long the line lasts: the voice's own end event when sound is on, a fixed
 * cadence when it is off. */
function zbShow(entry, holdMs) {
  var gen = ++zbGen;
  zbLineEl.classList.add('zb-out');
  zbTimer = window.setTimeout(function () {
    if (gen !== zbGen) return;
    zbPaint(entry.show);
    zbLineEl.classList.remove('zb-out');
    if (!zbLive) {
      zbTimer = window.setTimeout(zbAdvance, holdMs);
      return;
    }
    zbSpeak(entry.say, function () {
      if (gen !== zbGen) return;
      zbTimer = window.setTimeout(zbAdvance, 900);
    });
  }, 450);
}

function zbAdvance() {
  window.clearTimeout(zbTimer);
  zbAt = (zbAt + 1) % zbLines.length;
  zbShow(zbLines[zbAt], 3600);
}

/* Start the reproduction: its bed + voice, and the caption cycle. The VISUALS
 * run even when the synth will not — a refused AudioContext is no reason to
 * leave a blank page — so the caption is started unconditionally and zbLive
 * only records whether the voice is actually there to pace it. */
function zbFallbackStart() {
  if (zbAudioStart()) zbLive = true;
  window.clearTimeout(zbTimer);
  zbAdvance();
}

/* The movie is held (Ruffle autoplay 'off') until the gesture, so the one click
 * has to both start it and buy it sound. */
function zbPlay() {
  try {
    if (!zbPlayer) return;
    if (zbPlayer.play) zbPlayer.play();
    if (zbPlayer.unmuteAudio) zbPlayer.unmuteAudio();
  } catch (_e) {
    // an older Ruffle build missing one of them; its own handling applies
  }
}

/* Ruffle got the real movie running, so the reproduction stands down: its
 * timers stop, its synth never starts, and its stage is hidden. If the visitor
 * already clicked, that gesture was spent on the fallback — carry it over, or
 * the overlay is gone and there is nothing left to unmute with. */
function zbTakeOver() {
  zbGen++;
  window.clearTimeout(zbTimer);
  zbLive = false;
  zbAudioStop();
  document.body.classList.add('zb-flashed');
  if (document.body.classList.contains('zb-begun')) zbPlay();
}

/* The one gesture the page asks for. Before it the page is only this line —
 * no wordmark, no loader, no caption — so the click REVEALS and STARTS, rather
 * than just unmuting something already on screen. Whichever path is ready takes
 * it; if Ruffle lands later, zbTakeOver() swaps and plays. */
function zbBegin() {
  if (document.body.classList.contains('zb-begun')) return;
  document.body.classList.add('zb-begun');
  if (zbPlayer) zbPlay(); else zbFallbackStart();
}

function zbInit() {
  zbLineEl = document.getElementById('zb-line');
  var begin = document.getElementById('zb-begin');
  var copy = document.getElementById('zb-begin-copy');
  if (!zbLineEl || !begin || !copy) return;
  zbTint(copy, ZB_BEGIN_COPY);
  begin.addEventListener('click', zbBegin);
  begin.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zbBegin(); }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', zbInit);
} else {
  zbInit();
}
