// Shared GPU-mode control (owner-only) for /hosaka + /emet. The home GPU box
// runs EITHER hosaka TTS (homo) or is freed for other work incl. the emet LLM
// (emo / idle); this segmented strip flips between them. Both pages hit the same
// backend (/api/hosaka/mode), so the control is shared state across them. GET
// 401 for guests keeps the strip hidden. Loaded on both pages; keys off the
// #gpu-mode element, so it's a no-op on any page that lacks it.
'use strict';

(function () {
  function init() {
    const el = document.getElementById('gpu-mode');
    if (!el) return;
    const buttons = Array.from(el.querySelectorAll('.gpu-mode-btn'));

    function render(mode) {
      el.hidden = false;
      el.classList.toggle('gone', mode === 'gone');
      for (const b of buttons) {
        const isActive = b.dataset.mode === mode;
        b.classList.toggle('active', isActive);
        // active button + gone state are non-interactive; others clickable
        b.disabled = isActive || mode === 'gone';
      }
    }

    async function load() {
      try {
        const r = await fetch('/api/hosaka/mode');
        if (r.status === 401) { el.hidden = true; return; } // guest: no control
        render((await r.json()).mode);
      } catch { el.hidden = true; }
    }

    async function post(action, force) {
      const r = await fetch('/api/hosaka/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, force: !!force }),
      });
      if (r.status === 409) {
        const info = (await r.json()).detail || {};
        const n = info.count != null ? info.count : 'some';
        if (confirm(n + ' user(s) streaming -- switch anyway?')) return post(action, true);
        return; // cancelled
      }
      if (!r.ok) { await load(); return; }
      render((await r.json()).mode);
    }

    for (const b of buttons) {
      b.addEventListener('click', () => { if (!b.disabled) post(b.dataset.mode, false); });
    }
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
