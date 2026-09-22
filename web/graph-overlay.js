// /graph overlay behavior — injected by the /graph route (api/routes_graph.py).
// Layout: graph canvas on top, the node-info panel collapsed at the right edge.
//
// The LAYOUT is deliberately still. graphify stabilises it once (physics params
// are patched in server-side by graph_style._tune_graph_physics) and then
// graph.html's own `stabilizationIterationsDone` handler switches physics off for
// good. This file used to undo exactly that — re-enabling physics, flying a
// camera from cluster to cluster, and random-walking gravity every 10s — which
// left a 4.5k-node canvas redrawing every frame forever, measured at 0.4 fps
// with 4.2s frames. The physics configurator panel went with it: a strip of live
// sliders governs nothing once the sim is off for good and a reload would undo
// whatever they were dragged to.
//
// The TOUR survived that; only its mechanism changed. It lives in
// graph-pulse.js now — a transparent canvas over vis's, drawing only what is
// currently lit, so the graph stays whole and still while activity travels
// across it. This file just hands it the pointer.
//
// Everything that can be decided once per artifact (label font, long-label
// redaction, dropping unconnected nodes) now happens server-side in
// graph_style/graph_scrub, so nothing here walks the whole DataSet at load.
//
// `network`, `nodesDS` and `edgesDS` are top-level consts in graph.html's classic
// script, reachable here through the shared global lexical scope.
/* global network, nodesDS, graphPulse, showInfo */
(function () {
  var OPEN_ZOOM_OUT = 0.75;   // applied to the cover scale on first open
  // Lattice density: cells over the cloud's bounding box, per node. Above 1
  // there is room for most nodes to land on their first choice; the rest walk
  // outward. 4 keeps the walk short while still reading as a grid.
  var CELLS_PER_NODE = 4;
  // A node is "redacted" when its label was blanked — server-side to
  // "[redacted]" (_redact_graph_nodes) or "[ redacted ]" (_label_graph_nodes,
  // for anything over 20 chars). For those, the node-info panel must not leak
  // Type/Source or the neighbor list.
  function isRedacted(n) {
    return n && (n.label === '[ redacted ]' || n.label === '[redacted]');
  }

  // graph.html defines showInfo() (global, classic script). Wrap it so that
  // after it renders, redacted nodes get Type/Source blanked to "redacted" and
  // their neighbors section removed. Community + Degree stay. The bare identifier
  // showInfo in graph.html's click/focus handlers resolves to this global.
  function patchInfoPanel() {
    if (typeof showInfo !== 'function') {
      // graph.html defines network before showInfo, so the first attempt lands
      // too early. Bailing silently left every node click filling a panel that
      // stayed shut -- wait for it instead.
      setTimeout(patchInfoPanel, 50);
      return;
    }
    var orig = showInfo;
    window.showInfo = function (id) {
      orig(id);
      // Clicking a node used to fill the panel while leaving it collapsed, so
      // the click looked like it had done nothing and the answer only
      // appeared after a second click on the toggle.
      openInfo();
      var n = typeof nodesDS !== 'undefined' ? nodesDS.get(id) : null;
      if (!isRedacted(n)) {
        return;
      }
      var content = document.getElementById('info-content');
      if (!content) {
        return;
      }
      content.querySelectorAll('.field').forEach(function (f) {
        var t = f.textContent || '';
        if (t.indexOf('Type:') === 0) {
          f.textContent = 'Type: redacted';
        } else if (t.indexOf('Source:') === 0) {
          f.textContent = 'Source: redacted';
        } else if (t.indexOf('Neighbors') === 0) {
          f.remove();   // the "Neighbors (N)" header field
        }
      });
      var list = document.getElementById('neighbors-list');
      if (list) {
        list.remove();
      }
    };
  }

  // The node-info panel's toggle — always visible, and the only thing shown
  // while the panel is closed. It had a twin on the physics panel until that
  // panel was removed, which is why the wiring reads like it expects a pair.
  var infoBtn = null;

  // Open the node-info panel and put its toggle in the matching state. The
  // toggle owns the arrow glyph, so anything that opens the panel from
  // elsewhere has to move it too or the control lies about what it will do.
  function openInfo() {
    document.body.classList.add('gp-info-open');
    if (infoBtn) {
      infoBtn.textContent = '\u25b8';
    }
  }

  function addToggle() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gp-toggle gp-min-btn info';
    btn.textContent = '\u25c2';
    document.body.appendChild(btn);
    infoBtn = btn;
    btn.addEventListener('click', function () {
      var open = document.body.classList.toggle('gp-info-open');
      btn.textContent = open ? '\u25b8' : '\u25c2';
    });
  }

  // ── the tour ───────────────────────────────────────────────────────────────
  // It lives in graph-pulse.js, on its own transparent canvas over vis's, and it
  // is entirely self-driving: cascades seed themselves once a second and this
  // file only starts it. Hovering deliberately does NOT interrupt it — a hover
  // used to pin the hovered node's whole community lit and steady, and having the
  // animation stop dead under the pointer was worse than the question it answered.
  // Clicking a node opens the node-info panel: graph.html's own handler fills
  // it (showInfo) and the wrapper above slides it open. Nothing to do with the
  // canvas.
  //
  // Nothing here writes to the DataSets OR to network.body. The old highlight
  // mutated the drawn node objects and called network.redraw(), which is one full
  // redraw of 2722 nodes per change — affordable at one hover, not at 60 frames a
  // second. The overlay draws only what is lit.

  // Hard zoom/pan walls: the camera STOPS at the threshold rather than
  // snapping back. vis-network has no node-count zoom bound, so translate the
  // intent into scale + pan bounds and clamp them in place on each USER
  // gesture:
  //   - zoom OUT wall: the whole cloud CONTAINS, with a little air around it.
  //     Deliberately looser than the cover the page opens at, so zooming out to
  //     see every node at once is still allowed. It used to cap the viewport at
  //     half the cloud's area, which the opening view violated on arrival.
  //   - zoom IN wall: viewport world-area >= 2 nodes' worth of area, so >= ~2
  //     nodes stay in frame  -> a maximum scale.
  //   - pan wall: the viewport centre is clamped to the node bounding box, so
  //     the cloud can't be dragged off-screen.
  // Bounds are recomputed live from current node positions. Physics is off, so
  // they only actually change if a node is dragged.
  var MIN_VISIBLE = 2;
  var FIT_MARGIN = 0.8;   // how far past a whole-graph CONTAIN you may zoom out

  // The node bounding box in world units, plus the two scales derived from it.
  // Physics is off, so this only actually changes if a node is dragged.
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
    var cell = Math.sqrt((b.w * b.h) / Math.max(ids.length * CELLS_PER_NODE, 1));
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
      var g = nearestFree(taken,
        Math.round((p.x - b.minX) / cell),
        Math.round((p.y - b.minY) / cell));
      taken[g.x + ',' + g.y] = 1;
      // moveNode, not a DataSet write: a bulk update fires vis's _dataUpdated
      // cascade and rebuilds every physics body (7.4s against 1.07s).
      network.moveNode(ids[i], b.minX + g.x * cell, b.minY + g.y * cell);
    }
  }

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
    return {
      minX: minX, maxX: maxX, minY: minY, maxY: maxY,
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      n: ids.length,
      vp: cw * chh,
      w: w, h: h,
      // CONTAIN: every node on screen, margin on the axis that is not limiting.
      contain: Math.min(cw / w, chh / h),
      // COVER: no margin on either axis, overflow on the one that is not
      // limiting — a wallpaper's fill mode. This is what the page opens at.
      cover: Math.max(cw / w, chh / h),
    };
  }

  function setupZoomLimits() {
    if (typeof network === 'undefined' || typeof nodesDS === 'undefined') {
      return;
    }
    var container = document.getElementById('graph');
    if (!container) {
      return;
    }
    if (nodesDS.getIds().length <= MIN_VISIBLE) {
      return;
    }
    var clamping = false;   // re-entrancy guard for our own moveTo

    function bounds() {
      var b = nodeBounds();
      b.minScale = b.contain * FIT_MARGIN;
      // viewport world-area = vp / scale^2; floor it at 2/n of the cloud area
      b.maxScale = Math.sqrt(b.vp / (b.w * b.h * (MIN_VISIBLE / b.n)));
      return b;
    }

    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    function clampView() {
      if (clamping) {
        return;
      }
      var b = bounds();
      var scale = network.getScale();
      var pos = network.getViewPosition();
      var cs = clamp(scale, b.minScale, Math.max(b.minScale, b.maxScale));
      var cx = clamp(pos.x, b.minX, b.maxX);
      var cy = clamp(pos.y, b.minY, b.maxY);
      if (cs === scale && cx === pos.x && cy === pos.y) {
        return;
      }
      clamping = true;
      network.moveTo({ scale: cs, position: { x: cx, y: cy } });
      setTimeout(function () { clamping = false; }, 0);
    }

    network.on('zoom', function (params) {
      // vis zoom payload is {direction, scale, pointer} -- no `.event` field
      // (only dragEnd carries one). User wheel/pinch sets pointer non-null;
      // programmatic/keyboard zoom sends pointer:null -> skipped.
      if (params && params.pointer) {
        clampView();
      }
    });
    network.on('dragEnd', function (params) {
      if (params && params.nodes && params.nodes.length) {
        return;   // dragging a node, not panning the canvas
      }
      clampView();
    });
  }

  function go(cover) {
    if (typeof network === 'undefined') {
      // The payload marks itself done, so the wait splits in two: still coming
      // down the wire, or down and being turned into a graph.
      cover.phase(window.__GP_PAYLOAD_MS ? 'building the graph' : 'fetching graph data');
      setTimeout(function () { go(cover); }, 50);
      return;
    }
    cover.phase('drawing');
    patchInfoPanel();
    // node info collapses right (▸ open / ◂ collapsed), and starts collapsed.
    addToggle();
    setupZoomLimits();
    // Open on the whole graph. graphify's stabilization already carries
    // fit:true, but it fits BEFORE our CSS has finished sizing the canvas, so
    // re-fit once the layout is final and the cover is about to lift.
    network.on('stabilizationProgress', function (p) {
      cover.progress(p && p.total ? p.iterations / p.total : 0);
    });
    // With a BAKED layout there is no simulation, so stabilizationIterationsDone
    // never fires — and that event is what reveals the page. The server says
    // which case this is, because only it knows whether it found a layout for
    // this graph. Deferred a tick so the caller has finished wiring up first.
    if (window.GRAPH_LAYOUT_CACHED) {
      setTimeout(function () { openView(cover); }, 0);
    } else {
      network.once('stabilizationIterationsDone', function () { openView(cover); });
    }
    // A cap that fires while the page is genuinely still working would replace a
    // slow graph with a broken-looking one, so it only declares failure when
    // nothing ever arrived; otherwise it lifts the cover on what there is.
    setTimeout(function () {
      if (typeof network === 'undefined') {
        gpCover.fail('the graph did not load');
      } else {
        cover.reveal();
      }
    }, gpCover.CAP);
  }

  function openView(cover) {
    {
      // Open on COVER, not contain — a wallpaper's fill mode. vis's own fit()
      // is contain: it scales until the limiting axis fits and leaves the other
      // one as empty margin, which on this near-square cloud in a wide window
      // was two black bands and the graph sitting in the middle distance. Cover
      // takes the scale from the OTHER axis instead, so neither edge has a gap
      // and the graph runs off the limiting one. Centred on the node bounding
      // box, so what overflows is shared evenly top and bottom (or left and
      // right), never all at one end.
      snapToGrid();
      var b = nodeBounds();   // recomputed: the snap moved everything
      network.moveTo({
        // Cover, then out a quarter: cover alone runs the cloud right to both
        // edges, and a graph with no margin reads as cropped rather than as
        // filling the frame.
        scale: b.cover * OPEN_ZOOM_OUT,
        position: { x: b.cx, y: b.cy },
      });
      cover.reveal();
      graphPulse.init();
      watchSleep();
    }
  }

  // Reload after the device wakes from sleep. While suspended, setInterval is
  // paused; on wake the first tick fires far later than its period — a gap that
  // big means we slept, and the canvas comes back wedged, so a fresh load is the
  // clean recovery.
  //
  // It is ARMED ONLY AFTER the layout has settled, and the threshold is 60s, both
  // because of the same false positive: stabilising this graph blocks the main
  // thread in bursts, so on a slow device the interval was firing 30s+ late while
  // the page was simply working, and the page reloaded itself — into another
  // stabilisation, which tripped it again. Measured in headless WebKit on the
  // droplet, where a load ran long enough to do exactly that.
  var SLEEP_GAP = 60000;

  function watchSleep() {
    var last = Date.now();
    setInterval(function () {
      var now = Date.now();
      if (now - last > SLEEP_GAP) {
        location.reload();
      }
      last = now;
    }, 10000);
  }

  // Everything above is wired inside one call; if it throws — or if a script the
  // page depends on never arrives — the reveal it was going to schedule never
  // happens, and opacity 0 is forever. Both paths end at the same note.
  var _cover = gpCover.show();
  window.addEventListener('error', function (e) {
    if (!document.body.classList.contains('gp-loaded')) {
      gpCover.fail((e && e.message) || 'script error');
    }
  });
  try {
    go(_cover);
  } catch (err) {
    gpCover.fail((err && err.message) || 'script error');
  }
})();
