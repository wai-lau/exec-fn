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
  // The opening scale is no longer its own number. It was 0.75 (a quarter OUT,
  // back when the cloud was square and cover cropped hard on the long axis), then
  // 1 once graph-lattice.js shaped the positions to the viewport and made cover
  // and contain the same, then 1.2 on request — a fifth IN, cropping about a
  // sixth off each axis for nodes big enough to read. It now opens at the
  // FURTHEST the zoom walls allow instead: `contain * FIT_MARGIN`, the identical
  // expression setupZoomLimits clamps to, so the opening view and the outward
  // wall cannot drift apart into a page that opens past where it will let you
  // return to. ARCHAEOLOGY §11 has the earlier values.
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
      var content = document.getElementById('info-content');
      // The node's name IS the title: graph.html's fixed "Node Info" heading
      // plus the label repeated as the body's first field rendered it twice.
      var head = document.querySelector('#info-panel h3');
      if (head && n && n.label) {
        head.textContent = n.label;
      }
      var first = content ? content.querySelector('.field') : null;
      // Matched, not indexed: generated markup, and a blind removal of field
      // one deletes whatever moves into its place when graphify reorders.
      if (first && n && (first.textContent || '').trim() === String(n.label).trim()) {
        first.remove();
      }
      if (!isRedacted(n) || !content) {
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
      var b = gpLattice.bounds();
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
      // The phase text belongs to graph-cover.js's loader, which knows which
      // half of the wait this is. Writing it from here too made it run
      // BACKWARDS — 'building the graph' then 'fetching graph data' again —
      // because this poll starts before the payload sets its done marker.
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

  // How long the reveal will wait for the page to finish settling before it
  // gives up and shows what there is. Long enough for a slow phone to paint two
  // frames, short enough that nobody sits behind a cover over a finished graph.
  var READY_CAP = 3000;
  // From vis's first painted frame, how long the reveal will hold out for the
  // cascade before showing the graph without it. Short: by here the page is
  // drawn and correct, and the only thing still missing is the first spark.
  var DRAWN_CAP = 800;

  // The snap is the most expensive step left and it blocks the thread solid, so
  // the phase is named and then a macrotask is YIELDED before it starts. Setting
  // the text and blocking in the same turn paints neither: the bar would sit
  // where it was through the one pause a visitor actually notices, which is
  // exactly what was reported — "fills almost immediately, then pauses".
  // Centre the tapped node in what is LEFT of the window, not in the window.
  //
  // The node info panel covers the right-hand side, so vis centring on the
  // canvas centre puts the node you just asked about underneath the thing that
  // opened to tell you about it. The visible strip runs from 0 to (W - panel),
  // whose middle sits half a panel LEFT of the canvas centre — so the camera
  // moves half a panel RIGHT of the node, in world units, and the node lands in
  // the middle of what you can actually see.
  //
  // NEXT FRAME, so the pan and the panel move together — long enough for the
  // class that opens the panel to be set, short enough to be one gesture. It
  // waited 300ms once and the graph lurched into place after the panel had
  // already arrived. ARCHITECTURE §11.
  function centreBesidePanel(id) {
    requestAnimationFrame(function () {
      var sb = document.getElementById('sidebar');
      var host = document.getElementById('graph');
      // Only offset for a panel that is actually out. Its width measures 360
      // whether it is on screen or parked off it, so the class is the only
      // honest test — and with no panel the node still centres, just in the
      // whole window.
      var open = document.body.classList.contains('gp-info-open');
      var w = (open && sb) ? sb.getBoundingClientRect().width : 0;
      var p = network.getPositions([id])[id];
      var scale = network.getScale();
      if (!p || !scale || !host) {
        return;
      }
      // MEASURED, not computed from the node's world position. Working out
      // "centre plus half a panel" open-loop assumes the node starts at the
      // canvas centre, and it does not: graph.html's own click handler moves the
      // camera too, so the correction landed 156px out. Ask where the node
      // actually IS on screen, ask where it should be, and move the camera by
      // the difference — which is right whatever else panned first.
      var at = network.canvasToDOM(p);
      var wantX = (host.clientWidth - w) / 2;
      var wantY = host.clientHeight / 2;
      var view = network.getViewPosition();
      // NO animation, and that is not laziness. Every animated frame is a full
      // vis redraw of 2,581 nodes — measured at ~100ms each — so a 200ms pan is
      // two frames on a good day and, with a hub's cascade lighting at the same
      // time, took 2.1s to arrive. An instant move costs ONE redraw and lands
      // inside the panel's own 200ms slide, which is what "at the same time"
      // actually needs.
      network.moveTo({
        position: {
          x: view.x + (at.x - wantX) / scale,
          y: view.y + (at.y - wantY) / scale,
        },
      });
    });
  }

  function openView(cover) {
    cover.phase('placing nodes');
    setTimeout(function () { placeAndOpen(cover); }, 0);
  }

  function placeAndOpen(cover) {
    {
      // Open on COVER, not contain — a wallpaper's fill mode. vis's own fit()
      // is contain: it scales until the limiting axis fits and leaves the other
      // one as empty margin, which on this near-square cloud in a wide window
      // was two black bands and the graph sitting in the middle distance. Cover
      // takes the scale from the OTHER axis instead, so neither edge has a gap
      // and the graph runs off the limiting one. Centred on the node bounding
      // box, so what overflows is shared evenly top and bottom (or left and
      // right), never all at one end.
      // Timed, and left on the window for the cover to read: this is one of
      // the three numbers that say where a slow load went, and the only one
      // measured on our side of the payload.
      var t0 = performance.now();
      gpLattice.snap();
      window.__GP_PLACE_MS = performance.now() - t0;
      var b = gpLattice.bounds();   // recomputed: the snap moved everything
      network.moveTo({
        // The page opens at the FURTHEST ZOOM THE WALLS ALLOW, which is the same
        // number setupZoomLimits clamps to: contain x FIT_MARGIN. Opening at the
        // limit means the whole graph is on screen on arrival, with the margin
        // the wall already reserves, and the first gesture can only go inward.
        scale: b.contain * FIT_MARGIN,
        position: { x: b.cx, y: b.cy },
      });
      cover.progress(gpCover.PLACED);
      // The cover lifts when the page is FINISHED, not when the work is
      // ordered. Two things had to land first and neither of them had:
      // `moveTo` sets the camera but vis has not repainted at it yet, so the
      // reveal used to uncover the PREVIOUS frame and the graph jumped into
      // place afterwards; and graphPulse.init() only wires the model, so the
      // first cascade lit a second or so into a page that was already on
      // screen, which reads as a still graph that then twitches.
      //
      // So: wait for vis's own `afterDrawing` (the camera-correct frame is on
      // screen), then for the pulse's first painted frame (the animation is
      // running, not scheduled), and only then fade. READY_CAP is the floor
      // under all of it — a reveal that never comes is far worse than one that
      // comes a frame early, and both waits are for events that can be missed.
      var lifted = false;
      var lift = function () {
        if (!lifted) {
          lifted = true;
          cover.reveal();
        }
      };
      setTimeout(lift, READY_CAP);
      network.once('afterDrawing', function () {
        // vis has painted the graph at the opening camera. What is left is the
        // cascade lighting its first frame, which is the last 10%.
        cover.progress(gpCover.DRAWN);
        cover.phase('drawing');
        // Waiting for the first lit frame is still the intent — the page should
        // arrive finished, not arrive and then twitch. But it is no longer the
        // only way out: a phone froze between this line and that frame, with
        // the cover up and even the 3s failsafe unable to fire, because a timer
        // cannot run on a thread that never yields. graphPulse.index() now
        // yields between phases so a timer CAN fire, and this second, shorter
        // cap means the graph is on screen either way. Whichever lands first
        // wins; lift is idempotent.
        setTimeout(lift, DRAWN_CAP);
        graphPulse.init(lift);
      });
      // moveTo above already queued the redraw that fires it; ask explicitly in
      // case the camera did not actually change and vis had nothing to do.
      network.redraw();
      // Tapping a node fires the same cascade the model seeds on its own, from
      // that node: the burst, the stagger, the outward walk, all of it — a node
      // is interesting for what it reaches, and the cascade is the thing that
      // draws what it reaches. graph.html's own handler still opens the node
      // panel; vis takes both listeners.
      network.on('click', function (params) {
        if (params && params.nodes && params.nodes.length) {
          // Camera first, cascade second: the cascade is hundreds of lit nodes
          // on a hub and it competes for the same thread the pan needs.
          centreBesidePanel(params.nodes[0]);
          graphPulse.seed(params.nodes[0]);
        }
      });
      watchWake();
    }
  }

  // A tab coming back from the background used to RELOAD the page: while it was
  // suspended setInterval stopped, so a tick landing a minute late meant "we
  // slept", and the canvas comes back wedged from a suspend.
  //
  // On a phone that recovery is worse than the fault. iOS freezes a backgrounded
  // tab within seconds, so switching apps and returning ALWAYS tripped it, and a
  // reload of /graph is a black page for the whole load (#graph is opacity 0
  // until gp-loaded). Reported exactly that way: black page after going to
  // another tab and coming back. The old comment even records the same shape of
  // bug on the droplet — a reload landing in another stabilisation, which
  // tripped it again.
  //
  // A wedged canvas does not need the document thrown away. Re-measure our own
  // backing store and ask vis to redraw: same repair, no reload, no black page,
  // and it hangs off `visibilitychange`, which is the event that actually means
  // "you are back" — no interval, no 60s guess, and nothing to false-positive on
  // a main thread that was merely busy.
  function wake() {
    try {
      if (typeof graphPulseDraw !== 'undefined' && graphPulseDraw.resize) {
        graphPulseDraw.resize();
      }
      if (typeof network !== 'undefined') {
        network.redraw();
      }
    } catch (err) {
      // A redraw that throws is still not worth a reload — the page is readable
      // either way, and reloading is the thing that cost a visible three
      // minutes.
    }
  }

  function watchWake() {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        wake();
      }
    });
    // bfcache restore: iOS serves the page back without firing visibilitychange.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) {
        wake();
      }
    });
  }

  // graph-cover.js is now the bar AND the payload loader, so the page carries no
  // <script src> for the payload at all. If that file never ran, nothing would
  // fetch it and nothing would reveal — belt for both, before anything below
  // assumes either.
  if (window.GRAPH_BOOT_URL && !window.__GP_BOOT_STARTED) {
    var boot = document.createElement('script');
    boot.src = window.GRAPH_BOOT_URL;
    document.head.appendChild(boot);
  }
  if (!window.gpCover) {
    window.gpCover = {
      CAP: 180000,
      show: function () {
        return {
          phase: function () { return; },
          progress: function () { return; },
          indeterminate: function () { return; },
          reveal: function () { document.body.classList.add('gp-loaded'); },
        };
      },
      fail: function () { document.body.classList.add('gp-loaded'); },
    };
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
