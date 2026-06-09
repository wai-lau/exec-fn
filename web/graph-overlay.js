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
      theta: 0.4,
      gravitationalConstant: -604,
      centralGravity: 0.03,
      springLength: 10,
      springConstant: 0.22,
      damping: 1,
      avoidOverlap: 1,
    },
    maxVelocity: 66,
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
        font: { size: 12, color: '#ffffff', face: 'Iosevka Mayukai Monolite, monospace' },
      };
    });
    nodesDS.update(updates);
  }

  // Our own "freeze" checkbox — inverted physics toggle. Checked = physics off
  // (frozen), unchecked = physics on. Replaces vis's native "enabled" checkbox
  // (hidden via CSS), which had the opposite meaning.
  function makeFreeze() {
    var row = document.createElement('label');
    row.className = 'gp-freeze';
    var span = document.createElement('span');
    span.textContent = 'freeze:';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', function () {
      network.setOptions({ physics: { enabled: !cb.checked } });
    });
    row.appendChild(span);
    row.appendChild(cb);
    return row;
  }

  // Physics column (bottom-left). vis renders the configurator into its inner
  // body via configure.container, so it survives vis's internal re-renders.
  function buildPhysicsColumn() {
    // No custom header — vis renders its own "physics" group header inside.
    var panel = document.createElement('div');
    panel.id = 'gp-physics';
    var body = document.createElement('div');
    body.className = 'gp-panel-body';
    panel.appendChild(makeFreeze());
    panel.appendChild(body);
    document.body.appendChild(panel);
    return body;
  }

  // Single button: slide the whole bottom half down (and the graph reclaims it).
  function addBottomToggle() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gp-bottom-toggle gp-min-btn';
    btn.textContent = '▾';
    btn.title = 'hide physics + graph panels';
    document.body.appendChild(btn);
    btn.addEventListener('click', function () {
      var hidden = document.body.classList.toggle('gp-bottom-hidden');
      btn.textContent = hidden ? '▴' : '▾';
      // graph container height changed — let vis repaint to the new size.
      setTimeout(function () {
        if (typeof network !== 'undefined') {
          network.setSize('100%', '100%');
          network.redraw();
        }
      }, 220);
    });
  }

  function go() {
    if (typeof network === 'undefined') {
      setTimeout(go, 50);
      return;
    }
    showAllLabels();
    var physBody = buildPhysicsColumn();
    network.setOptions({ physics: PHYSICS });
    network.setOptions({
      configure: {
        enabled: true,
        filter: 'physics',
        showButton: true,
        container: physBody,
      },
    });
    addBottomToggle();
    // graph.html disables physics once stabilization finishes (its own `once`
    // handler). Re-enable it exactly once — `.once` avoids a re-stabilization loop.
    network.once('stabilizationIterationsDone', function () {
      network.setOptions({ physics: { enabled: true } });
    });
  }
  go();
})();
