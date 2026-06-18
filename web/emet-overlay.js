// emet overlay — a single collapsible node-info panel (bottom strip, collapses
// down). Geometry/skin live in web/emet.css. The renderer (emet.html) fills the
// #side panel content, exposes window.net, and window.emetRecenter() to pan the
// selected node clear of the panel.
(function () {
  function ready(cb) {
    if (window.net) { cb(); return; }
    setTimeout(function () { ready(cb); }, 50);
  }

  var btn;
  function setOpen(open, recenter) {
    document.body.classList.toggle('emet-info-open', open);
    if (btn) { btn.querySelector('.emet-tg-glyph').textContent = open ? '▾' : '▴'; }
    // re-pan the selected node into the space above the panel
    if (open && recenter && window.emetRecenter) { window.emetRecenter(); }
  }

  // programmatic open (from a node click) — the renderer pans, so skip recenter
  window.emetOpenInfo = function () { setOpen(true, false); };

  function addToggle() {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emet-toggle info';
    btn.innerHTML = '<span class="emet-tg-glyph">▴</span> node';
    document.body.appendChild(btn);
    btn.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('emet-info-open'), true);
    });
  }

  ready(addToggle);
})();
