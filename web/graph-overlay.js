// /graph overlay behavior — injected by the /graph route (api/routes_graph.py).
// Layout: graph canvas on top, physics + node-info panels collapsed at the edges.
//
// The LAYOUT is deliberately still. graphify stabilises it once (physics params
// are patched in server-side by graph_style._tune_graph_physics) and then
// graph.html's own `stabilizationIterationsDone` handler switches physics off for
// good. This file used to undo exactly that — re-enabling physics, flying a
// camera from cluster to cluster, and random-walking gravity every 10s — which
// left a 4.5k-node canvas redrawing every frame forever, measured at 0.4 fps
// with 4.2s frames.
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

  // ── the tour ───────────────────────────────────────────────────────────────
  // It lives in graph-pulse.js, on its own transparent canvas over vis's. All
  // this file does is hand it the pointer: hover or tap pins one community lit
  // and steady, leaving or tapping empty canvas releases it back to the firing
  // simulation. On a phone that empty tap is the only way out of a pinned
  // community.
  //
  // Nothing here writes to the DataSets OR to network.body any more. The old
  // highlight mutated the drawn node objects and called network.redraw(), which
  // is one full redraw of 2722 nodes per change — affordable at one hover, not at
  // 60 frames a second. The overlay draws only what is lit.
  function wirePulse() {
    graphPulse.init();
    network.on('hoverNode', function (p) { graphPulse.pin(p.node); });
    network.on('blurNode', function () { graphPulse.unpin(); });
    network.on('click', function (p) {
      if (p.nodes && p.nodes.length) {
        graphPulse.pin(p.nodes[0]);
      } else {
        graphPulse.unpin();
      }
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
      wirePulse();
      watchSleep();
    });
    setTimeout(cover.reveal, LOAD_CAP);
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

  go(showLoading());
})();
