// /graph — THE SURFACE THE OVERLAY DRAWS ON. Loaded before graph-pulse-draw.js,
// which owns the ink and the paint order and asks this file for a context.
//
// The seam: nothing here knows what a cascade is, what a charge is, how bright
// anything should be or what order the passes run in. It owns the canvas element,
// its backing store, where it sits over the graph, and what colour the page behind
// it actually is. Split out of graph-pulse-draw.js at the 500-line cap, and it is
// the seam that file kept coming back to — everything else in it is pixels with an
// opinion, and this is the pixels' address.
//
// TWO THINGS HERE HAVE BITTEN, both recorded in ARCHAEOLOGY.md §11, and both are
// the same mistake: trusting a value that used to be right.
var graphSurface = (function () {
  'use strict';

  // Is a computed colour FULLY TRANSPARENT? Decided by counting components, not by
  // matching the tail of the string: a three-component opaque black also ends in
  // ", 0)", so a tail pattern calls the page's own background transparent and
  // rejects the very value this file exists to read.
  //
  // The colour-function spelling is deliberately absent here too. The palette lint
  // reads source text with the whitespace stripped, so any colour-function name
  // followed by a paren reports as a new raw colour -- in code or in a comment, and
  // a string literal is no exemption.
  function clearAlpha(c) {
    var open = c.indexOf('(');
    if (open < 0 || c.charAt(c.length - 1) !== ')') {
      return false;
    }
    var parts = c.slice(open + 1, -1).split(',');
    return parts.length === 4 && parseFloat(parts[3]) === 0;
  }

  var cv = null, ctx = null, w = 0, h = 0, dpr = 1;
  var onSized = null;
  var bg = null;

  function resize() {
    var host = document.getElementById('graph');
    if (!host || !cv) {
      return;
    }
    var r = host.getBoundingClientRect();
    // Capped at 2. This is a glow layer, not text: the third row of pixels on a
    // DPR-3 phone buys nothing visible and costs a 1290x2628 backing store
    // (12.9MB) that is composited under the CRT stack every frame. At 2 it is
    // 5.7MB for the same picture.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width;
    h = r.height;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cv.style.top = r.top + 'px';
    cv.style.left = r.left + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (onSized) {
      onSized(ctx, w, h);
    }
  }

  return {
    // `sized` is called with (ctx, w, h) now and on every resize, so the caller can
    // cache all three in locals instead of paying an accessor per draw — this runs
    // per lit node per frame and the passes are the hot path, not this file.
    create: function (sized) {
      onSized = sized || null;
      cv = document.createElement('canvas');
      cv.id = 'gp-pulse';
      document.body.appendChild(cv);
      ctx = cv.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      return ctx;
    },

    // Also the whole of the woken-tab repair: a canvas comes back wedged from a
    // suspend, and re-measuring the backing store is what graph-overlay.js used to
    // spend a location.reload() on.
    resize: resize,

    // The element itself, for a caller that has to read these pixels back — the
    // wavefront masks itself against them (graph-ring.js).
    canvas: function () { return cv; },
    dpr: function () { return dpr; },

    // THE PAGE BACKGROUND, READ FROM THE PAGE. This is the opaque colour a node's
    // interior is filled with, which is what makes a node occlude the edges behind
    // it — so it has to be the colour of the page, exactly, or the fill is a
    // visible shape instead of a hole.
    //
    // It used to be read off the node data (graphify's `color.background`) and that
    // was wrong twice over. Once when graph_geometry started writing the string
    // `transparent` onto most nodes, which is truthy, so it won and the fill
    // painted nothing. Once when graph_style's value (`#0f0f1a`, graphify's own
    // body colour) turned out not to be this page's background at all: `--bg-hsl`
    // is `0 0% 0%`, measured pure black, so every filled interior was painting a
    // dark NAVY shape onto black. That one surfaced as nodes appearing DUPLICATED,
    // because a rotated node has both orientations filled and the union of an
    // up- and a down-triangle is only invisible if the fill matches the page.
    //
    // `getComputedStyle` cannot drift the way either of those did, because it IS
    // the thing being matched.
    bg: function () {
      if (bg) {
        return bg;
      }
      try {
        var c = getComputedStyle(document.body).backgroundColor;
        // Fully transparent is not an answer — it means the colour is further up
        // the tree, and whatever `setBg` was told is the better guess by then.
        if (c && c !== 'transparent' && !clearAlpha(c)) {
          bg = c;
        }
      } catch (e) {
        bg = null;
      }
      return bg;
    },

    // The fallback, for a page that reports no background of its own. REJECTS
    // `transparent` as well as empty: most nodes carry that exact string and it is
    // truthy, so a falsy-only guard would set a background that paints nothing.
    setBg: function (c) {
      if (!bg && c && c !== 'transparent') {
        bg = c;
      }
    },
  };
})();
