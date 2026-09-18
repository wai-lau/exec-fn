/* /zombo — the begin line, and the one gesture.
 *
 * Until the click the page is white paper and this line. The click reveals the
 * mounted movie and starts it with sound; zombo-flash.js owns the mount itself
 * and hands the player over here via zbOnPlayerReady().
 *
 * There is no fallback any more. The page used to draw a CSS reproduction of
 * the intro underneath (wordmark, loader, caption crawl) with a synthesised bed
 * and voice; all of it was removed 2026-09-17 along with zombo-audio.js. If the
 * movie cannot mount, the line says so — this page shows the real thing or it
 * shows nothing.
 */

var ZB_BEGIN_COPY = 'click Anywhere to\nBegin the.experience';
var zbPlayer = null;    // the Ruffle player, once zombo-flash.js has one
var zbClicked = false;  // the gesture is remembered, so a late mount can spend it

/* The wordmark's own colour sequence -- Z o m b o . c o m -- as an index, plus
 * five baseline offsets so the line reads hand-set rather than typeset. Nine
 * against five means the pair only repeats every 45 characters.
 *
 * Assigned as CLASSES from a running index, not by :nth-child. Two reasons, and
 * the first one is a bug that shipped: a line BREAK is an element child too, so
 * the moment the copy gained one every :nth-child cycle after it shifted by one
 * and a handful of letters fell through every rule to the default ink -- the
 * black letters. And a word wrapper (below) nests the spans, so they are no
 * longer all siblings of one parent and the positional match breaks outright.
 * An explicit index is immune to both. */
var ZB_HUES = 9;
var ZB_JITTERS = 5;

/* Per-character spans, wrapped a word at a time. The wrapper is what stops a
 * break landing mid-word: every character is its own inline-block, so without
 * it the line wrapped between any two letters ("exp / erience"). */
function zbTint(el, text) {
  el.textContent = '';
  var i = 0;
  text.split('\n').forEach(function (line, ln) {
    if (ln) el.appendChild(document.createElement('br'));
    line.split(' ').forEach(function (word, wn) {
      if (wn) { el.appendChild(document.createTextNode(' ')); i += 1; }
      var w = document.createElement('span');
      w.className = 'zb-w';
      word.split('').forEach(function (ch) {
        var c = document.createElement('span');
        c.className = 'zb-c zb-h' + (i % ZB_HUES) + ' zb-j' + (i % ZB_JITTERS);
        c.textContent = ch;
        w.appendChild(c);
        i += 1;
      });
      el.appendChild(w);
    });
  });
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

/* How many of the movie's own edge columns get stretched across each pillar.
 * A few rather than one: a single column picks up whatever dithering happens to
 * be on that pixel, a handful averages into the flat band the movie actually
 * has there. */
var ZB_SAMPLE = 6;

/* Fill the pillars beside the fitted movie with the movie's own edge pixels, so
 * the green header wash runs to the screen edges and keeps doing so as the
 * movie animates. Ruffle renders into a canvas in its shadow root; this stretches
 * a few columns of that canvas across each bar every frame. */
function zbPaintBars() {
  var root = zbPlayer && zbPlayer.shadowRoot;
  var src = root && root.querySelector('canvas');
  if (src && src.width > ZB_SAMPLE && src.height) {
    [['zb-bar-l', 0], ['zb-bar-r', src.width - ZB_SAMPLE]].forEach(function (pair) {
      var bar = document.getElementById(pair[0]);
      if (!bar || !bar.clientWidth || !bar.clientHeight) return;
      if (bar.width !== bar.clientWidth) bar.width = bar.clientWidth;
      if (bar.height !== bar.clientHeight) bar.height = bar.clientHeight;
      try {
        bar.getContext('2d').drawImage(src, pair[1], 0, ZB_SAMPLE, src.height,
                                       0, 0, bar.width, bar.height);
      } catch (_e) {
        // a tainted or unreadable backing buffer: leave the bar as paper
      }
    });
  }
  window.requestAnimationFrame(zbPaintBars);
}

function zbStart() {
  document.body.classList.add('zb-begun');
  zbPlay();
  window.requestAnimationFrame(zbPaintBars);
}

/* The movie mounted. If the visitor already clicked, that gesture was spent on
 * a page with nothing to start — spend it now, or nothing ever would. */
function zbOnPlayerReady(player) {
  zbPlayer = player;
  if (zbClicked) zbStart();
}

/* The one gesture the page asks for. Clicking before the movie has mounted is
 * not a no-op and not an error: the click is remembered, the line says what is
 * happening, and zbOnPlayerReady() starts it the moment it lands. */
function zbBegin() {
  if (zbClicked) return;
  zbClicked = true;
  if (zbPlayer) {
    zbStart();
    return;
  }
  /* Blank, not a status line: at click time a missing player is equally a movie
   * still downloading, so any wording would be a guess. The click is already
   * remembered and zbOnPlayerReady() spends it the moment the movie lands. */
  var copy = document.getElementById('zb-begin-copy');
  if (copy) copy.textContent = '';
}

function zbInit() {
  var begin = document.getElementById('zb-begin');
  var copy = document.getElementById('zb-begin-copy');
  if (!begin || !copy) return;
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
