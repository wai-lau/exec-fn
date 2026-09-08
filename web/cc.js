/* /cc — sandboxed Claude Code terminal.
 *
 * The stream is SSE over POST, so EventSource is unusable (GET only) and the
 * frames are parsed off a fetch body reader by hand. Event vocabulary is the
 * sidecar's, relayed verbatim by cc_client.py: session / text / thinking /
 * tool / tool_result / done / busy / error. */
(function () {
  var log = document.getElementById('cc-log');
  var form = document.getElementById('cc-form');
  var input = document.getElementById('cc-input');
  var send = document.getElementById('cc-send');
  var badge = document.getElementById('cc-status');
  var newBtn = document.getElementById('cc-new');
  if (!log || !form || !input) return;

  var sessionId = null;   // resumes the sidecar's conversation across runs
  var running = false;

  function el(cls, text) {
    var d = document.createElement('div');
    d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  function push(node) {
    // Only chase the tail when the reader is already there -- yanking the view
    // down mid-scroll while a long tool result streams is the worst behaviour a
    // transcript can have.
    var stick = atBottom();
    log.appendChild(node);
    if (stick) log.scrollTop = log.scrollHeight;
    return node;
  }

  function setBadge(cls, text) {
    if (!badge) return;
    badge.className = 'cc-badge' + (cls ? ' ' + cls : '');
    badge.textContent = text;
  }

  // ── health ──────────────────────────────────────────────────────────────
  async function poll() {
    if (running) return;                 // a live run IS the liveness signal
    try {
      var r = await fetch('/api/cc/health', { cache: 'no-store' });
      var d = await r.json();
      if (d.unreachable || !d.ok) setBadge('down', 'sidecar down');
      else if (d.busy) setBadge('busy', 'busy');
      else setBadge('ok', 'ready');
    } catch (e) {
      setBadge('down', 'sidecar down');
    }
  }

  // ── rendering ───────────────────────────────────────────────────────────
  var textNode = null;   // current assistant paragraph, appended to in place

  function renderEvent(ev) {
    if (ev.type === 'session') {
      sessionId = ev.sessionId || sessionId;
      return;
    }
    if (ev.type === 'text') {
      if (!ev.text) return;
      if (!textNode) textNode = push(el('cc-msg cc-text', ''));
      textNode.textContent += ev.text;
      if (atBottom()) log.scrollTop = log.scrollHeight;
      return;
    }
    // Anything that is not more prose ends the current paragraph, so a tool
    // call between two sentences does not get swallowed into one block.
    textNode = null;

    if (ev.type === 'thinking') {
      if (ev.text) push(el('cc-msg cc-think', ev.text));
    } else if (ev.type === 'tool') {
      var row = el('cc-tool');
      row.appendChild(el('cc-tool-name', ev.name || 'tool'));
      row.appendChild(el('cc-tool-arg', summarize(ev.input)));
      push(row);
    } else if (ev.type === 'tool_result') {
      var t = (ev.text || '').trim();
      if (t) push(el('cc-result' + (ev.isError ? ' err' : ''), clamp(t)));
    } else if (ev.type === 'done') {
      var bits = [];
      if (ev.turns != null) bits.push(ev.turns + ' turn' + (ev.turns === 1 ? '' : 's'));
      if (ev.ms != null) bits.push((ev.ms / 1000).toFixed(1) + 's');
      push(el('cc-done', bits.join(' · ')));
    } else if (ev.type === 'busy') {
      push(el('cc-err', 'sidecar busy — one run at a time (memory ceiling). try again shortly.'));
    } else if (ev.type === 'error') {
      push(el('cc-err', ev.detail || 'error'));
    }
  }

  function summarize(inp) {
    if (inp == null) return '';
    if (typeof inp === 'string') return clamp(inp, 300);
    // Show the field that actually says what the call does, not a JSON dump.
    var key = inp.command || inp.file_path || inp.pattern || inp.path || inp.prompt;
    if (typeof key === 'string') return clamp(key, 300);
    try { return clamp(JSON.stringify(inp), 300); } catch (e) { return ''; }
  }

  function clamp(s, n) {
    n = n || 4000;
    return s.length > n ? s.slice(0, n) + ' …' : s;
  }

  // ── run ─────────────────────────────────────────────────────────────────
  async function run(prompt) {
    running = true;
    send.disabled = true;
    setBadge('busy', 'running');
    push(el('cc-msg cc-you', prompt));
    textNode = null;

    var body = { prompt: prompt };
    if (sessionId) body.sessionId = sessionId;

    try {
      var r = await fetch('/api/cc/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok || !r.body) {
        var msg = 'request failed (' + r.status + ')';
        try { msg = (await r.json()).error || msg; } catch (e) { /* non-JSON body */ }
        push(el('cc-err', msg));
      } else {
        await consume(r.body.getReader());
      }
    } catch (e) {
      push(el('cc-err', 'stream failed: ' + e));
    } finally {
      running = false;
      send.disabled = false;
      poll();
    }
  }

  /** Parse `data: {...}\n\n` frames off the byte stream.
   *
   * A chunk boundary can split a frame anywhere, including mid-UTF-8, so the
   * decoder is streaming and the tail of the buffer is carried to the next read
   * instead of being parsed early. */
  async function consume(reader) {
    var dec = new TextDecoder();
    var buf = '';
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      buf += dec.decode(step.value, { stream: true });
      var parts = buf.split('\n\n');
      buf = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim();
        if (!line.indexOf('data: ')) {
          try { renderEvent(JSON.parse(line.slice(6))); } catch (e) { /* keepalive/partial */ }
        }
      }
    }
  }

  // ── input ───────────────────────────────────────────────────────────────
  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 128) + 'px';
  }
  input.addEventListener('input', grow);

  input.addEventListener('keydown', function (e) {
    // Enter sends, shift+Enter is a newline -- but never on a soft keyboard,
    // where Enter is the only way to type one.
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (running) return;
    var v = input.value.trim();
    if (!v) return;
    input.value = '';
    grow();
    run(v);
  });

  if (newBtn) {
    newBtn.addEventListener('click', function () {
      sessionId = null;
      textNode = null;
      log.textContent = '';
      push(el('cc-done', 'new session'));
    });
  }

  poll();
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) poll();
  });
})();
