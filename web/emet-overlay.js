// emet overlay — two collapsible panels over the vis graph, mirroring /graph:
//   - physics: vis configurator in a bottom strip, collapses DOWN
//   - node info: the #side observations panel, collapses RIGHT
// Behavior only; geometry/skin live in web/emet.css. The renderer
// (api/templates/emet.html) exposes the vis network as window.net.
(function () {
  function ready(cb) {
    if (window.net) { cb(window.net); return; }
    setTimeout(function () { ready(cb); }, 50);
  }

  // Physics column — vis renders its configurator into our container via
  // configure.container, so it survives vis's internal re-renders.
  function buildPhysicsPanel(net) {
    var panel = document.createElement('div');
    panel.id = 'emet-physics';
    var body = document.createElement('div');
    body.className = 'emet-panel-body';
    panel.appendChild(body);
    document.body.appendChild(panel);
    net.setOptions({
      configure: { enabled: true, filter: 'physics', showButton: false, container: body },
    });
  }

  // One always-visible toggle per panel (collapsed by default). Opening one
  // closes the other.
  var btns = {};
  function setPanel(target, force) {
    var open = force === null ? !document.body.classList.contains(target) : force;
    Object.keys(btns).forEach(function (b) {
      var on = b === target ? open : false;
      document.body.classList.toggle(b, on);
      btns[b].btn.querySelector('.emet-tg-glyph').textContent =
        on ? btns[b].spec.open : btns[b].spec.closed;
    });
  }

  function addToggles() {
    var specs = [
      { cls: 'phys', body: 'emet-phys-open', open: '▾', closed: '▴', label: 'physics' },
      { cls: 'info', body: 'emet-info-open', open: '▸', closed: '◂', label: 'node' },
    ];
    specs.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emet-toggle ' + s.cls;
      btn.innerHTML = '<span class="emet-tg-glyph">' + s.closed + '</span> ' + s.label;
      document.body.appendChild(btn);
      btns[s.body] = { btn: btn, spec: s };
      btn.addEventListener('click', function () { setPanel(s.body, null); });
    });
  }

  ready(function (net) {
    buildPhysicsPanel(net);
    addToggles();
    // clicking a node opens the info drawer (the renderer fills #side content)
    net.on('click', function (p) {
      if (p.nodes && p.nodes.length) { setPanel('emet-info-open', true); }
    });
  });
})();
