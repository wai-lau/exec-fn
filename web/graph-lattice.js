/* /graph — where the nodes sit, and the box that makes.
 *
 * Split out of graph-overlay.js at the 500-line cap. Same global scope, loaded
 * before it (routes_graph._GRAPH_OVERLAY_JS fixes the order), so `gpLattice` is
 * the whole surface: the snap, the free-cell walk it needs, and the bounding box
 * every camera decision is derived from.
 *
 * It is one concern and reads as one: graphify hands over a cloud of float
 * positions, and this turns it into a grid of occupied cells shaped like the
 * window you are looking through. graph-overlay.js owns what the CAMERA then
 * does with that box; graph-pulse.js owns what lights up inside it.
 */
(function () {
  // Lattice density: cells over the cloud's bounding box, per node. Above 1
  // there is room for most nodes to land on their first choice; the rest walk
  // outward.
  //
  // 9, up from 4: more points for each part of the graph to snap to. The cell
  // is sqrt(area / (n * this)), so raising it makes the grid FINER without
  // moving the cloud's outline — every node lands nearer where the layout
  // actually put it, dense communities stop collapsing onto the same handful of
  // cells, and `nearestFree` walks less because there is more free space beside
  // each first choice. The lattice still reads as a lattice; it just quantises
  // less of the layout away.
  var CELLS_PER_NODE = 9;

  // The nearest lattice point that nothing has claimed, searched ring by ring
  // so the answer is the closest one and not merely an early one. Within a
  // ring the candidates are compared on real distance, since a ring is a
  // square and its corners are further off than its edges.
  function nearestFree(taken, gx, gy) {
    if (!taken[gx + ',' + gy]) {
      return { x: gx, y: gy };
    }
    for (var r = 1; r < 256; r++) {
      var best = null, bestD = Infinity;
      for (var dx = -r; dx <= r; dx++) {
        for (var dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
            continue;                       // ring only, not the filled square
          }
          if (taken[(gx + dx) + ',' + (gy + dy)]) {
            continue;
          }
          var d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: gx + dx, y: gy + dy };
          }
        }
      }
      if (best) {
        return best;
      }
    }
    return { x: gx, y: gy };
  }

  // Snap every node onto a regular lattice. Nodes are placed CENTRE-OUT: the
  // crowded middle claims its own cells first, so the walk to a free point
  // falls on the sparse rim where there is somewhere to go, instead of
  // cascading through the core.
  function snapToGrid() {
    var b = nodeBounds();
    var pos = network.getPositions();
    var ids = Object.keys(pos);
    // THE LATTICE CHANGES DIMENSION, IT DOES NOT SQUISH.
    //
    // The grid is shaped to the viewport by how many rows and columns it has —
    // a tall screen gets a tall grid — and never by stretching one axis. Cell
    // spacing is ONE number, `cell`, used on both axes, so the step between
    // adjacent lattice points is identical horizontally and vertically.
    //
    // It did stretch, for one commit: positions were rescaled into a box of the
    // viewport's aspect before snapping, which made the outline fit the screen
    // and squashed everything inside it. The grid POINTS stayed square while the
    // picture between them did not, which is the worst of both — a force layout
    // says something by distance, and an axis scaled on its own rewrites it.
    //
    // So the map is uniform: one scale, `k`, for x and y alike. `k` is chosen so
    // the cloud's own area fills the viewport-shaped grid's area, which is what
    // lets the ROW AND COLUMN COUNT follow the window while the spacing between
    // points, and the shape of everything standing on them, does not change.
    var aspect = b.vw / Math.max(b.vh, 1);
    var area = b.w * b.h;
    var gridW = Math.sqrt(area * aspect);
    var gridH = Math.sqrt(area / aspect);
    var cell = Math.sqrt((gridW * gridH) / Math.max(ids.length * CELLS_PER_NODE, 1));
    // Uniform, area-preserving: the cloud covers as much of the grid as it did
    // of its own bounding box, at its own proportions.
    var k = Math.sqrt((gridW * gridH) / area);
    if (!isFinite(cell) || cell <= 0) {
      return;
    }
    ids.sort(function (a, c) {
      var pa = pos[a], pc = pos[c];
      return ((pa.x - b.cx) * (pa.x - b.cx) + (pa.y - b.cy) * (pa.y - b.cy))
           - ((pc.x - b.cx) * (pc.x - b.cx) + (pc.y - b.cy) * (pc.y - b.cy));
    });

    // vis's own node objects. Guarded rather than assumed: it is internal, and a
    // version that renames it falls back to moveNode and is merely slow.
    var bodyNodes = network.body && network.body.nodes;
    var taken = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      var p = pos[ids[i]];
      // ONE scale on both axes, then onto the lattice. Nothing here treats x
      // differently from y: that is the whole of "not squished".
      var g = nearestFree(taken,
        Math.round((p.x - b.minX) * k / cell),
        Math.round((p.y - b.minY) * k / cell));
      taken[g.x + ',' + g.y] = 1;
      var nx = b.minX + g.x * cell, ny = b.minY + g.y * cell;
      // Written straight onto the body, NOT through moveNode, and this is the
      // difference between a page that loads and one reported as frozen.
      //
      // moveNode was already the cheap option against a DataSet write (a bulk
      // update fires vis's _dataUpdated cascade and rebuilds every physics
      // body: 7.4s against 1.07s). But it asks vis to REDRAW, once per node,
      // and the draws it queues are not counted by the timer around this loop —
      // `place` measured 0.0s while the redraws it had queued ran on for
      // seconds afterwards. Measured on the served page: 160 draws, 16.1s of
      // main thread, a median 93ms apart, 130 of them before the cover lifted.
      // That is the block that made a phone look dead, and it is invisible from
      // inside the function that causes it.
      //
      // The body is where moveNode writes anyway; doing it directly skips the
      // emit, and ONE redraw after the loop paints the whole result.
      if (bodyNodes && bodyNodes[ids[i]]) {
        bodyNodes[ids[i]].x = nx;
        bodyNodes[ids[i]].y = ny;
      } else {
        network.moveNode(ids[i], nx, ny);
      }
    }
    if (bodyNodes) {
      network.redraw();
    }
  }

  // The node bounding box in world units, plus the two scales derived from it.
  // Physics is off, so this only actually changes if a node is dragged.
  function nodeBounds() {
    var container = document.getElementById('graph');
    var ids = nodesDS.getIds();
    var pos = network.getPositions(ids);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var id in pos) {
      var p = pos[id];
      if (p.x < minX) { minX = p.x; }
      if (p.x > maxX) { maxX = p.x; }
      if (p.y < minY) { minY = p.y; }
      if (p.y > maxY) { maxY = p.y; }
    }
    var w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    var cw = container.clientWidth, chh = container.clientHeight;
    // The bbox is built from node CENTRES, so a node sitting on its edge is half
    // outside it. At the old 0.75 that never showed; filling the window, it
    // would clip the outermost nodes down the middle. Pad by the largest radius
    // on the board and the fit is of the drawing, not of the centres.
    var maxR = 0;
    nodesDS.forEach(function (n) {
      if ((n.size || 0) > maxR) {
        maxR = n.size || 0;
      }
    });
    var pw = w + 2 * maxR, ph = h + 2 * maxR;
    return {
      minX: minX, maxX: maxX, minY: minY, maxY: maxY,
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      n: ids.length,
      vp: cw * chh,
      // Separately as well as multiplied: the lattice is shaped to the viewport
      // and needs its ASPECT, which an area cannot give back.
      vw: cw, vh: chh,
      w: w, h: h,
      // CONTAIN: every node on screen, margin on the axis that is not limiting.
      contain: Math.min(cw / pw, chh / ph),
      // COVER: no margin on either axis, overflow on the one that is not
      // limiting — a wallpaper's fill mode. This is what the page opens at.
      cover: Math.max(cw / pw, chh / ph),
    };
  }

  window.gpLattice = {
    snap: snapToGrid,
    bounds: nodeBounds,
  };
})();
