// /graph overlay behavior — injected by the /graph route (api/main.py).
// Layout: graph canvas on top, physics + sidebar in the bottom half, one button
// to hide both downward.
// 1. Apply tuned physics defaults, keep physics ENABLED (graph.html disables it
//    after stabilization — re-enable once).
// 2. Force every node label visible and use the site font.
// 3. Render the physics configurator into our own persistent #gp-physics column
//    via configure.container so it never disappears across vis re-renders.
// `network` and `nodesDS` are top-level consts in graph.html's classic script,
// reachable here through the shared global lexical scope.
/* global network, nodesDS */
(function () {
  var PHYSICS = {
    enabled: true,
    forceAtlas2Based: {
      theta: 0.6,
      gravitationalConstant: -628,
      centralGravity: 0.025,
      springLength: 30,
      springConstant: 0.22,
      damping: 0.95,
      avoidOverlap: 1,
    },
    maxVelocity: 1,
    minVelocity: 1,
    solver: 'forceAtlas2Based',
    // No wind: a constant force keeps avg node velocity above minVelocity
    // forever, so the physics loop never idles -> CPU pegs and the graph goes
    // laggy ("freaks out") after running a while. Breathing now comes only from
    // the 10s gravity nudge, which lets the sim settle between pulses.
  };

  function showAllLabels() {
    if (typeof nodesDS === 'undefined') {
      return;
    }
    var updates = nodesDS.map(function (n) {
      return {
        id: n.id,
        font: { size: 12, color: '#ffffff', face: 'Iosevka Mayukai Monolite' },
      };
    });
    nodesDS.update(updates);
    // canvas labels need the web font loaded before they paint — repaint once ready
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        network.redraw();
      });
    }
  }

  // Redact any node label longer than 20 chars — show "[ redacted ]" instead.
  function redactLongLabels() {
    if (typeof nodesDS === 'undefined') {
      return;
    }
    var updates = [];
    nodesDS.forEach(function (n) {
      if (n.label && n.label.length > 20) {
        updates.push({ id: n.id, label: '[ redacted ]' });
      }
    });
    if (updates.length) {
      nodesDS.update(updates);
    }
  }

  // Hide orphaned nodes (no edges, _degree 0) by default — they clutter the
  // periphery and carry no relationships.
  function hideOrphans() {
    if (typeof nodesDS === 'undefined') {
      return;
    }
    var updates = [];
    nodesDS.forEach(function (n) {
      if (!n._degree) {
        updates.push({ id: n.id, hidden: true });
      }
    });
    if (updates.length) {
      nodesDS.update(updates);
    }
  }

  // Single either/or toggle: "freeze" (physics off, no camera tour) vs "tour"
  // (physics on + camera tour). Mutually exclusive. Default = tour.
  var modeToggle = null;
  var mode = 'tour';

  function makeControls() {
    var row = document.createElement('div');
    row.id = 'gp-controls';
    row.className = 'gp-freeze';
    var sw = document.createElement('div');
    sw.className = 'gp-toggle-switch';
    ['freeze', 'tour'].forEach(function (m) {
      var seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'gp-seg' + (m === mode ? ' active' : '');
      seg.dataset.mode = m;
      seg.textContent = m;
      seg.addEventListener('click', function () { setMode(m); });
      sw.appendChild(seg);
    });
    modeToggle = sw;
    row.appendChild(sw);
    return row;
  }

  function setMode(m) {
    mode = m;
    if (modeToggle) {
      modeToggle.querySelectorAll('.gp-seg').forEach(function (s) {
        s.classList.toggle('active', s.dataset.mode === m);
      });
    }
    network.setOptions({ physics: { enabled: m !== 'freeze' } });
    setTour(m === 'tour');
  }

  // Programmatic physics toggle — used by the load settle pulse only. Does not
  // touch the mode toggle (the pulse is transient; mode stays as selected).
  function setFreeze(on) {
    network.setOptions({ physics: { enabled: !on } });
  }

  // Physics column (bottom-left). vis renders the configurator into its inner
  // body via configure.container, so it survives vis's internal re-renders.
  function buildPhysicsColumn() {
    // No custom header — vis renders its own "physics" group header inside.
    var panel = document.createElement('div');
    panel.id = 'gp-physics';
    var body = document.createElement('div');
    body.className = 'gp-panel-body';
    panel.appendChild(body);
    document.body.appendChild(panel);
    // freeze/tour controls live in their own fixed top-left box, always visible
    // (independent of the collapsible physics panel).
    document.body.appendChild(makeControls());
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

  // Camera tour: pick a random cluster, focus its highest-degree node, switch
  // to another random cluster every 10s. Clusters with < 7 nodes are skipped.
  // Toggled by the "tour:" checkbox.
  var tourIds = [];
  var tourTimer = null;
  var gravBase = PHYSICS.forceAtlas2Based.gravitationalConstant;
  var gravConst = gravBase;
  var GRAV_BAND = 80;   // clamp the walk to +/-this around the base

  // Random-walk the gravitational constant by [-20, 20] each refocus so the
  // layout keeps breathing — but CLAMP it to a band around the base. Left
  // unbounded it drifts hundreds off over an hour, destabilising physics into
  // the laggy "freak out" the tour eventually hit.
  function nudgeGravity() {
    gravConst = Math.max(gravBase - GRAV_BAND,
      Math.min(gravBase + GRAV_BAND, gravConst + Math.random() * 40 - 20));
    network.setOptions({
      physics: { forceAtlas2Based: { gravitationalConstant: gravConst } },
    });
  }

  function focusRandomCluster() {
    if (!tourIds.length) {
      return;
    }
    nudgeGravity();
    var id = tourIds[Math.floor(Math.random() * tourIds.length)];
    network.focus(id, {
      scale: 0.65,
      animation: { duration: 1500, easingFunction: 'easeInOutQuad' },
    });
    network.selectNodes([id]);
  }

  function setTour(on) {
    if (tourTimer) {
      clearInterval(tourTimer);
      tourTimer = null;
    }
    if (on && tourIds.length) {
      focusRandomCluster();
      tourTimer = setInterval(focusRandomCluster, 10000);
    }
  }

  // How many distinct communities a node touches (itself + its neighbors).
  // Cross-cluster hubs (> 2) are skipped as focus targets.
  function clusterSpan(id, ownComm) {
    var comms = {};
    if (ownComm !== undefined && ownComm !== null) {
      comms[ownComm] = 1;
    }
    network.getConnectedNodes(id).forEach(function (nid) {
      var n = nodesDS.get(nid);
      if (n && n._community !== undefined && n._community !== null) {
        comms[n._community] = 1;
      }
    });
    return Object.keys(comms).length;
  }

  function initTour() {
    if (typeof nodesDS === 'undefined') {
      return;
    }
    var groups = {}; // community -> { topId, topDeg, count }
    nodesDS.forEach(function (n) {
      var c = n._community;
      var d = n._degree || 0;
      if (c === undefined || c === null) {
        return;
      }
      if (!groups[c]) {
        groups[c] = { topId: null, topDeg: -1, count: 0 };
      }
      groups[c].count += 1;
      // a node spanning > 2 clusters is a bridge hub — never a focus target
      if (clusterSpan(n.id, c) > 2) {
        return;
      }
      if (d > groups[c].topDeg) {
        groups[c].topDeg = d;
        groups[c].topId = n.id;
      }
    });
    tourIds = Object.keys(groups)
      .filter(function (c) { return groups[c].count >= 7 && groups[c].topId; })
      .map(function (c) { return groups[c].topId; });
    // let the initial fit settle, then start the tour if its checkbox is on
    setTimeout(function () {
      if (mode === 'tour') {
        setTour(true);
      }
    }, 2000);
  }

  // Cover the graph for 3s with a simple loading bar so the layout settles
  // before the nodes are revealed.
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
    setTimeout(function () {
      overlay.classList.add('gp-hide');
      document.body.classList.add('gp-loaded');
      setTimeout(function () { overlay.remove(); }, 800);
    }, 3000);
  }

  function go() {
    if (typeof network === 'undefined') {
      setTimeout(go, 50);
      return;
    }
    showAllLabels();
    redactLongLabels();
    hideOrphans();
    var physBody = buildPhysicsColumn();
    network.setOptions({ physics: PHYSICS });
    // settle fast (maxVelocity 200) while the 3s loading cover hides the graph,
    // then drop back to the default 0.5s before the cover lifts.
    network.setOptions({ physics: { maxVelocity: 200 } });
    setTimeout(function () {
      network.setOptions({ physics: { maxVelocity: PHYSICS.maxVelocity } });
    }, 2500);
    network.setOptions({
      configure: {
        enabled: true,
        filter: 'physics',
        showButton: true,
        container: physBody,
      },
    });
    // physics collapses down (▾ open / ▴ collapsed); node info collapses right
    // (▸ open / ◂ collapsed). Both start collapsed; opening one closes the other.
    addToggles();
    // graph.html disables physics once stabilization finishes (its own `once`
    // handler). Re-enable it exactly once — `.once` avoids a re-stabilization loop.
    network.once('stabilizationIterationsDone', function () {
      network.setOptions({ physics: { enabled: true } });
    });
    // Freeze-then-unfreeze pulse after load (settles, then resumes physics).
    setTimeout(function () {
      setFreeze(true);
      setTimeout(function () {
        setFreeze(false);
      }, 400);
    }, 800);
    initTour();
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

  showLoading();
  go();
})();
