// /printer -- wrapper around the ELEGOO printer (api/routes_printer.py). Polls
// /api/printer/health and only mounts anything while the printer answers: an
// offline printer (or home box) shows a quiet note instead of the SPA's endless
// websocket-reconnect loop, and it remounts by itself once the printer is back.
//
// Two modes, decided by the SERVER (data-readonly on .printer):
//   owner    -- the proxied vendor SPA in an iframe, full control.
//   readonly -- guests: the camera stream and ONE job strip under it, the same
//               shape the vendor SPA's own print-job row has (state, percent,
//               elapsed/remaining, layer progress) and nothing else: no page
//               chrome, no temps, no filename or thumbnail (the payload has
//               neither on purpose -- routes_printer), and NO pause/stop
//               controls. Nothing here can reach the machine anyway; the
//               control routes 401. Reshaped 2026-09-19 from a temps-and-all
//               stat list.
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
  const job = document.getElementById('printer-job');
  const offline = document.getElementById('printer-offline');
  const status = document.getElementById('printer-status');
  let online = null; // tri-state so the first poll always applies
  let seq = 0; // a slow, older poll must never overwrite a fresher answer
  let statusTimer = null;

  // HH:MM:SS, the vendor strip's own format — a print runs in hours and the
  // seconds are the only part that visibly moves between polls.
  function clock(s) {
    const n = Math.max(0, Math.round(s || 0));
    const p = (v) => String(v).padStart(2, '0');
    return `${p(Math.floor(n / 3600))}:${p(Math.floor((n % 3600) / 60))}:${p(n % 60)}`;
  }

  function pair(label, value) {
    return `<div class="pj-pair"><span class="pj-k">${label}</span><span class="pj-v">${value}</span></div>`;
  }

  function renderJob(d) {
    const state = !d.online ? 'unreachable' : d.printing ? d.job_state : d.state;
    const head = `<div class="pj-state">${state}</div>`;
    if (!d.online || !d.printing) {
      job.innerHTML = head;
      return;
    }
    const rows = [pair('elapsed', clock(d.elapsed_s))];
    if (d.total_s) rows.push(pair('remaining', clock(d.total_s - d.elapsed_s)));
    if (d.total_layers) rows.push(pair('layer', `${d.layer} / ${d.total_layers}`));
    job.innerHTML =
      `${head}<div class="pj-pct">${Math.round(d.progress)}<span class="pj-pct-unit">%</span></div>` +
      `<div class="pj-rows">${rows.join('')}</div>`;
  }

  async function pollStatus() {
    try {
      const r = await fetch('/api/printer/status', { cache: 'no-store' });
      if (r.ok) renderJob(await r.json());
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

  // The proxied vendor SPA paints a white document before its app renders, so
  // revealing the iframe the instant its src is set flashes white. Keep it
  // invisible (opacity 0 via the missing .ready class) until its load event
  // fires, then fade it in — the page shows its own dark bg during the boot.
  if (frame) {
    frame.addEventListener('load', () => {
      if (frame.src && !/about:blank$/.test(frame.src)) frame.classList.add('ready');
    });
  }

  function applyOwner(ok) {
    if (!ok) {
      frame.hidden = true;
      frame.classList.remove('ready'); // re-arm the fade for the next mount
      frame.src = 'about:blank'; // drop the SPA + its socket
      return;
    }
    frame.classList.remove('ready'); // stay invisible until the SPA has painted
    frame.hidden = false;
    frame.src = FRAME_SRC;
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
