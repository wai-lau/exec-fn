// /printer -- wrapper around the ELEGOO printer (api/routes_printer.py). Polls
// /api/printer/health and only mounts anything while the printer answers: an
// offline printer (or home box) shows a quiet note instead of the SPA's endless
// websocket-reconnect loop, and it remounts by itself once the printer is back.
//
// Two modes, decided by the SERVER (data-readonly on .printer):
//   owner    -- the proxied vendor SPA in an iframe, full control.
//   readonly -- guests: the camera stream + the status the printer pushes.
//               Nothing here can reach the machine; the control routes 401.
'use strict';

(function () {
  const FRAME_SRC = '/printer/network-device-manager/network/control';
  const POLL_MS = 15000;
  const STATUS_MS = 3000;
  const root = document.querySelector('.printer');
  const readonly = root && root.dataset.readonly === '1';
  const frame = document.getElementById('printer-frame');
  const view = document.getElementById('printer-view');
  const cam = document.getElementById('printer-cam');
  const stats = document.getElementById('printer-stats');
  const offline = document.getElementById('printer-offline');
  const status = document.getElementById('printer-status');
  let online = null; // tri-state so the first poll always applies
  let seq = 0; // a slow, older poll must never overwrite a fresher answer
  let statusTimer = null;

  function clock(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function row(label, value) {
    return `<div class="printer-stat"><dt>${label}</dt><dd>${value}</dd></div>`;
  }

  function renderStats(d) {
    if (!d.online) {
      stats.innerHTML = row('state', 'unreachable');
      return;
    }
    const rows = [row('state', d.printing ? d.job_state : d.state)];
    if (d.printing) {
      if (d.total_layers) rows.push(row('layer', `${d.layer} / ${d.total_layers}`));
      rows.push(row('progress', `${d.progress}%`));
      if (d.total_s) rows.push(row('elapsed', `${clock(d.elapsed_s)} / ${clock(d.total_s)}`));
    }
    rows.push(row('nozzle', `${d.nozzle}° / ${d.nozzle_target}°`));
    rows.push(row('bed', `${d.bed}° / ${d.bed_target}°`));
    rows.push(row('chamber', `${d.chamber}°`));
    stats.innerHTML = rows.join('');
  }

  async function pollStatus() {
    try {
      const r = await fetch('/api/printer/status', { cache: 'no-store' });
      if (r.ok) renderStats(await r.json());
    } catch (_e) {
      /* the health poll owns the offline story; a dropped status read is noise */
    }
  }

  function applyReadonly(ok) {
    view.hidden = !ok;
    if (ok) {
      cam.src = '/printer/video';
      pollStatus();
      statusTimer = statusTimer || setInterval(pollStatus, STATUS_MS);
    } else {
      cam.removeAttribute('src'); // release the viewer slot, don't just hide it
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  function applyOwner(ok) {
    frame.hidden = !ok;
    frame.src = ok ? FRAME_SRC : 'about:blank'; // drop the SPA + its socket
  }

  function apply(ok) {
    if (ok === online) return;
    online = ok;
    status.textContent = ok ? 'online' : 'offline';
    status.classList.toggle('is-online', ok);
    offline.hidden = ok;
    if (readonly) applyReadonly(ok);
    else applyOwner(ok);
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
