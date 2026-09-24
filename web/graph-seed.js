// /graph — WHERE a cascade starts. Loaded before graph-pulse.js (same global
// scope, no modules), which owns what the activation does once it has started.
//
// The seam is real and not an accident of size: choosing the nodes that light
// FIRST is a different job from spreading outward from them, and it is the half
// with all the weighting and the spatial reasoning in it. graph-pulse.js keeps
// the cascade — the queue, the hop timing, the catch rolls, the envelopes.
//
// The split happened when proximity seeding pushed graph-pulse.js past the
// 500-line cap. The cap is a signal that a file has come to hold too much, and
// the answer to it is a seam, never a smaller design or shorter comments.
var graphSeed = (function () {
  'use strict';

  // Seeds are drawn on size to the SEED_POW, not on size itself. Strictly
  // proportional looked like nothing was happening: 76% of this graph sits at the
  // size floor with a single edge, so nine seeds in ten landed on a leaf that lit
  // itself, rolled its one neighbour and stopped.
  var SEED_POW = 2;

  // Extra seeds are drawn by PROXIMITY to the first one. The point is unchanged
  // from the positional-square version this replaces: seeds scattered anywhere in
  // a hairball read as unrelated sparks, while seeds that sit together read as a
  // REGION waking up. What changed is how "together" gets decided.
  //
  // It used to be a GRID x GRID lattice — 16 positional squares, every node filed
  // under one at index time, extras drawn from the first seed's own square. That
  // is cheap, and it QUANTISES: a seed near a boundary draws only inward, two
  // seeds a pixel apart on either side of one get disjoint pools, and the same 16
  // regions recur for the life of the page. Distance to the actual seed has none
  // of those seams and needs no bookkeeping at all. The layout is frozen, so one
  // pass over ~2.8k nodes is a few hundred microseconds, a few times a second.
  var NEAR_POOL = 64;             // nearest candidates considered
  var NEAR_MAX = 320;             // ceiling on a level-scaled pool
  var NEAR_AT = 24;               // candidates around an audio-chosen place
  var NEAR_SOFT = 0.6;            // distance falloff, as a fraction of the pool's
                                  // own radius: nearer is likelier, not mandatory

  var pos = {}, deg = {}, ids = [], cum = [], terminal = 0.15;
  var box = { x0: 0, y0: 0, w: 1, h: 1 };

  // Size to the SEED_POW, knocked down to TERMINAL_ODDS for a dead end. ONE
  // function, so the whole-graph draw and the proximity draws cannot drift apart —
  // an unweighted local pick would bring back exactly the halo of terminal nodes
  // that TERMINAL_ODDS exists to remove.
  function seedWeight(id) {
    var w = Math.pow(pos[id].r, SEED_POW);
    return (deg[id] || 0) <= 1 ? w * terminal : w;
  }

  // Prefix sums, so a weighted pick is one binary search rather than a scan or a
  // reject loop.
  function weigh(list) {
    var total = 0;
    return list.map(function (id) {
      total += seedWeight(id);
      return total;
    });
  }

  function pick(list, sums) {
    if (!list.length || !sums[sums.length - 1]) {
      return null;
    }
    var target = Math.random() * sums[sums.length - 1];
    var lo = 0, hi = sums.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sums[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return list[lo];
  }

  return {
    // `terminalOdds` is passed in rather than declared here because the same
    // number governs CATCHING over in graph-pulse.js, and one constant with two
    // definitions is a constant waiting to disagree with itself.
    index: function (positions, degrees, terminalOdds) {
      pos = positions;
      deg = degrees;
      terminal = terminalOdds;
      ids = Object.keys(pos);
      cum = weigh(ids);
      // The cloud's bounding box, so an audio feature can name a PLACE. Computed
      // once, because the layout is frozen.
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var i = 0; i < ids.length; i++) {
        var p = pos[ids[i]];
        if (p.x < x0) { x0 = p.x; }
        if (p.x > x1) { x1 = p.x; }
        if (p.y < y0) { y0 = p.y; }
        if (p.y > y1) { y1 = p.y; }
      }
      box = { x0: x0, y0: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    },

    // A seed from anywhere in the graph, weighted by size.
    any: function () {
      return pick(ids, cum);
    },

    // A seed near a FRACTIONAL POSITION in the cloud, 0..1 on each axis. This is
    // what lets the audio choose WHERE. Without it every cascade seeds uniformly
    // at random, so the spatial pattern is noise and two different songs at the
    // same tempo and level produce statistically identical pictures.
    //
    // Deliberately NOT "the single nearest node": the same feature value would
    // then light the same node every time, which reads as one blinking lamp
    // rather than a region answering. The nearest NEAR_AT candidates are drawn
    // from on the usual size weighting, so a sustained tone wanders inside its
    // own neighbourhood instead of pinning.
    at: function (fx, fy) {
      if (!ids.length) {
        return null;
      }
      var tx = box.x0 + Math.min(1, Math.max(0, fx)) * box.w;
      var ty = box.y0 + Math.min(1, Math.max(0, fy)) * box.h;
      var idl = [], dl = [], worst = Infinity;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var dx = pos[id].x - tx, dy = pos[id].y - ty, d = dx * dx + dy * dy;
        if (idl.length === NEAR_AT && d >= worst) {
          continue;
        }
        var k = idl.length;
        while (k > 0 && dl[k - 1] > d) {
          idl[k] = idl[k - 1]; dl[k] = dl[k - 1]; k--;
        }
        idl[k] = id; dl[k] = d;
        if (idl.length > NEAR_AT) {
          idl.pop(); dl.pop();
        }
        worst = dl[idl.length - 1];
      }
      return pick(idl, weigh(idl));
    },

    // The nearest NEAR_POOL nodes to `from`, weighted by seedWeight AND by
    // closeness. One pass keeping a small sorted array: almost every node fails
    // the first comparison against the current worst, so this is ~n compares
    // rather than a sort of the whole graph.
    near: function (from, want) {
      // The pool size is an ARGUMENT now. Fixed at 64, a huge hit covered exactly
      // the same area as a small one and only the number of lit nodes changed --
      // and a count is far less legible than an area, so loud now reads as WIDER.
      var cap = Math.max(8, Math.min(NEAR_MAX, want || NEAR_POOL));
      var p0 = pos[from], idl = [], dl = [], worst = Infinity;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (id === from) {
          continue;
        }
        var dx = pos[id].x - p0.x, dy = pos[id].y - p0.y, d = dx * dx + dy * dy;
        if (idl.length === cap && d >= worst) {
          continue;
        }
        var k = idl.length;
        while (k > 0 && dl[k - 1] > d) {
          idl[k] = idl[k - 1]; dl[k] = dl[k - 1]; k--;
        }
        idl[k] = id; dl[k] = d;
        if (idl.length > cap) {
          idl.pop(); dl.pop();
        }
        worst = dl[idl.length - 1];
      }
      // The falloff is measured against the POOL'S OWN radius, so it behaves the
      // same in a dense community as out on the sparse rim. An absolute distance
      // would make the rim draw almost nothing and the core draw everything,
      // which is the quantisation the squares had, wearing different clothes.
      var span = dl[dl.length - 1] || 1, total = 0;
      var cums = idl.map(function (id, n) {
        total += seedWeight(id) / (1 + NEAR_SOFT * (dl[n] / span));
        return total;
      });
      return { ids: idl, cum: cums };
    },

    // Draw one out of a pool `near()` returned.
    from: function (pool) {
      return pick(pool.ids, pool.cum);
    },
  };
})();
