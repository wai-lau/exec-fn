// After the 4:30 morning run every open page reloads (owner, 2026-11-01): the
// run resets the Exec thread and re-lays the day, but a tab left open overnight
// kept yesterday's transcript and board in its DOM. The page notes the last
// run's stamp at load (/api/nightly, the server's clock, so no skew), then
// re-asks whenever it comes back into view and every 5 min; a new stamp ->
// reload. Never while Wai is typing: that waits for the field to lose focus.
(function () {
  var seen;
  var pending = false;

  function typing() {
    var t = document.activeElement;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  }

  function reload() {
    if (!document.hidden && typing()) { pending = true; return; }
    location.reload();
  }

  function check() {
    if (pending) { reload(); return; }
    fetch('/api/nightly', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (seen === undefined) seen = d.at;
        else if (d.at !== seen) reload();
      })
      .catch(function (e) { console.debug('nightly-reload', e); });  // offline: ask next time
  }

  check();
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  document.addEventListener('focusout', function () { if (pending) setTimeout(reload, 0); });
})();
