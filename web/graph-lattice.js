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
  // 9 to give each part of the graph more points to land on, then 9 -> 7 ->
  // 5.25 -> 3.9375 -> 2.953125 on request, a quarter off each time (x0.75).
  // Fractional is fine — it is a density, not a count of anything. Fewer points
  // means a coarser grid, and a coarser grid means more nodes landing on the
  // same cell and walking to a neighbour, which is what makes them clump.
  var CELLS_PER_NODE = 2.953125;

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
  // Shape the cloud to the window by moving COMMUNITIES, never by scaling
  // anything that is drawn.
  //
  // With one cell size on both axes, columns/rows is W/H of the node cloud — so
  // matching the viewport ratio means the cloud's own box has to match it, and
  // the cloud is roughly square. Scaling an axis is the squish. What can move
  // without lying is a whole community: translate it as a unit and every
  // distance INSIDE it survives exactly, which is where a force layout's meaning
  // is densest.
  //
  // The first version shelf-packed tiles tallest-first, which hit the ratio and
  // dealt the communities out in size order — the same graph, unrecognisable.
  // This one stretches the CENTROIDS to the target box and sets each community
  // down rigidly on its new centroid: a community that was top-left is still
  // top-left, just further from its neighbours. Then a few passes push
  // overlapping tiles apart along whichever axis they overlap least.
  // Lay the tiles out for a target aspect and report what came back. The two
  // are not the same number: a tile has a width of its own, and separating
  // overlaps inflates whichever axis was tight, so aiming at the viewport
  // ratio lands short of it (0.68 against 0.49 on a phone, measured).
