// Exec panel: replaying the stored conversation on page load.
//
// Split out of exec-bubble.js (500-line cap). Loaded BEFORE it; the panel keeps
// every piece of live state (messages, stage, unread counts) and this module
// only reads /api/chat and hands the rows back, rendering each through the
// panel's own addMsg so a replayed message is built exactly like a live one —
// including the [a | b | c] answer row, which exec-choices.js re-attaches to the
// newest nudge for free (replay walks oldest-first).
window.execHistory = (function () {
  // Shared by the live stream + history restore so an unlisted tool falls
  // through to the same generic sys line in both, instead of vanishing on reload.
  function toolSysText(name, inp, res) {
    if (name === 'create_card')   return '[ card added: ' + (res.title || inp.title || '') + ' ]';
    if (name === 'archive_card')  return '[ done: "' + (res.title || inp.id || '') + '"' + (res.next_occurrence ? ' -> next ' + res.next_occurrence : '') + ' ]';
    if (name === 'exile_card')    return '[ exiled: "' + (res.title || inp.id || '') + '" ]';
    if (name === 'update_card')   return '[ updated: ' + (res.title || inp.id || '') + ' ]';
    if (name === 'schedule_card') return '[ scheduled "' + (res.title || '') + '" -> ' + (res.scheduled_day || 'unscheduled') + ' ]';
    return '[ ' + name.replace(/_/g, ' ') + ': done ]';
  }

  function restoreMsg(m, toolResults, addMsg) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') addMsg('user', m.content);
      else if (Array.isArray(m.content)) {
        const text = m.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
        if (text) addMsg('user', text);
      }
    } else if (m.role === 'assistant') {
      if (typeof m.content === 'string') {
        addMsg('assistant', m.content);
      } else if (Array.isArray(m.content)) {
        const text = m.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
        if (text) addMsg('assistant', text);
        m.content.forEach(function (b) {
          if (b.type !== 'tool_use') return;
          addMsg('sys', toolSysText(b.name, b.input || {}, (toolResults && toolResults[b.id]) || {}));
        });
      }
    }
  }

  // Renders the stored conversation through `addMsg` and returns the state the
  // panel owns — {messages, stage, monitorTotal} — or null when there is nothing
  // to replay (no history, or the fetch failed: the panel must still open).
  async function load(addMsg) {
    try {
      const r = await fetch('/api/chat');
      if (!r.ok) return null;
      const chat = await r.json();
      if (!chat.messages || !chat.messages.length) return null;
      const allMsgs = chat.messages;
      const messages = allMsgs.filter(function (m) { return m.role !== 'monitor'; });
      const toolResults = {};
      for (const m of messages) {
        if (m.role === 'user' && Array.isArray(m.content)) {
          for (const b of m.content) {
            if (b.type === 'tool_result') {
              try { toolResults[b.tool_use_id] = JSON.parse(b.content); } catch (_) {}
            }
          }
        }
      }
      for (const m of allMsgs) {
        if (m.role === 'monitor') addMsg('probe', m.content, m.card_id);
        else restoreMsg(m, toolResults, addMsg);
      }
      return {
        messages: messages,
        stage: chat.stage || 'planning',
        monitorTotal: allMsgs.filter(function (m) { return m.role === 'monitor'; }).length,
      };
    } catch (_) {
      return null;
    }
  }

  return { toolSysText: toolSysText, load: load };
})();
