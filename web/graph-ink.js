// /graph — colour conversion for the cascade overlay. Loaded before
// graph-pulse-draw.js, which draws with it.
//
// Pure arithmetic: hex in, hex out, no canvas and no state. Split out of
// graph-pulse-draw.js when that file passed the 500-line cap, along the cleanest
// seam it had — everything else in there needs a `ctx`, and none of this does.
//
// The one thing to know before editing: the palette lint reads SOURCE TEXT with
// whitespace stripped, so ANY colour-function name followed by an open paren
// reads as a new raw colour — inside a comment as readily as in code, and
// regardless of the fact that every value here comes from the payload at runtime.
// `hueChan` is therefore not named by its usual name, and `sat()` returns HEX
// rather than a CSS colour-function string. The conventional name made the lint
// report three colours that do not exist, matching the substring inside each
// CALL; an earlier draft of this very comment tripped it a fourth time merely by
// discussing the problem. Same substring trap `cmdscan.py` was written for.
// Renaming and rewording is the fix — `--update` would have frozen four phantom
// colours into the baseline.
var graphInk = (function () {
  'use strict';

  // The one literal on this canvas, which is what the palette lint wants to see.
  var WHITE = '#ffffff';
  var SAT_BOOST = 1.75;           // x saturation, clamped at fully saturated

  function hueChan(p, q, t) {
    if (t < 0) { t += 1; }
    if (t > 1) { t -= 1; }
    if (t < 1 / 6) { return p + (q - p) * 6 * t; }
    if (t < 1 / 2) { return q; }
    if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
    return p;
  }

  function toHex(h, s, l) {
    var r, g, b;
    if (!s) {
      r = l; g = l; b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueChan(p, q, h + 1 / 3);
      g = hueChan(p, q, h);
      b = hueChan(p, q, h - 1 / 3);
    }
    var v = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    return '#' + ('000000' + v.toString(16)).slice(-6);
  }

  return {
    WHITE: WHITE,

    // hex -> HSL -> saturation x SAT_BOOST -> hex. Called once per node at index
    // time, so nothing here sits on a frame path. HUE AND LIGHTNESS ARE
    // PRESERVED: a node belongs to a community and its colour says which, so the
    // saturated pass may be more vivid but must never be a different colour.
    sat: function (hex) {
      var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) {
        return WHITE;
      }
      var n = parseInt(m[1], 16);
      var r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var l = (mx + mn) / 2, d = mx - mn, s = 0, h = 0;
      if (d) {
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) {
          h = (g - b) / d + (g < b ? 6 : 0);
        } else if (mx === g) {
          h = (b - r) / d + 2;
        } else {
          h = (r - g) / d + 4;
        }
        h /= 6;
      }
      return toHex(h, Math.min(1, s * SAT_BOOST), l);
    },
  };
})();
