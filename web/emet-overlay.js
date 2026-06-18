// emet overlay — a single collapsible node-info panel (bottom strip, collapses
// down). Geometry/skin live in web/emet.css. The renderer (emet.html) fills the
// #side panel content on node click and exposes the vis network as window.net.
(function () {
  function ready(cb) {
    if (window.net) { cb(window.net); return; }
    setTimeout(function () { ready(cb); }, 50);
  }

  var btn;
  function setOpen(open) {
    document.body.classList.toggle('emet-info-open', open);
    if (btn) { btn.querySelector('.emet-tg-glyph').textContent = open ? '▾' : '▴'; }
  }

  function addToggle() {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emet-toggle info';
    btn.innerHTML = '<span class="emet-tg-glyph">▴</span> node';
    document.body.appendChild(btn);
    btn.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('emet-info-open'));
    });
  }

  ready(function (net) {
    addToggle();
    // clicking a node opens the panel (the renderer fills #side content)
    net.on('click', function (p) {
      if (p.nodes && p.nodes.length) { setOpen(true); }
    });
  });
})();
