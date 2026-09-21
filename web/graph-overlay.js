// /graph overlay behavior — injected by the /graph route (api/routes_graph.py).
// Layout: graph canvas on top, physics + node-info panels collapsed at the edges.
//
// The page is DELIBERATELY STILL. graphify stabilises the layout once (physics
// params are patched in server-side by graph_style._tune_graph_physics) and then
// graph.html's own `stabilizationIterationsDone` handler switches physics off for
// good. This file used to undo exactly that — re-enabling physics, running a
// camera tour, and random-walking gravity every 10s — which left a 4.5k-node
// canvas redrawing every frame forever, measured at 0.4 fps with 4.2s frames.
// What replaced the tour is `highlight()`: the camera never moves, and the
// hovered node's whole COMMUNITY goes bold white instead.
//
// Everything that can be decided once per artifact (label font, long-label
// redaction, dropping unconnected nodes) now happens server-side in
// graph_style/graph_scrub, so nothing here walks the whole DataSet at load.
//
// `network`, `nodesDS` and `edgesDS` are top-level consts in graph.html's classic
// script, reachable here through the shared global lexical scope.
/* global network, nodesDS, edgesDS, showInfo */
(function () {
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
      return;
    }
    var orig = showInfo;
    window.showInfo = function (id) {
      orig(id);
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

  // Physics column (bottom-left). vis renders the configurator into its inner
  // body via configure.container, so it survives vis's internal re-renders. The
  // panel keeps its `enabled` checkbox (see graph-overlay.css) — physics is off
  // by default now, so restarting the sim is the one thing a slider needs.
  function buildPhysicsColumn() {
    // No custom header — vis renders its own "physics" group header inside.
    var panel = document.createElement('div');
    panel.id = 'gp-physics';
    var body = document.createElement('div');
    body.className = 'gp-panel-body';
    panel.appendChild(body);
    document.body.appendChild(panel);
    return body;
  }

  // One always-visible toggle per panel (collapsed by default, so the button is
  // the only thing shown until clicked). Opening one autocloses the other.
  function addToggles() {
    var specs = [
      { cls: 'phys', body: 'gp-phys-open', open: '▾', closed: '▴' },
      { cls: 'info', body: 'gp-info-open', open: '▸', closed: '◂' },
    ];
    var btns = {};
    specs.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-toggle gp-min-btn ' + s.cls;
      btn.textContent = s.closed;
      document.body.appendChild(btn);
      btns[s.body] = btn;
      btn.addEventListener('click', function () {
        var open = document.body.classList.toggle(s.body);
        btn.textContent = open ? s.open : s.closed;
        if (open) {
          specs.forEach(function (o) {
            if (o.body !== s.body) {
              document.body.classList.remove(o.body);
              btns[o.body].textContent = o.closed;
            }
          });
        }
      });
    });
  }

  // ── community highlight (what replaced the camera tour) ───────────────────
  // Hover or tap any node and its WHOLE community — every node in it and every
  // edge inside it — goes bold white. The camera never moves: the tour used to
  // fly to a cluster and show you it alone; this shows you where that cluster
  // lives in the graph you are already looking at.
  //
  // It writes to `network.body` and NEVER to the DataSets. A DataSet update
  // fires vis's whole _dataUpdated cascade — visible-index rebuild, physics-body
  // rebuild for all 4.5k nodes and 6.5k edges — which measured 5.7s against
  // 1.0s for mutating the drawn objects and redrawing once. Leaving the DataSets
  // pristine also makes them the restore source: clearing reads the original
  // colour straight back out of them.
  var WHITE = '#ffffff';
  var BORDER_ON = 4;
  var EDGE_WIDTH_ON = 3;
  var baseBorder = 2;       // resolved from the first drawn node at init
  var baseEdgeColor = null; // ditto for edges — RAW_EDGES colours are uniform
  var commNodes = {};       // community id -> node ids
  var commEdges = {};       // community id -> edge ids with BOTH ends inside
  var commOf = {};          // node id -> community id
  var lit = null;           // the community currently highlighted

  function indexCommunities() {
    nodesDS.forEach(function (n) {
      var c = n._community;
      if (c === undefined || c === null) {
        return;
      }
      commOf[n.id] = c;
      (commNodes[c] = commNodes[c] || []).push(n.id);
    });
    edgesDS.forEach(function (e) {
      var c = commOf[e.from];
      if (c !== undefined && c === commOf[e.to]) {
        (commEdges[c] = commEdges[c] || []).push(e.id);
      }
    });
    var firstNode = network.body.nodes[nodesDS.getIds()[0]];
    if (firstNode) {
      baseBorder = firstNode.options.borderWidth;
    }
    var firstEdge = network.body.edges[edgesDS.getIds()[0]];
    if (firstEdge) {
      baseEdgeColor = JSON.parse(JSON.stringify(firstEdge.options.color));
    }
  }

  function paint(cid, on) {
    (commNodes[cid] || []).forEach(function (id) {
      var n = network.body.nodes[id];
      if (!n) {
        return;
      }
      var src = nodesDS.get(id);
      n.setOptions(on
        ? { borderWidth: BORDER_ON,
          color: { background: src.color.background, border: WHITE,
            highlight: { background: src.color.background, border: WHITE },
            hover: { background: src.color.background, border: WHITE } } }
        : { borderWidth: baseBorder, color: src.color });
    });
    (commEdges[cid] || []).forEach(function (id) {
      var e = network.body.edges[id];
      if (!e) {
        return;
      }
      // inherit:false is the load-bearing half — left inheriting, the edge takes
      // its colour from its endpoint node and ignores `color.color` entirely.
      e.setOptions(on
        ? { width: EDGE_WIDTH_ON,
          color: { color: WHITE, inherit: false, opacity: 1 } }
        : { width: edgesDS.get(id).width, color: baseEdgeColor });
    });
  }

  function highlight(nodeId) {
    // Normalise "no community" to null BEFORE the compare — a full redraw costs
    // ~1.5s on the slowest device that reaches this page, so the no-op case has
    // to actually be a no-op.
    var cid = nodeId !== null && nodeId !== undefined && commOf[nodeId] !== undefined
      ? commOf[nodeId] : null;
    if (cid === lit) {
      return;
    }
    if (lit !== null) {
      paint(lit, false);
    }
    lit = cid;
    if (lit !== null) {
      paint(lit, true);
    }
    network.redraw();
  }

  function wireHighlight() {
    indexCommunities();
    network.on('hoverNode', function (p) { highlight(p.node); });
    network.on('blurNode', function () { highlight(null); });
    // Touch never hovers, so a tap has to do it too — and a tap on empty canvas
    // clears, which is the only way back on a phone.
    network.on('click', function (p) {
      highlight(p.nodes && p.nodes.length ? p.nodes[0] : null);
    });
  }

  // Hard zoom/pan walls: the camera STOPS at the threshold rather than
  // snapping back. vis-network has no node-count zoom bound, so translate the
  // intent into scale + pan bounds and clamp them in place on each USER
  // gesture:
  //   - zoom OUT wall: the whole cloud fits, with a little air around it. The
  //     page OPENS at that fit, so this wall has to admit it — it used to cap
  //     the viewport at half the cloud's area, which the opening fit violated
  //     on arrival.
  //   - zoom IN wall: viewport world-area >= 2 nodes' worth of area, so >= ~2
  //     nodes stay in frame  -> a maximum scale.
  //   - pan wall: the viewport centre is clamped to the node bounding box, so
  //     the cloud can't be dragged off-screen.
  // Bounds are recomputed live from current node positions. Physics is off, so
  // they only actually change if a node is dragged.
  var MIN_VISIBLE = 2;
  var FIT_MARGIN = 0.8;   // how far past a whole-graph fit you may still zoom out

  function setupZoomLimits() {
    if (typeof network === 'undefined' || typeof nodesDS === 'undefined') {
      return;
    }
    var container = document.getElementById('graph');
    if (!container) {
      return;
    }
    var liveIds = nodesDS.getIds();
    if (liveIds.length <= MIN_VISIBLE) {
      return;
    }
    var clamping = false;   // re-entrancy guard for our own moveTo

    // Live node bounding box + scale walls derived from it.
    function bounds() {
      var pos = network.getPositions(liveIds);
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var id in pos) {
        var p = pos[id];
        if (p.x < minX) { minX = p.x; }
        if (p.x > maxX) { maxX = p.x; }
        if (p.y < minY) { minY = p.y; }
        if (p.y > maxY) { maxY = p.y; }
      }
      var w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
      var vp = container.clientWidth * container.clientHeight;
      // the scale at which the whole cloud fits the viewport
      var fit = Math.min(container.clientWidth / w, container.clientHeight / h);
      return {
        minX: minX, maxX: maxX, minY: minY, maxY: maxY,
        minScale: fit * FIT_MARGIN,
        // viewport world-area = vp / scale^2; floor it at 2/n of the cloud area
        maxScale: Math.sqrt(vp / (w * h * (MIN_VISIBLE / liveIds.length))),
      };
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

  // Cover the graph while the one stabilisation pass runs, then reveal the whole
  // fitted graph at once. The bar tracks vis's real `stabilizationProgress` —
  // the CSS keyframe it replaced ran for a flat 3s and then sat full while the
  // layout kept settling, which is how a 20s cap came to lift the cover onto a
  // blank canvas. LOAD_CAP is a failsafe against a `stabilizationIterationsDone`
  // that never arrives, not a schedule.
  var LOAD_CAP = 120000;

  function showLoading() {
    var overlay = document.createElement('div');
    overlay.id = 'gp-loading';
    var track = document.createElement('div');
    track.className = 'gp-load-track';
    var fill = document.createElement('div');
    fill.className = 'gp-load-fill';
    track.appendChild(fill);
    overlay.appendChild(track);
    document.body.appendChild(overlay);
    var done = false;
    return {
      progress: function (frac) {
        fill.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
      },
      reveal: function () {
        if (done) {
          return;
        }
        done = true;
        fill.style.width = '100%';
        overlay.classList.add('gp-hide');
        document.body.classList.add('gp-loaded');
        setTimeout(function () { overlay.remove(); }, 800);
      },
    };
  }

  function go(cover) {
    if (typeof network === 'undefined') {
      setTimeout(function () { go(cover); }, 50);
      return;
    }
    patchInfoPanel();
    network.setOptions({
      configure: {
        enabled: true,
        filter: 'physics',
        showButton: true,
        container: buildPhysicsColumn(),
      },
    });
    // physics collapses down (▾ open / ▴ collapsed); node info collapses right
    // (▸ open / ◂ collapsed). Both start collapsed; opening one closes the other.
    addToggles();
    wireHighlight();
    setupZoomLimits();
    // Open on the whole graph. graphify's stabilization already carries
    // fit:true, but it fits BEFORE our CSS has finished sizing the canvas, so
    // re-fit once the layout is final and the cover is about to lift.
    network.on('stabilizationProgress', function (p) {
      cover.progress(p && p.total ? p.iterations / p.total : 0);
    });
    network.once('stabilizationIterationsDone', function () {
      network.fit({ animation: false });
      cover.reveal();
    });
    setTimeout(cover.reveal, LOAD_CAP);
  }

  // Reload after the device wakes from sleep. While suspended, setInterval is
  // paused; on wake the first tick fires far later than its period — a gap that
  // big means we slept, and the physics/canvas come back wedged, so a fresh load
  // is the clean recovery.
  (function watchSleep() {
    var last = Date.now();
    setInterval(function () {
      var now = Date.now();
      if (now - last > 30000) {   // tick >30s late => slept
        location.reload();
      }
      last = now;
    }, 10000);
  })();

  go(showLoading());
})();
