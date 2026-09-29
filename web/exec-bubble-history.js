// Exec panel: replaying the stored conversation on page load.
//
// Split out of exec-bubble.js (500-line cap). Loaded BEFORE it; the panel keeps
// its live state (unread counts) and this module only reads the history and
// hands the rows back, rendering each through the panel's own addMsg so a
// replayed message is built exactly like a live one -- including the
// [a | b | c] answer row, which exec-choices.js re-attaches (replay walks
// oldest-first).
//
// Since phase 3 of docs/plan-exec-cc-merge.md the conversation is the /cc
// sidecar thread, not chat.json: /api/cc/exec-history interleaves that thread with
// the nudges and monitor comments chat.json still collects (api/exec_panel.py).
// Tool calls are not replayed -- the sidecar transcript keeps only text -- so a
// card action shows its [ ... ] line live and not after a reload.
window.execHistory = (function () {
  // The live stream's one-line receipt for a card tool. An unlisted tool falls
  // through to a generic line rather than vanishing.
  function toolSysText(name, inp, res) {
    if (res.error) return '[ ' + name.replace(/_/g, ' ') + ' failed: ' + res.error + ' ]';
    if (name === 'create_card')   return '[ card added: ' + (res.title || inp.title || '') + ' ]';
    if (name === 'archive_card')  return '[ done: "' + (res.title || inp.id || '') + '"' + (res.next_occurrence ? ' -> next ' + res.next_occurrence : '') + ' ]';
    if (name === 'exile_card')    return '[ exiled: "' + (res.title || inp.id || '') + '" ]';
    if (name === 'update_card')   return '[ updated: ' + (res.title || inp.id || '') + ' ]';
    if (name === 'schedule_card') return '[ scheduled "' + (res.title || '') + '" -> ' + (res.scheduled_day || 'unscheduled') + ' ]';
    return '[ ' + name.replace(/_/g, ' ') + ': done ]';
  }

  function chip(ts) {
    const d = ts ? new Date(ts) : null;
    return d && !isNaN(d) ? execFmtTs(d) + ' ' : '';
  }

  // Renders the stored conversation through `addMsg` and returns {monitorTotal},
  // or null when there is nothing to replay (no history, or the fetch failed:
  // the panel must still open).
  async function load(addMsg) {
    try {
      const r = await fetch('/api/cc/exec-history');
      if (!r.ok) return null;
      const h = await r.json();
      const rows = h.messages || [];
      if (!rows.length) return null;
      for (const m of rows) {
        if (m.role === 'monitor') addMsg('probe', m.text, m.card_id);
        else if (m.role === 'user') addMsg('user', chip(m.ts) + m.text);
        else addMsg('assistant', m.text);
      }
      return { monitorTotal: h.monitorTotal || 0 };
    } catch (_) {
      return null;
    }
  }

  return { toolSysText: toolSysText, load: load };
})();