function placeTiles(tiles, box, target) {
    var boxW = Math.sqrt(box.areaSum * box.spread * target);
    var boxH = boxW / target;
    // CENTROIDS ONLY. The one anisotropic step in the whole file, and it moves
    // no node relative to its own community — it decides where communities SIT.
    for (var m = 0; m < tiles.length; m++) {
      tiles[m].toX = ((tiles[m].cx - box.minX) / box.spanX) * (boxW - tiles[m].w) + tiles[m].w / 2;
      tiles[m].toY = ((tiles[m].cy - box.minY) / box.spanY) * (boxH - tiles[m].h) + tiles[m].h / 2;
    }
    // Separate whatever still overlaps, along the shallower axis so a tile
    // travels as little as possible from where the stretch put it.
    for (var pass = 0; pass < 60; pass++) {
      var moved = false;
      for (var a = 0; a < tiles.length; a++) {
        for (var b2 = a + 1; b2 < tiles.length; b2++) {
          var t1 = tiles[a], t2 = tiles[b2];
          var ox = (t1.w + t2.w) / 2 - Math.abs(t1.toX - t2.toX);
          var oy = (t1.h + t2.h) / 2 - Math.abs(t1.toY - t2.toY);
          if (ox <= 0 || oy <= 0) {
            continue;
          }
          moved = true;
          if (ox < oy) {
            var sx = (t1.toX < t2.toX ? -1 : 1) * ox / 2;
            t1.toX += sx;
            t2.toX -= sx;
          } else {
            var sy = (t1.toY < t2.toY ? -1 : 1) * oy / 2;
            t1.toY += sy;
            t2.toY -= sy;
          }
        }
      }
      if (!moved) {
        break;
      }
    }
    var lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity };
    for (var r = 0; r < tiles.length; r++) {
      lo.x = Math.min(lo.x, tiles[r].toX - tiles[r].w / 2);
      hi.x = Math.max(hi.x, tiles[r].toX + tiles[r].w / 2);
      lo.y = Math.min(lo.y, tiles[r].toY - tiles[r].h / 2);
      hi.y = Math.max(hi.y, tiles[r].toY + tiles[r].h / 2);
    }
    return Math.max(hi.x - lo.x, 1) / Math.max(hi.y - lo.y, 1);
  }

  function packCommunities(pos, ids, aspect) {
    // OFF unless asked for: `?pack=1`. Moving communities hits the viewport
    // ratio (measured 0.51 against a 0.49 phone) and changes where every region
    // of the graph sits, which is not a trade to make on someone's behalf.
    if (!/[?&]pack=1/.test(location.search)) {
      return;
    }
    var meta = nodesDS.get();
    var group = Object.create(null);
    for (var i = 0; i < meta.length; i++) {
      // `_community`, with the underscore: graphify's DataSet mapper renames
      // what it carries over, and RAW_NODES's own `community` does not survive
      // into it. Reading the unprefixed name put every node in one group and
      // made this a silent no-op. Both names accepted so it cannot repeat.
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
      t.cx = (t.minX + t.maxX) / 2;
      t.cy = (t.minY + t.maxY) / 2;
      areaSum += t.w * t.h;
      tiles.push(t);
    }
    if (tiles.length < 2) {
      return;
    }
    var spread = 1.7;
    var cloud = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (var c = 0; c < tiles.length; c++) {
      cloud.minX = Math.min(cloud.minX, tiles[c].cx);
      cloud.maxX = Math.max(cloud.maxX, tiles[c].cx);
      cloud.minY = Math.min(cloud.minY, tiles[c].cy);
      cloud.maxY = Math.max(cloud.maxY, tiles[c].cy);
    }
    var spanX = Math.max(cloud.maxX - cloud.minX, 1);
    var spanY = Math.max(cloud.maxY - cloud.minY, 1);
    // So aim, measure, correct. Four rounds of feeding the error back into the
    // target converges on the viewport's ratio without a fudge factor, and
    // fourteen tiles make each round free.
    var box = { areaSum: areaSum, spread: spread, minX: cloud.minX, minY: cloud.minY,
      spanX: spanX, spanY: spanY };
    var aim = aspect;
    for (var round = 0; round < 4; round++) {
      var got = placeTiles(tiles, box, aim);
      if (!isFinite(got) || got <= 0) {
        break;
      }
      aim *= aspect / got;
    }
    placeTiles(tiles, box, aim);
    for (var j = 0; j < tiles.length; j++) {
      var tile = tiles[j];
      var dx = tile.toX - tile.cx, dy = tile.toY - tile.cy;
      for (var q2 = 0; q2 < tile.ids.length; q2++) {
        var node = pos[tile.ids[q2]];
        node.x += dx;
        node.y += dy;
      }
    }
  }

  // STRETCH THE POSITIONS to the window's shape, then let the caller snap them.
  //
  // Two different things get called "squished" and only one of them is, so to be
  // exact about which: this scales x and y by different factors, so the PICTURE
  // is reshaped — a force layout says something by distance and a stretched axis
  // rewrites it. What it does not touch is the lattice. `cell` stays one number
  // used on both axes, so the step between adjacent lattice points is identical
  // horizontally and vertically; the grid gains rows or loses columns instead of
  // changing its spacing.
  //
  // That is what makes cols/rows follow the viewport at all: with equal spacing
  // the ratio IS the node cloud's own bounding box, so the cloud has to have the
  // window's shape before the snap runs. Area is preserved (boxW*boxH == w*h),
  // which leaves `cell` and the lattice's density exactly where they were.
  //
  // Skipped when `?pack=1` has already shaped the cloud by moving communities —
  // the two answer the same question and stacking them would shape it twice.
  function stretchToViewport(pos, ids, aspect) {
    if (/[?&]pack=1/.test(location.search)) {
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < ids.length; i++) {
      var p = pos[ids[i]];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    var w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    var area = w * h;
    var kx = Math.sqrt(area * aspect) / w;
    var ky = Math.sqrt(area / aspect) / h;
    for (var j = 0; j < ids.length; j++) {
      var q = pos[ids[j]];
      q.x = minX + (q.x - minX) * kx;
      q.y = minY + (q.y - minY) * ky;
    }
  }

  // Aspects the two bakes were stabilised at (scripts/graph-layout.py). Not a
  // guess: the client picks whichever is NEARER its own viewport, on log
  // distance so 0.5 and 2.0 sit the same distance from 1.
  var BAKE_WIDE = 1.6;
  var BAKE_TALL = 0.5;

  // Swap in the tall bake when this window is closer to tall than to wide.
  //
  // The wide set is already baked into RAW_NODES, so there is nothing to do for
  // a desktop; the tall set rides in the payload as GRAPH_LAYOUT_TALL and gets
  // written over the positions here. Either way `stretchToViewport` still runs
  // afterwards — it only has to cover the REMAINDER now (0.49 against a bake at
  // 0.50, rather than against 1.6), which is the difference between a nudge and
  // a distortion.
  function useBakedAspect(pos, ids, aspect) {
    var tall = window.GRAPH_LAYOUT_TALL;
    if (!tall) {
      return false;
    }
    var toTall = Math.abs(Math.log(aspect / BAKE_TALL));
    var toWide = Math.abs(Math.log(aspect / BAKE_WIDE));
    if (toTall >= toWide) {
      return false;
    }
    var used = 0;
    for (var i = 0; i < ids.length; i++) {
      var p = tall[ids[i]];
      if (p) {
        pos[ids[i]].x = p[0];
        pos[ids[i]].y = p[1];
        used += 1;
      }
    }
    // All or nothing: a half-applied layout puts the rest of the graph at
    // coordinates from the other shape, which draws as two clouds overlapping.
    return used === ids.length;
  }

  function snapToGrid() {
    var b = nodeBounds();
    var pos = network.getPositions();
    var ids = Object.keys(pos);
    // BEFORE anything reshapes them. This is what scripts/graph-layout.py bakes,
    // so it has to be the layout as the PHYSICS left it — captured after the
    // stretch (as it was until now), the bake stored a cloud already pulled to
    // the bake window's 1.6, and every client then stretched that again to its
    // own aspect. The final ratio still came out right, because the stretch
    // recomputes from whatever bbox it is given, but the distortion compounded.
    var preSnap = {};
    for (var s0 = 0; s0 < ids.length; s0++) {
      preSnap[ids[s0]] = [Math.round(pos[ids[s0]].x), Math.round(pos[ids[s0]].y)];
    }
    window.__GP_PRESNAP = preSnap;
    // Shape the CLOUD to the window first, by moving communities. Everything
    // below then works on an outline that already matches the screen, so the
    // snap itself needs no scaling at all — which is what keeps the spacing
    // uniform and the picture undistorted.
    var aspect = b.vw / Math.max(b.vh, 1);
    packCommunities(pos, ids, aspect);
    useBakedAspect(pos, ids, aspect);
    stretchToViewport(pos, ids, aspect);
    // Bounds recomputed from the RESHAPED positions: `b` came from the network,
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
