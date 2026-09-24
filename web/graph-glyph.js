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

  // ROTATION IS DONE IN THE POINTS, never with ctx.rotate/save/restore. A canvas
  // transform would have to wrap the path build AND the caller's stroke, and the
  // contract here is that this file leaves a path current for someone else to
  // stroke or fill — so a transform would leak out of it. Rotating the vertices
  // keeps the whole thing pure arithmetic and costs a sin and a cos per shape.
  function spin(pts, x, y, turn) {
    if (!turn) {
      return pts;
    }
    var c = Math.cos(turn), s = Math.sin(turn);
    for (var i = 0; i < pts.length; i++) {
      var dx = pts[i][0] - x, dy = pts[i][1] - y;
      pts[i][0] = x + dx * c - dy * s;
      pts[i][1] = y + dx * s + dy * c;
    }
    return pts;
  }

  function trace(pts) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) {
        ctx.moveTo(pts[i][0], pts[i][1]);
      } else {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
    }
    ctx.closePath();
  }

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

  function triangle(x, y, r, down, turn) {
    var e = r * TRI_SCALE;
    var c = 2 * e, half = c / 2;
    var inr = Math.sqrt(3) / 6 * c;
    var out = Math.sqrt(c * c - half * half);
    var apex = down ? y + (out - inr) : y - (out - inr);
    var base = down ? y - inr : y + inr;
    trace(spin([[x, apex], [x + half, base], [x - half, base]], x, y, turn));
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
    path: function (x, y, r, shape, turn) {
      return this.at(x, this.centre(y, r, shape), r, shape, turn);
    },

    // The same path about an EXPLICIT glyph centre, for a caller that has to keep
    // the centre FIXED while it changes the radius.
    //
    // graph-ring.js is why this exists. vis's triangle offset is proportional to
    // SIZE (see TRI_SHIFT), so a growing triangle drawn through `path` walks down
    // the screen as it grows — the wavefront would drift off the node that threw
    // it instead of expanding around it. Taking the centre once at the node's own
    // radius and growing about that is concentric, which is what a wave is. A
    // hexagon and a dot are unaffected either way, `centre` returning `y` for both.
    // `turn` is radians about the glyph centre, and it is what a node is rotated
    // by the instant before it throws a wave — graph-ring.js writes the angle onto
    // the node's own position record as `pos[id].t`, and graph-pulse-draw.js hands
    // it to EVERY pass that draws that glyph: the outline, the interior clear and
    // the opaque punch. All three have to agree, or a rotated node's cleared
    // interior no longer lines up with its own outline. The halo is exempt, being
    // a circle, and so is `centre` — vis's offset is a vertical shift belonging to
    // the unrotated shape, and the glyph spins about the centre rather than
    // carrying it around.
    //
    // A circle ignores the angle and a hexagon has 60-degree symmetry, so in
    // practice it is the triangles that visibly spin — which is 83% of the graph.
    at: function (x, gy, r, shape, turn) {
      if (shape === 'triangle' || shape === 'triangleDown') {
        triangle(x, gy, r, shape === 'triangleDown', turn);
        return;
      }
      if (shape === 'dot') {
        ctx.beginPath();
        ctx.arc(x, gy, r, 0, Math.PI * 2);
        return;
      }
      // Anything this does not recognise draws as the hexagon, which is
      // graph_style's own global default for a type it has no shape for.
      polygon(x, gy, r, 6, turn || 0);
    },
  };
})();
