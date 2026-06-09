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
(function () {
  var PHYSICS = {
    enabled: true,
    forceAtlas2Based: {
      theta: 0.7,
      gravitationalConstant: -628,
      centralGravity: 0.045,
      springLength: 10,
      springConstant: 0.22,
      damping: 0.8,
      avoidOverlap: 1,
    },
    maxVelocity: 2,
    minVelocity: 1,
    solver: 'forceAtlas2Based',
    wind: { x: -19, y: 10 },
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

  // Control row: "freeze:" (inverted physics toggle — checked = physics off) and
  // "tour:" (camera tour on/off). Replaces vis's native "enabled" checkbox.
  var freezeCb = null;
  var tourCb = null;

  function labeledCheck(text, checked, onChange) {
    var label = document.createElement('label');
    var span = document.createElement('span');
    span.textContent = text;
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.addEventListener('change', onChange);
    label.appendChild(span);
    label.appendChild(cb);
    return { label: label, cb: cb };
  }

  function makeControls() {
    var row = document.createElement('div');
    row.className = 'gp-freeze';
    var freeze = labeledCheck('freeze:', false, function () {
      network.setOptions({ physics: { enabled: !freezeCb.checked } });
    });
    freezeCb = freeze.cb;
    var tour = labeledCheck('tour:', true, function () {
      setTour(tourCb.checked);
    });
    tourCb = tour.cb;
    row.appendChild(freeze.label);
    row.appendChild(tour.label);
    return row;
  }

  // Programmatic freeze: keep the checkbox and physics in sync.
  function setFreeze(on) {
    if (freezeCb) {
      freezeCb.checked = on;
    }
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
    panel.appendChild(makeControls());
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

  // Camera tour: pick a random cluster, focus its highest-degree node, switch
  // to another random cluster every 10s. Clusters with < 7 nodes are skipped.
  // Toggled by the "tour:" checkbox.
  var tourIds = [];
  var tourTimer = null;

  function focusRandomCluster() {
    if (!tourIds.length) {
      return;
    }
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
      if (tourCb && tourCb.checked) {
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
      setTimeout(function () { overlay.remove(); }, 800);
    }, 3000);
  }

  function go() {
    if (typeof network === 'undefined') {
      setTimeout(go, 50);
      return;
    }
    showAllLabels();
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

  showLoading();
  go();
})();
