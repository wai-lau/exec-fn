(function () {
  'use strict';
  if (window.location.pathname === '/exec') return;

  // ── state ─────────────────────────────────────────────────────────────────
  let isOpen = false;
  let messages = [];
  let stage = 'planning';
  let streaming = false;
  let monitorTotal = 0;          // monitor notifications known this session

  // ── marked lazy-load ──────────────────────────────────────────────────────
  function loadMarked(cb) {
    if (window.marked) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let bubble, badge, panel, termEl, msgInput, preEl, postEl;

  // ── boot ──────────────────────────────────────────────────────────────────
  function init() {
    loadMarked(function () {
      marked.use({ breaks: true });
      // Build the panel ONLY after its stylesheet has applied. Otherwise the
      // panel paints unstyled (static, visible at top of body) for a frame, then
      // the late CSS snaps in `transform: translateY(-100%)` *with* transition —
      // so it visibly slides offscreen on every load. Gating on link.onload
      // means the element's first paint is already the hidden state: no animation.
      loadStyles(function () {
        buildBubble();
        buildPanel();
        if (window.execBuildTodos) execBuildTodos(panel);
        wireInput();
        restorePosition();
        loadHistory().then(handleExecParam);
        connectMonitorStream();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── styles ────────────────────────────────────────────────────────────────
  // Load the stylesheet and invoke cb once it has applied (or failed). Callers
  // wait on this before building the panel so the panel never paints unstyled.
  function loadStyles(cb) {
    const existing = document.querySelector('link[data-exec-css]');
    if (existing) { cb(); return; }
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = '/exec-bubble.css?v=13';
    el.setAttribute('data-exec-css', '');
    el.onload = cb;
    el.onerror = cb;  // never hang the panel on a CSS fetch failure
    document.head.appendChild(el);
  }

  // ── bubble ────────────────────────────────────────────────────────────────
  function buildBubble() {
    bubble = document.createElement('div');
    bubble.id = 'exec-bubble';
    bubble.innerHTML = '<img src="/guru-pink.png" alt="exec"><span id="exec-badge"></span>';
    document.body.appendChild(bubble);
    badge = document.getElementById('exec-badge');
    execMakeDraggable(bubble, togglePanel);
  }

  // ── panel ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'exec-panel';
    panel.innerHTML =
      '<div id="exec-term"></div>' +
      '<div id="exec-input-area">' +
        '<div id="exec-iline">' +
          '<span id="exec-prompt">$</span>' +
          '<div id="exec-iwrap">' +
            '<div id="exec-idisp"><span id="exec-ipre"></span><span id="exec-icursor"></span><span id="exec-ipost"></span></div>' +
            '<div id="exec-minput" contenteditable="true" enterkeyhint="send" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>' +
          '</div>' +
          '<button id="exec-mute" title="Mute Exec voice">[<span class="exec-vglyph">&#10022;</span>]</button>' +
          '<button id="exec-ph-close">[x]</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    termEl = document.getElementById('exec-term');
    msgInput = document.getElementById('exec-minput');
    preEl = document.getElementById('exec-ipre');
    postEl = document.getElementById('exec-ipost');
    document.getElementById('exec-ph-close').addEventListener('click', closePanel);
    if (window.execVoice) execVoice.mountButton();
    document.addEventListener('click', function (e) {
      if (!isOpen) return;
      if (!panel.contains(e.target) && !bubble.contains(e.target)) closePanel();
    });
    document.addEventListener('touchend', function (e) {
      if (!isOpen) return;
      if (!panel.contains(e.target) && !bubble.contains(e.target)) closePanel();
    });
  }

  // ── drag ──────────────────────────────────────────────────────────────────
  function clampBubbleToViewport() {
    const nh = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 56;
    const w = bubble.offsetWidth || 50;
    const h = bubble.offsetHeight || 50;
    const maxX = window.innerWidth - w;
    const maxY = window.innerHeight - h - nh;
    const r = bubble.getBoundingClientRect();
    if (r.right < 0 || r.left > window.innerWidth || r.top > window.innerHeight || r.bottom < 0) {
      bubble.style.left = bubble.style.top = '';
      bubble.style.right = '14px';
      bubble.style.bottom = (nh + 10) + 'px';
    } else if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.top > maxY) {
      bubble.style.right = bubble.style.bottom = '';
      bubble.style.left = Math.max(0, Math.min(maxX, r.left)) + 'px';
      bubble.style.top  = Math.max(0, Math.min(maxY, r.top)) + 'px';
    }
  }

  function restorePosition() {
    try {
      const s = JSON.parse(localStorage.getItem('exec-bpos') || 'null');
      if (s && s.left && s.top) {
        bubble.style.right = bubble.style.bottom = '';
        bubble.style.left = s.left;
        bubble.style.top  = s.top;
      }
    } catch (_) {}
    // Clamp after restore in case viewport shrank since last visit
    requestAnimationFrame(clampBubbleToViewport);
    window.addEventListener('resize', clampBubbleToViewport);
  }

  // ── open / close ──────────────────────────────────────────────────────────
  function togglePanel() { isOpen ? closePanel() : openPanel(); }

  function openPanel() {
    isOpen = true;
    panel.classList.add('open');
    if (window.execVoice) execVoice.unlock(); // opening via bubble tap = a gesture
    markRead();
    if (msgInput) msgInput.focus();
    setTimeout(function () { if (msgInput) msgInput.focus(); }, 240);
    fetch('/api/monitor/flush', { method: 'POST' }).catch(function () {});
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
  }

  // Open the bubble with the input prefilled (e.g. the card dialog's chat button).
  // Deferred a tick so the originating click finishes bubbling first — otherwise
  // the document click-outside handler sees isOpen and closes it immediately.
  window.openExecChat = function (prefill) {
    setTimeout(function () {
      openPanel();
      if (prefill != null && msgInput) {
        msgInput.textContent = prefill;
        var range = document.createRange();
        range.selectNodeContents(msgInput);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        msgInput.focus();
        renderCaret();
      }
    }, 0);
  };

  // iOS raises the soft keyboard only for a focus() that runs synchronously
  // inside a user gesture — never on load or from a setTimeout. When exec=open
  // opens the panel without a gesture, seat focus on the first interaction so
  // the input is typable and the keyboard comes up.
  function armFirstGestureFocus() {
    var onFirst = function (e) {
      // Taps on a real control manage their own focus — let them through.
      if (e.target.closest('button, a, input, textarea, [contenteditable]')) {
        document.removeEventListener('pointerdown', onFirst, true);
        return;
      }
      // Empty-space tap: completing it on a non-editable element would blur the
      // input we just focused and iOS drops the keyboard — preventDefault stops
      // the focus steal.
      e.preventDefault();
      document.removeEventListener('pointerdown', onFirst, true);
      if (!isOpen || !msgInput) return;
      msgInput.focus({ preventScroll: true });
      if (document.activeElement === msgInput) {
        var range = document.createRange();
        range.selectNodeContents(msgInput);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        renderCaret();
      }
    };
    document.addEventListener('pointerdown', onFirst, { capture: true, passive: false });
  }

  // ── ?exec=open — open expanded on load, answer a queued shortcut message ─────
  function handleExecParam() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    if (params.get('exec') !== 'open') return;
    openPanel();
    armFirstGestureFocus();
    var last = messages[messages.length - 1];
    if (last && last.role === 'user' && typeof last.content === 'string' && !streaming) {
      streamResponse();
    }
  }

  // ── unread badge ──────────────────────────────────────────────────────────
  var READ_KEY = 'exec_last_read_count';
  function setUnread(n) {
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }
  // Badge = monitor notifications since last read. The read marker is the monitor
  // count at last open, kept in localStorage so it survives reloads. chat.json
  // clears each morning, so a total below the marker means a reset -> all unread.
  function recomputeUnread() {
    var lr = parseInt(localStorage.getItem(READ_KEY), 10) || 0;
    if (monitorTotal < lr) { lr = 0; localStorage.setItem(READ_KEY, '0'); }
    setUnread(Math.max(0, monitorTotal - lr));
  }
  function markRead() {
    localStorage.setItem(READ_KEY, String(monitorTotal));
    setUnread(0);
  }

  // ── message rendering ─────────────────────────────────────────────────────
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    if (role === 'user' || role === 'assistant' || role === 'probe') {
      const body = document.createElement('div');
      body.className = 'msg-body';
      if (role === 'user') {
        const m = text.match(/^(\[\S+ \S+ ET\])\s*/);
        body.innerHTML = m
          ? '<span class="msg-ts">' + m[1] + '</span> ' + marked.parse(text.slice(m[0].length))
          : marked.parse(text);
      } else {
        body.innerHTML = marked.parse(text);
      }
      div.appendChild(body);
    } else {
      div.textContent = text;
    }
    termEl.appendChild(div);
    termEl.scrollTop = termEl.scrollHeight;
    return div;
  }

  function addStreamDiv() {
    const div = document.createElement('div');
    div.className = 'msg assistant';
    const body = document.createElement('div');
    body.className = 'msg-body';
    const cur = document.createElement('span');
    cur.id = 'exec-bc';
    cur.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(cur);
    div.appendChild(body);
    termEl.appendChild(div);
    return { div: div, body: body, cur: cur };
  }

  function fmtTs() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    return '[' + get('day') + '/' + get('month') + ' ' + get('hour') + ':' + get('minute') + ' ET]';
  }

  // ── input ─────────────────────────────────────────────────────────────────
  function _caretOffset() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !msgInput.contains(sel.anchorNode)) return msgInput.innerText.length;
    const range = document.createRange();
    range.selectNodeContents(msgInput);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString().length;
  }

  function renderCaret() {
    const text = msgInput.innerText;
    const pos = _caretOffset();
    preEl.textContent = text.slice(0, pos);
    postEl.textContent = text.slice(pos);
  }

  function wireInput() {
    msgInput.addEventListener('input', renderCaret);
    msgInput.addEventListener('keyup', renderCaret);
    msgInput.addEventListener('click', renderCaret);
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === msgInput) renderCaret();
    });
    msgInput.addEventListener('blur', function () {
      document.getElementById('exec-icursor').style.display = 'none';
    });
    msgInput.addEventListener('focus', function () {
      document.getElementById('exec-icursor').style.display = 'inline-block';
      renderCaret();
    });
    msgInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
  }

  function sendMsg() {
    if (streaming) return;
    const text = msgInput.innerText.trim();
    if (!text) return;
    msgInput.textContent = '';
    renderCaret();
    msgInput.focus();
    const ts = fmtTs();
    addMsg('user', ts + ' ' + text);
    messages.push({ role: 'user', content: ts + ' ' + text });
    streamResponse();
  }

  // ── stream response ───────────────────────────────────────────────────────
  async function streamResponse() {
    streaming = true;
    const { body, cur } = addStreamDiv();
    let fullText = '';
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages, stage: stage }),
      });
      if (!r.ok) throw new Error(await r.text());
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch (_) { continue; }
          if (data.type === 'text') {
            fullText += data.delta;
            body.innerHTML = marked.parse(fullText);
            (body.lastElementChild || body).appendChild(cur);
            termEl.scrollTop = termEl.scrollHeight;
          } else if (data.type === 'tool_call') {
            const res = data.result || {};
            const inp = data.input || {};
            if      (data.name === 'create_card')  addMsg('sys', '[ card added: ' + (res.title || '') + ' ]');
            else if (data.name === 'exile_card')   addMsg('sys', '[ exiled: "' + (res.title || inp.id || '') + '" ]');
            else if (data.name === 'update_card')  addMsg('sys', '[ updated: ' + (res.title || inp.id || '') + ' ]');
            else if (data.name === 'schedule_card')addMsg('sys', '[ scheduled "' + (res.title || '') + '" -> ' + (res.scheduled_day || 'unscheduled') + ' ]');
            else                                    addMsg('sys', '[ ' + data.name.replace(/_/g, ' ') + ': done ]');
            // notify card views (kanban/hq/directives) to reload live
            if (['create_card','exile_card','update_card','schedule_card'].includes(data.name)) {
              window.dispatchEvent(new CustomEvent('exec:cards-changed', { detail: { name: data.name } }));
            }
          } else if (data.type === 'done') {
            stage = data.next_stage;
          }
        }
      }
      cur.remove();
      if (fullText) {
        messages.push({ role: 'assistant', content: fullText });
        if (window.execVoice) execVoice.speak(fullText);  // narrate Exec's reply
      }
    } catch (e) {
      cur.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'msg sys';
      errDiv.style.color = 'hsl(var(--orange-glow-hsl) / 0.6)';
      errDiv.textContent = '[error: ' + e.message + ']';
      termEl.appendChild(errDiv);
    }
    streaming = false;
  }

  // ── history ───────────────────────────────────────────────────────────────
  function restoreMsg(m, toolResults) {
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
          const inp = b.input || {};
          const res = (toolResults && toolResults[b.id]) || {};
          if      (b.name === 'create_card') addMsg('sys', '[ card added: ' + (inp.title || '') + ' ]');
          else if (b.name === 'exile_card')  addMsg('sys', '[ exiled: "' + (res.title || inp.id || '') + '" ]');
          else if (b.name === 'update_card') addMsg('sys', '[ updated: ' + (res.title || inp.id || '') + ' ]');
        });
      }
    }
  }

  async function loadHistory() {
    try {
      const r = await fetch('/api/chat');
      if (!r.ok) return;
      const chat = await r.json();
      if (!chat.messages || !chat.messages.length) return;
      const allMsgs = chat.messages;
      messages = allMsgs.filter(function (m) { return m.role !== 'monitor'; });
      stage = chat.stage || 'planning';
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
        if (m.role === 'monitor') addMsg('probe', m.content);
        else restoreMsg(m, toolResults);
      }
      monitorTotal = allMsgs.filter(function (m) { return m.role === 'monitor'; }).length;
      if (isOpen) markRead(); else recomputeUnread();
    } catch (_) {}
  }

  // ── monitor stream ───────────────────────────────────────────────────────
  var monitorThinkEl = null;
  function setMonitorThinking(on) {
    if (on && !monitorThinkEl) {
      monitorThinkEl = document.createElement('div');
      monitorThinkEl.className = 'msg probe';
      monitorThinkEl.innerHTML = '<div class="msg-body"><span id="exec-bc"><span></span><span></span><span></span></span></div>';
      termEl.appendChild(monitorThinkEl);
      termEl.scrollTop = termEl.scrollHeight;
    } else if (!on && monitorThinkEl) {
      monitorThinkEl.remove();
      monitorThinkEl = null;
    }
  }

  function connectMonitorStream() {
    var src = new EventSource('/api/monitor/stream');
    src.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.thinking !== undefined) {
          setMonitorThinking(data.thinking);
        } else if (data.comment) {
          setMonitorThinking(false);
          addMsg('probe', data.comment);
          if (window.execVoice) execVoice.speak(data.comment);  // narrate nudge / monitor
          monitorTotal += 1;
          if (isOpen) markRead(); else recomputeUnread();
        }
      } catch (_) {}
    };
    src.onerror = function () {
      src.close();
      setTimeout(connectMonitorStream, 5000);
    };
  }

})();
