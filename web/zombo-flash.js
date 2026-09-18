/* /zombo — the REAL 1999 Flash movie, under the Ruffle emulator.
 *
 * The .swf files are HOTLINKED from welcometozombo.com, never mirrored here:
 * that host serves `access-control-allow-origin: *` on its page and on all
 * three .swf files, which is the server saying yes to exactly this. Mirroring
 * them would mean committing ~350KB of someone else's unlicensed Flash into
 * this repo, and there is no need — the visitor's browser fetches them from the
 * host that already publishes them.
 *
 * The movie is loaded but HELD (autoplay 'off'): until the click the page is
 * only the begin line, and that click both starts playback and unmutes it.
 * Ruffle's own unmute control is a speaker BUTTON, chrome the intro never had,
 * so it is suppressed (`unmuteOverlay: 'hidden'`) and #zb-begin takes its
 * place.
 */

var ZB_BASE = 'https://welcometozombo.com/';
var ZB_SWF = ZB_BASE + 'inrozxa.swf';
/* `inrozxa.swf` is only a 7.9KB LOADER — the movie itself is welcomeclip.swf,
 * which it pulls by a RELATIVE path. Without `base` below, Ruffle resolves that
 * against the page, so the loader 404s on wai-lau.net/welcomeclip.swf and plays
 * a blank 1360-frame white rectangle while `load()` resolves perfectly happily.
 * That is also why this file probes the clip before committing to anything. */
var ZB_CLIP = ZB_BASE + 'welcomeclip.swf';
var ZB_RUFFLE = 'https://cdn.jsdelivr.net/npm/@ruffle-rs/ruffle@0.6.0/ruffle.min.js';

function zbFlashMount() {
  var host = document.getElementById('zb-flash');
  var rp = window.RufflePlayer;
  if (!host || !rp || typeof rp.newest !== 'function') return;
  var player;
  try {
    player = rp.newest().createPlayer();
  } catch (_e) {
    return;
  }
  host.appendChild(player);
  /* Take over on `loadedmetadata`, NOT on the load() promise: load() resolves
   * while `player.metadata` is still null, so anything that reads metadata
   * there is a race — and a version of this that treated the empty metadata as
   * failure tore down a perfectly healthy player. The event is the signal that
   * the movie is real and has dimensions. */
  player.addEventListener('loadedmetadata', function () {
    // zombo.js owns the reproduction, the overlay and the gesture
    zbPlayer = player;
    zbTakeOver();
  });
  player.load({ url: ZB_SWF, base: ZB_BASE }).catch(function () {
    player.remove();
  });
}

function zbLoadRuffle() {
  window.RufflePlayer = window.RufflePlayer || {};
  window.RufflePlayer.config = {
    /* 'off', not 'on': the page shows only the begin line until the click, so
     * the movie must START there rather than be revealed part-way through.
     * zbPlay() in zombo.js does the play()+unmuteAudio() on that one gesture. */
    autoplay: 'off',
    unmuteOverlay: 'hidden',
    splashScreen: false,
    salign: 'T',           // the original <embed> top-aligns the movie
    contextMenu: 'off',
    warnOnUnsupportedContent: false,
  };
  var s = document.createElement('script');
  s.src = ZB_RUFFLE;
  s.onload = zbFlashMount;
  document.head.appendChild(s);
}

/* Ask the upstream host for the clip BEFORE pulling ~1MB of Ruffle WASM. This
 * is the one part of the page that depends on somebody else's server staying
 * up, and a HEAD is the cheap, honest way to find out: if it answers, the whole
 * hotlink chain is healthy and the emulator is worth downloading; if it does
 * not, nothing is fetched and the CSS reproduction simply keeps running, which
 * it has been doing since the page painted. Failure needs no other handler.
 */
function zbFlashInit() {
  try {
    window.fetch(ZB_CLIP, { method: 'HEAD', mode: 'cors' }).then(function (r) {
      if (r.ok) zbLoadRuffle();
    }).catch(function () { /* upstream down — the reproduction stands */ });
  } catch (_e) {
    // no fetch(): leave the reproduction running rather than guess
  }
}

zbFlashInit();
