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

var ZB_BEGIN_COPY = 'click Anywhere to Begin the.experience';
var zbPlayer = null;    // the Ruffle player, once zombo-flash.js has one
var zbClicked = false;  // the gesture is remembered, so a late mount can spend it

/* One span per character so the CSS can cycle the wordmark's seven hues with
 * :nth-child. */
function zbTint(el, text) {
  el.textContent = '';
  text.split('').forEach(function (ch) {
    var s = document.createElement('span');
    s.className = 'zb-c';
    s.textContent = ch;
    el.appendChild(s);
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
