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
  // Points on the lattice are n x this, and the cell is
  // sqrt(area / (n * this)) — so raising it makes the grid finer WITHOUT moving
  // the cloud's outline, and lowering it coarsens the same outline. It went 4 ->
  // 9 to give each part of the graph more points to land on, then 9 -> 7 on
  // request: about a quarter fewer points (7/9 = 0.78), cell 97 -> 110.
  var CELLS_PER_NODE = 7;

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
  // Pack the communities, as RIGID TILES, into a box shaped like the window.
  //
  // This is the only honest way to make a square-ish cloud fill a tall screen.
  // vis's physics runs in WORLD coordinates and knows nothing about the
  // viewport, so a layout baked in a tall browser window comes out exactly as
  // square as one baked in a wide one — the window is not an input. And scaling
  // an axis to fit is the squish: a force layout says something by distance.
  //
  // What can move without lying is a whole community. Each one is translated as
  // a unit — never scaled, never rotated — so every distance INSIDE a community,
  // which is where the layout's meaning is densest, survives exactly. What
  // changes is where the communities sit relative to each other, which
  // forceAtlas2 had already decided fairly arbitrarily for a cloud with no
  // boundary to respect.
  //
  // Shelf packing, tallest tile first, with the shelf width binary-searched
  // until the packed height comes out at the target aspect. Fourteen tiles, so
  // the search is free.
  function packCommunities(pos, ids, aspect) {
    // OPT-IN, `?pack=1`. Packing rearranges where every community SITS — it is
    // the same graph with its regions dealt out again, and that reads as a
    // completely different picture even though nothing inside a community moved
    // by a pixel. Whether that trade is worth a screen-shaped outline is a
    // judgement about the drawing, not about the code, so it is not made here
    // by default.
    if (!/[?&]pack=1/.test(location.search)) {
      return;
    }
    var meta = nodesDS.get();
    var group = Object.create(null);
    for (var i = 0; i < meta.length; i++) {
      // `_community`, with the underscore: graphify's DataSet mapper renames the
      // fields it carries over (`_community`, `_source_file`, `_degree`), and
      // RAW_NODES's own `community` does not survive into it. Reading the
      // unprefixed name found nothing, put every node in one group, and the
      // packer returned early as a silent no-op — the outline came out
      // unchanged, which looks exactly like the packing being wrong rather than
      // absent. Both names are accepted so a mapper change cannot repeat it.
      var raw = meta[i];
      var cid = raw._community === undefined ? raw.community : raw._community;
      var key = cid === undefined ? 'none' : String(cid);
      if (!pos[raw.id]) {
        continue;
      }
      if (!group[key]) {
        group[key] = { ids: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      }
      var g = group[key], p = pos[raw.id];
      g.ids.push(raw.id);
      g.minX = Math.min(g.minX, p.x);
      g.maxX = Math.max(g.maxX, p.x);
      g.minY = Math.min(g.minY, p.y);
      g.maxY = Math.max(g.maxY, p.y);
    }
    var tiles = [];
    var areaSum = 0;
    for (var k in group) {
      var t = group[k];
      t.w = Math.max(t.maxX - t.minX, 1);
      t.h = Math.max(t.maxY - t.minY, 1);
      areaSum += t.w * t.h;
      tiles.push(t);
    }
    if (tiles.length < 2) {
      return;
    }
    tiles.sort(function (a, c) { return c.h - a.h; });
    var gap = 3 * Math.sqrt(areaSum / Math.max(ids.length * CELLS_PER_NODE, 1));

    // Lay the tiles out at a given shelf width and report the height used.
    function layout(width, place) {
      var x = 0, y = 0, shelf = 0, used = 0;
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        if (x > 0 && x + t.w > width) {
          y += shelf + gap;
          x = 0;
          shelf = 0;
        }
        if (place) {
          t.atX = x;
          t.atY = y;
        }
        x += t.w + gap;
        shelf = Math.max(shelf, t.h);
        used = Math.max(used, x - gap);
      }
      return { h: y + shelf, w: used };
    }

    // Widen until the packed box is no taller than the target aspect wants.
    var lo = Math.sqrt(areaSum * aspect) * 0.4, hi = Math.sqrt(areaSum * aspect) * 4;
    for (var pass = 0; pass < 28; pass++) {
      var mid = (lo + hi) / 2;
      var got = layout(mid, false);
      if (got.w / Math.max(got.h, 1) < aspect) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    layout(hi, true);

    // Translation only: every node in a tile moves by the same vector, so the
    // community arrives intact.
    for (var j = 0; j < tiles.length; j++) {
      var tile = tiles[j];
      var dx = tile.atX - tile.minX, dy = tile.atY - tile.minY;
      for (var n = 0; n < tile.ids.length; n++) {
        var q = pos[tile.ids[n]];
        q.x += dx;
        q.y += dy;
      }
    }
  }

  function snapToGrid() {
    var b = nodeBounds();
    var pos = network.getPositions();
    var ids = Object.keys(pos);
    // Shape the CLOUD to the window first, by moving communities. Everything
    // below then works on an outline that already matches the screen, so the
    // snap itself needs no scaling at all — which is what keeps the spacing
    // uniform and the picture undistorted.
    packCommunities(pos, ids, b.vw / Math.max(b.vh, 1));
    // Bounds recomputed from the PACKED positions: `b` came from the network,
    // which has not been written to yet.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var q = 0; q < ids.length; q++) {
      var pp = pos[ids[q]];
      minX = Math.min(minX, pp.x);
      maxX = Math.max(maxX, pp.x);
      minY = Math.min(minY, pp.y);
      maxY = Math.max(maxY, pp.y);
    }
    var packedW = Math.max(maxX - minX, 1), packedH = Math.max(maxY - minY, 1);
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
    // Density comes from the cloud BEFORE packing, not after. Packing only
    // translates communities — the spacing between nodes inside one is
    // untouched — but it adds gaps between the tiles, which inflates the
    // bounding box. Sizing cells off the packed box let that empty space
    // coarsen the grid (measured: step 97 -> 350), and a coarser grid is what
    // makes nodes collide and clump: at 146 the largest block was 222 nodes,
    // against 4 at 97. The grid keeps the density the graph actually has, and
    // only its ROW AND COLUMN COUNT follows the packed outline.
    var cell = Math.sqrt((b.w * b.h) / Math.max(ids.length * CELLS_PER_NODE, 1));
    if (!isFinite(cell) || cell <= 0) {
      return;
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    ids.sort(function (a, c) {
      var pa = pos[a], pc = pos[c];
      return ((pa.x - cx) * (pa.x - cx) + (pa.y - cy) * (pa.y - cy))
           - ((pc.x - cx) * (pc.x - cx) + (pc.y - cy) * (pc.y - cy));
    });

    // The positions as the LAYOUT left them, before this function quantises
    // anything, published for scripts/graph-layout.py to bake.
    //
    // The bake used to read `network.getPositions()` after `gp-loaded`, which is
    // after this has run — so it stored an already-snapped lattice, and every
    // later visit snapped that a SECOND time at whatever cell size was current.
    // Two lattices at an incommensurate ratio beat against each other: baked at
    // step 146 (CELLS_PER_NODE 4), re-snapped at 97 (CELLS_PER_NODE 9), 146/97
    // is 1.505, so multiples of 146 land on cell indices 0, 2, 3, 5, 6, 8, 9 —
    // alternating wide and narrow gaps, which renders as pairs, and pairs of
    // pairs: evenly spaced groups of up to four. It looks like a deliberate
    // arrangement and it is an artifact of rounding twice.
    var preSnap = {};
    for (var s0 = 0; s0 < ids.length; s0++) {
      preSnap[ids[s0]] = [Math.round(pos[ids[s0]].x), Math.round(pos[ids[s0]].y)];
    }
    window.__GP_PRESNAP = preSnap;

    // vis's own node objects. Guarded rather than assumed: it is internal, and a
    // version that renames it falls back to moveNode and is merely slow.
    var bodyNodes = network.body && network.body.nodes;
    var taken = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      var p = pos[ids[i]];
      // Straight onto the lattice, no scaling on either axis: the packing above
      // already shaped the cloud, so nothing here treats x differently from y.
      // That is the whole of "not squished".
      var g = nearestFree(taken,
        Math.round((p.x - minX) / cell),
        Math.round((p.y - minY) / cell));
      taken[g.x + ',' + g.y] = 1;
      var nx = minX + g.x * cell, ny = minY + g.y * cell;
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
