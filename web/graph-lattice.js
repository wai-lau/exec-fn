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
  // outward. 4 keeps the walk short while still reading as a grid.
  var CELLS_PER_NODE = 4;

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
    // THE LATTICE IS SHAPED TO THE VIEWPORT. graphify's cloud comes out roughly
    // square, and a square cloud on a phone is mostly off-screen: the camera
    // opens on COVER, so at 430x932 the graph filled the height and ran 2.08x
    // the width — you saw the middle strip of it and had to drag for the rest.
    //
    // The nodes are rescaled into a box of the viewport's aspect before they are
    // snapped, and the box keeps the ORIGINAL AREA (W*H == b.w*b.h), so `cell`
    // below is unchanged and the lattice stays exactly as dense as it was. Only
    // the outline moves. Cover and contain then converge, and the opening view
    // shows the whole graph on any screen instead of whichever strip of it the
    // window happened to frame.
    //
    // It distorts distances, and that is the trade taken knowingly: this is a
    // force layout, so a stretched axis stretches what the layout MEANT by
    // distance. Against that, a phone was seeing less than half the picture.
    var aspect = b.vw / Math.max(b.vh, 1);
    var area = b.w * b.h;
    var boxW = Math.sqrt(area * aspect);
    var boxH = Math.sqrt(area / aspect);
    var cell = Math.sqrt((boxW * boxH) / Math.max(ids.length * CELLS_PER_NODE, 1));
    if (!isFinite(cell) || cell <= 0) {
      return;
    }
    ids.sort(function (a, c) {
      var pa = pos[a], pc = pos[c];
      return ((pa.x - b.cx) * (pa.x - b.cx) + (pa.y - b.cy) * (pa.y - b.cy))
           - ((pc.x - b.cx) * (pc.x - b.cx) + (pc.y - b.cy) * (pc.y - b.cy));
    });

    var taken = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      var p = pos[ids[i]];
      // Normalise into the bbox, out into the viewport-shaped box, then onto the
      // lattice. The cells stay SQUARE — the reshape is in where a node lands,
      // never in the spacing, or the nodes themselves would read as stretched.
      var g = nearestFree(taken,
        Math.round(((p.x - b.minX) / b.w) * boxW / cell),
        Math.round(((p.y - b.minY) / b.h) * boxH / cell));
      taken[g.x + ',' + g.y] = 1;
      // moveNode, not a DataSet write: a bulk update fires vis's _dataUpdated
      // cascade and rebuilds every physics body (7.4s against 1.07s).
      network.moveNode(ids[i], b.minX + g.x * cell, b.minY + g.y * cell);
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
