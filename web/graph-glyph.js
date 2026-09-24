// /graph — THE SHAPES, EXACTLY AS vis DRAWS THEM. Loaded before
// graph-pulse-draw.js, which owns the ink and the paint order and calls in here
// for every path it strokes or fills.
//
// The seam, and it is the cleanest one in this stack: nothing in this file knows
// what a cascade is, what a charge is, how bright anything should be or what
// order the passes run in. It is handed a context once and thereafter builds
// paths. graph-pulse-draw.js was at 520 lines and this was the part of it with an
// argument entirely of its own.
//
// THAT ARGUMENT: the overlay paints ON TOP OF a vis-network canvas, so its shapes
// have to agree with the renderer underneath rather than with the geometry anyone
// here would pick. Where the two disagree the glow sits off the node it belongs
// to, which is visible the instant anything lights up. So the constants below are
// vis's own, copied deliberately, and a change to them is a change to which
// renderer this file is tracking.
//
// The lit glyph follows the node's SHAPE, which carries its type: an UPWARD
// triangle for code, a hexagon for a rationale, a DOWNWARD triangle for a document
// (graph_style._TYPE_SHAPES owns that mapping — this file only draws whatever
// shape a node arrives with, so a reassignment there touches nothing here).
// Lighting everything as one shape made a cascade say the wrong thing about what
// it was crossing.
var graphGlyph = (function () {
  'use strict';

  // vis does NOT draw a triangle centred on the node. Its own code reads
  //
  //   triangle:     y += 0.275 * (size *= 1.15)
  //   triangleDown: y -= 0.275 * (size *= 1.15)
  //
  // so the shape is scaled by 1.15 and then shifted off the node position by
  // 0.275 of that — the node's point is not the triangle's centroid. Drawing a
  // plain centred triangle put the lit glyph a third of a radius away from the
  // node underneath it.
  var TRI_SCALE = 1.15;
  var TRI_SHIFT = 0.275;

  // Set once by graph-pulse-draw.js when it makes the canvas. One context for the
  // life of the page: this file draws on the overlay and nothing else.
  var ctx = null;

  function polygon(x, y, r, sides, turn) {
    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = turn + i * 2 * Math.PI / sides;
      var px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  }

  function triangle(x, y, r, down) {
    var e = r * TRI_SCALE;
    var c = 2 * e, half = c / 2;
    var inr = Math.sqrt(3) / 6 * c;
    var out = Math.sqrt(c * c - half * half);
    var apex = down ? y + (out - inr) : y - (out - inr);
    var base = down ? y - inr : y + inr;
    ctx.beginPath();
    ctx.moveTo(x, apex);
    ctx.lineTo(x + half, base);
    ctx.lineTo(x - half, base);
    ctx.closePath();
  }

  return {
    bind: function (context) {
      ctx = context;
    },

    // WHERE THE GLYPH ACTUALLY SITS, given the node's own y. The same offset as
    // above seen from the other side: a halo centred on the node POINT rather than
    // on the glyph glows off-centre under a triangle, so every pass that draws
    // something round asks this first.
    centre: function (y, r, shape) {
      if (shape === 'triangle') {
        return y + TRI_SHIFT * r * TRI_SCALE;
      }
      if (shape === 'triangleDown') {
        return y - TRI_SHIFT * r * TRI_SCALE;
      }
      return y;
    },

    // Builds the path and leaves it current — it does not fill or stroke, because
    // which of those happens (and at what alpha, in what colour) is the caller's
    // whole subject and none of this file's.
    //
    // The triangle gets 1.15x the radius from TRI_SCALE, which is vis's number
    // rather than a taste: at equal circumradius a triangle reads smaller than the
    // hexagon beside it, and vis already compensates.
    path: function (x, y, r, shape) {
      if (shape === 'triangle' || shape === 'triangleDown') {
        triangle(x, this.centre(y, r, shape), r, shape === 'triangleDown');
        return;
      }
      if (shape === 'dot') {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        return;
      }
      // Anything this does not recognise draws as the hexagon, which is
      // graph_style's own global default for a type it has no shape for.
      polygon(x, y, r, 6, 0);
    },
  };
})();
