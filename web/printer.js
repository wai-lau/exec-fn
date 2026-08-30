// /printer -- owner-only wrapper around the proxied ELEGOO web UI
// (api/routes_printer.py). Polls /api/printer/health and mounts the SPA iframe
// only while the printer answers: an offline printer (or home box) shows a
// quiet note instead of the SPA's endless websocket-reconnect loop, and the
// frame remounts by itself once the printer is back.
'use strict';

(function () {
  const FRAME_SRC = '/printer/network-device-manager/network/control';
  const POLL_MS = 15000;
  const frame = document.getElementById('printer-frame');
  const offline = document.getElementById('printer-offline');
  const status = document.getElementById('printer-status');
  let online = null; // tri-state so the first poll always applies
  let seq = 0; // a slow, older poll must never overwrite a fresher answer

  function apply(ok) {
    if (ok === online) return;
    online = ok;
    status.textContent = ok ? 'online' : 'offline';
    status.classList.toggle('is-online', ok);
    if (ok) {
      frame.src = FRAME_SRC;
      frame.hidden = false;
      offline.hidden = true;
    } else {
      frame.hidden = true;
      frame.src = 'about:blank'; // drop the SPA + its socket, not just hide it
      offline.hidden = false;
    }
  }

  async function poll() {
    const mine = ++seq;
    let ok;
    try {
      const r = await fetch('/api/printer/health', { cache: 'no-store' });
      ok = r.ok;
    } catch (_e) {
      ok = false;
    }
    if (mine === seq) apply(ok); // a newer poll is in flight or done: drop this one
  }

  poll();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
})();
