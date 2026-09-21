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

/* The ONE outbound link in the whole intro. "sign up for the newzletter" is a
 * button in the LOADER swf (the movie itself carries no URL string at all --
 * its type is drawn as glyph shapes), and it is a bare ActionGetURL to
 * `http://www.zombo.com/join1.htm` with an empty target: plain HTTP, to a
 * domain that has not served that page this century. Clicking it navigated the
 * tab off this page to nothing.
 *
 * So the byte string is rewritten before Ruffle ever sees it, and it is done
 * on the BYTES rather than by intercepting the navigation because Ruffle's web
 * navigator reaches for `location.assign` on an empty target, and Location's
 * members are [LegacyUnforgeable] -- own, non-configurable properties that
 * cannot be patched from the page. Patching `window.open` would only cover the
 * named-target case this link does not use.
 *
 * The replacement is the SAME LENGTH, which is the whole trick: the file is
 * uncompressed (FWS), so an equal-length splice needs no ActionGetURL tag
 * length, no DoAction length and no file-length header rewritten. The fragment
 * is padding that happens to say where the visitor came from; the landing
 * ignores it. Nothing of theirs is stored here -- the browser still fetches the
 * file from the host that publishes it, and the edit lives in one ArrayBuffer
 * for the life of the tab. */
var ZB_LINK_FROM = 'http://www.zombo.com/join1.htm';
var ZB_LINK_TO = 'https://wai-lau.net/#fromzombo';

var zbSwfData = null;   // the patched loader, when the fetch + splice worked

function zbFindBytes(bytes, text) {
  var n = text.length;
  var first = text.charCodeAt(0);
  for (var i = 0; i + n <= bytes.length; i++) {
    if (bytes[i] !== first) continue;
    var k = 1;
    while (k < n && bytes[i + k] === text.charCodeAt(k)) k += 1;
    if (k === n) return i;
  }
  return -1;
}

/* Splice in place, or give back null so the caller falls back to letting Ruffle
 * stream the file itself. A miss means the upstream file changed (recompressed,
 * relinked); the dead link is a worse page than this one, not a broken one. */
function zbPatchLink(buf) {
  if (ZB_LINK_TO.length !== ZB_LINK_FROM.length) return null;
  var bytes = new Uint8Array(buf);
  var at = zbFindBytes(bytes, ZB_LINK_FROM);
  if (at < 0) return null;
  for (var k = 0; k < ZB_LINK_TO.length; k++) bytes[at + k] = ZB_LINK_TO.charCodeAt(k);
  return buf;
}

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
    // zombo.js owns the overlay, the gesture and the band behind the letterbox
    zbOnPlayerReady(player);
  });
  /* `data` when the link was rewritten, `url` when it was not. A data load
   * drops Ruffle's own swfUrl, so `base` stops being a refinement and becomes
   * the only thing resolving the loader's relative pull of welcomeclip.swf --
   * it was already required and is still the same value. */
  var opts = zbSwfData
    ? { data: zbSwfData, swfFileName: 'inrozxa.swf', base: ZB_BASE }
    : { url: ZB_SWF, base: ZB_BASE };
  player.load(opts).catch(function () {
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

/* Pull the loader ourselves so its one outbound link can be rewritten (see
 * ZB_LINK_TO). 7.9KB, and Ruffle would have fetched it a moment later anyway;
 * anything that goes wrong here — the fetch, the CORS header, the splice —
 * leaves zbSwfData null and Ruffle streams the original instead. */
function zbFetchLoader() {
  window.fetch(ZB_SWF, { mode: 'cors' }).then(function (r) {
    return r.ok ? r.arrayBuffer() : null;
  }).then(function (buf) {
    if (buf) zbSwfData = zbPatchLink(buf);
    zbLoadRuffle();
  }).catch(function () { zbLoadRuffle(); });
}

/* Ask the upstream host for the clip BEFORE pulling ~1MB of Ruffle WASM. This
 * is the one part of the page that depends on somebody else's server staying
 * up, and a HEAD is the cheap, honest way to find out: if it answers, the whole
 * hotlink chain is healthy and the emulator is worth downloading; if it does
 * not, nothing else is fetched at all and the begin line is the page. It probes
 * the CLIP and not the loader because the loader outliving the movie is the
 * exact shape of the blank-white-rectangle bug. Failure needs no other handler.
 */
function zbFlashInit() {
  try {
    window.fetch(ZB_CLIP, { method: 'HEAD', mode: 'cors' }).then(function (r) {
      if (r.ok) zbFetchLoader();
    }).catch(function () { /* upstream down — the begin line stands alone */ });
  } catch (_e) {
    // no fetch(): nothing to mount, and the page says so rather than guessing
  }
}

zbFlashInit();
