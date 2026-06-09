// /graph overlay behavior — injected by the /graph route (api/main.py).
// Enable vis-network's built-in live physics-tuning panel. graphify bakes the
// physics as constants with no UI; turn on `configure` so the sliders are
// available, and re-inject on every rebuild via the route (not graph.html).
// `network` is a top-level const in graph.html's classic script, reachable
// here through the shared global lexical scope.
(function () {
  function go() {
    if (typeof network === 'undefined') {
      setTimeout(go, 50);
      return;
    }
    network.setOptions({
      configure: { enabled: true, filter: 'physics', showButton: true },
    });
  }
  go();
})();
