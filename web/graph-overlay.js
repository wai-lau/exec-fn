// /graph overlay behavior — injected by the /graph route (api/main.py).
// 1. Apply tuned physics defaults (graphify bakes its own into graph.html, but
//    that file is regenerated each rebuild, so we override here at serve time).
// 2. Enable vis-network's live physics configurator so values stay tunable.
// `network` is a top-level const in graph.html's classic script, reachable here
// through the shared global lexical scope.
(function () {
  var PHYSICS = {
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

  // graphify zeroes font size on low-degree nodes; force every label visible.
  function showAllLabels() {
    if (typeof nodesDS === 'undefined') {
      return;
    }
    var updates = nodesDS.map(function (n) {
      return { id: n.id, font: { size: 12, color: '#ffffff' } };
    });
    nodesDS.update(updates);
  }

  function go() {
    if (typeof network === 'undefined') {
      setTimeout(go, 50);
      return;
    }
    showAllLabels();
    network.setOptions({ physics: PHYSICS });
    network.setOptions({
      configure: { enabled: true, filter: 'physics', showButton: true },
    });
  }
  go();
})();
