(function () {
  'use strict';
  if (window.location.pathname === '/exec') return;

  // ── state ─────────────────────────────────────────────────────────────────
  let isOpen = false;
  let messages = [];
  let stage = 'planning';
  let streaming = false;
  let unreadCount = 0;

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
      injectStyles();
      buildBubble();
      buildPanel();
      wireInput();
      restorePosition();
      loadHistory().then(handleExecParam);
      connectMonitorStream();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    const css = `
      @font-face {
        font-family: 'Iosevka Mayukai Monolite';
        src: url('/fonts/Iosevka Mayukai Monolite Medium Nerd Font Complete.ttf') format('truetype');
        font-weight: 500;
      }
      @font-face {
        font-family: 'Iosevka Mayukai Monolite';
        src: url('/fonts/Iosevka Mayukai Monolite Bold Nerd Font Complete.ttf') format('truetype');
        font-weight: 700;
      }

      #exec-bubble {
        position: fixed; z-index: 9000;
        width: 50px; height: 50px; border-radius: 50%;
        background: rgba(224,74,125,0.1);
        border: 1.5px solid rgba(224,74,125,0.32);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 16px rgba(224,74,125,0.15);
        cursor: pointer; touch-action: none; user-select: none;
        transition: background 0.15s, box-shadow 0.15s;
      }
      #exec-bubble:hover {
        background: rgba(224,74,125,0.2);
        box-shadow: 0 2px 22px rgba(224,74,125,0.3);
      }
      #exec-bubble img {
        width: 26px; height: 26px; border-radius: 6px;
        image-rendering: pixelated; pointer-events: none;
      }
      #exec-badge {
        position: absolute; top: -3px; right: -3px;
        background: rgba(220,50,50,0.9); color: #fff;
        font-family: 'Iosevka Mayukai Monolite', monospace; font-size: 9px; font-weight: 700;
        min-width: 15px; height: 15px; border-radius: 8px;
        display: none; align-items: center; justify-content: center;
        padding: 0 3px; pointer-events: none; line-height: 1;
      }

      #exec-panel {
        position: fixed; top: 0; left: 50%;
        width: 80vw; height: calc(100vh - var(--nav-h, 56px));
        background: rgba(10,10,10,0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(0,255,65,0.07); border-top: none;
        display: flex; flex-direction: column; z-index: 8999;
        transform: translateX(-50%) translateY(-100%);
        transition: transform 0.22s cubic-bezier(0.22,1,0.36,1);
        font-family: 'Iosevka Mayukai Monolite', monospace !important; font-weight: 500;
      }
      #exec-panel * { font-family: 'Iosevka Mayukai Monolite', monospace !important; }
      #exec-panel.open { transform: translateX(-50%) translateY(0); }
      @media (max-width: 500px) {
        #exec-panel { width: 100%; left: auto; right: 0; border-left: none; border-right: none; transform: translateX(100%); }
        #exec-panel.open { transform: translateX(0); }
      }

      #exec-ph-close {
        flex-shrink: 0;
        background: none; border: none;
        cursor: pointer; color: rgba(0,255,65,0.3);
        font-family: 'Iosevka Mayukai Monolite', monospace;
        font-size: 0.78rem; padding: 4px 6px; margin-left: 8px;
        transition: color 0.15s;
      }
      #exec-ph-close:hover { color: rgba(0,255,65,0.8); }

      #exec-term {
        flex: 1; overflow-y: auto; padding: 12px 14px;
        font-size: 0.82rem; line-height: 1.45; color: rgba(0,255,65,0.9);
        display: flex; flex-direction: column;
      }
      #exec-term::before { content: ""; flex: 1; }
      #exec-term::-webkit-scrollbar { width: 3px; }
      #exec-term::-webkit-scrollbar-track { background: transparent; }
      #exec-term::-webkit-scrollbar-thumb { background: rgba(0,255,65,0.12); border-radius: 2px; }

      #exec-term .msg { margin-bottom: 5px; overflow-wrap: break-word; }
      #exec-term .msg-ts { color: rgba(255,255,255,0.18); font-size: 0.88em; }
      #exec-term .msg.assistant { color: rgba(0,255,65,0.92); display: flex; align-items: flex-start; }
      #exec-term .msg.assistant::before { content: ">"; opacity: 0.38; flex-shrink: 0; margin-right: 0.4em; }
      #exec-term .msg.assistant p { margin: 0 0 5px; }
      #exec-term .msg.assistant p:last-child { margin-bottom: 0; }
      #exec-term .msg.assistant strong { color: rgba(0,255,65,1); }
      #exec-term .msg.assistant em { color: rgba(0,255,65,0.75); font-style: italic; }
      #exec-term .msg.assistant code { background: rgba(0,255,65,0.08); padding: 1px 3px; border-radius: 2px; font-size: 0.91em; }
      #exec-term .msg.assistant pre { background: rgba(0,255,65,0.05); border: 1px solid rgba(0,255,65,0.12); padding: 6px 10px; border-radius: 3px; overflow-x: auto; margin: 5px 0; }
      #exec-term .msg.assistant pre code { background: none; padding: 0; }
      #exec-term .msg.assistant ul, #exec-term .msg.assistant ol { margin: 3px 0 3px 14px; padding: 0; }
      #exec-term .msg.assistant li { margin-bottom: 2px; }
      #exec-term .msg.assistant h1, #exec-term .msg.assistant h2, #exec-term .msg.assistant h3 { color: rgba(0,255,65,1); font-size: 1em; font-weight: bold; margin: 6px 0 3px; }
      #exec-term .msg-body { flex: 1; min-width: 0; }
      #exec-term .msg.user { color: rgba(255,255,255,0.72); display: flex; align-items: flex-start; }
      #exec-term .msg.user::before { content: "$"; opacity: 0.5; flex-shrink: 0; margin-right: 0.4em; }
      #exec-term .msg.sys { color: rgba(0,255,65,0.24); font-size: 0.72rem; }
      #exec-term .msg.sys::before { content: "# "; }
      #exec-term .msg.probe { color: rgba(80,200,255,0.55); font-size: 0.78rem; font-style: italic; display: flex; align-items: flex-start; }
      #exec-term .msg.probe::before { content: "~"; opacity: 0.5; flex-shrink: 0; margin-right: 0.4em; }
      #exec-term .msg.probe .msg-body { font-style: italic; }

      #exec-bc { display: inline-flex; gap: 3px; align-items: center; height: 1.1em; vertical-align: text-bottom; }
      #exec-bc span { display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: rgba(0,255,65,0.85); animation: execdot 1.2s ease-in-out infinite; }
      #exec-bc span:nth-child(2) { animation-delay: 0.2s; }
      #exec-bc span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes execdot { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
      @keyframes execblink { 0%,50%{opacity:1} 50.01%,100%{opacity:0} }

      #exec-input-area { flex-shrink: 0; padding: 0 14px; background: #181818; border-top: 1px solid rgba(0,255,65,0.06); }
      #exec-iline { display: flex; align-items: center; border-bottom: 1px solid rgba(0,255,65,0.1); padding: 6px 0; }
      #exec-iline:focus-within { border-bottom-color: rgba(0,255,65,0.3); }
      #exec-prompt { color: rgba(0,255,65,0.55); font-size: 0.9rem; white-space: nowrap; user-select: none; padding-right: 8px; }
      #exec-iwrap { flex: 1; position: relative; display: flex; align-items: center; min-width: 0; }
      #exec-idisp { display: none; }
      #exec-icursor { display: none; }
      #exec-minput { width: 100%; background: none; border: none; color: rgba(0,255,65,0.95); caret-color: rgba(0,255,65,0.9); font-family: 'Iosevka Mayukai Monolite', monospace; font-weight: 500; font-size: 0.82rem; padding: 0; outline: none; line-height: 1.45; min-height: 1.45em; overflow-wrap: anywhere; }
      #exec-minput:empty::before { content: attr(data-placeholder); color: rgba(0,255,65,0.15); }
    `;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── bubble ────────────────────────────────────────────────────────────────
  function buildBubble() {
    bubble = document.createElement('div');
    bubble.id = 'exec-bubble';
    bubble.innerHTML = '<img src="/guru-pink.png" alt="exec"><span id="exec-badge"></span>';
    document.body.appendChild(bubble);
    badge = document.getElementById('exec-badge');
    makeDraggable(bubble);
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
          '<button id="exec-ph-close">[x]</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    termEl = document.getElementById('exec-term');
    msgInput = document.getElementById('exec-minput');
    preEl = document.getElementById('exec-ipre');
    postEl = document.getElementById('exec-ipost');
    document.getElementById('exec-ph-close').addEventListener('click', closePanel);
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
  function makeDraggable(el) {
    let sx, sy, il, it, dragged;

    function navH() {
      return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 56;
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function applyDefault() {
      el.style.left = el.style.top = '';
      el.style.right = '14px';
      el.style.bottom = (navH() + 10) + 'px';
    }

    function onStart(x, y) {
      dragged = false;
      const r = el.getBoundingClientRect();
      sx = x; sy = y; il = r.left; it = r.top;
      el.style.right = el.style.bottom = '';
      el.style.left = il + 'px';
      el.style.top = it + 'px';
    }
    function onMove(x, y) {
      if (Math.abs(x - sx) > 5 || Math.abs(y - sy) > 5) dragged = true;
      if (!dragged) return;
      el.style.left = clamp(il + x - sx, 0, window.innerWidth - el.offsetWidth) + 'px';
      el.style.top  = clamp(it + y - sy, 0, window.innerHeight - el.offsetHeight - navH()) + 'px';
    }
    function onEnd() {
      if (!dragged) {
        togglePanel();
      } else {
        try { localStorage.setItem('exec-bpos', JSON.stringify({ left: el.style.left, top: el.style.top })); } catch (_) {}
      }
    }

    el.addEventListener('mousedown', function (e) {
      e.preventDefault();
      onStart(e.clientX, e.clientY);
      function mm(e) { onMove(e.clientX, e.clientY); }
      function mu() { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); onEnd(); }
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
    el.addEventListener('touchstart', function (e) { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    el.addEventListener('touchmove',  function (e) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    el.addEventListener('touchend',   function (e) { e.preventDefault(); onEnd(); }, { passive: false });

    applyDefault();
  }

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
    setUnread(0);
    if (msgInput) msgInput.focus();
    setTimeout(function () { if (msgInput) msgInput.focus(); }, 240);
    fetch('/api/monitor/flush', { method: 'POST' }).catch(function () {});
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
  }

  // ── ?exec=open — open expanded on load, answer a queued shortcut message ─────
  function handleExecParam() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    if (params.get('exec') !== 'open') return;
    openPanel();
    var last = messages[messages.length - 1];
    if (last && last.role === 'user' && typeof last.content === 'string' && !streaming) {
      streamResponse();
    }
  }

  // ── unread badge ──────────────────────────────────────────────────────────
  function setUnread(n) {
    unreadCount = n;
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
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
            // notify card views (kanban/prophecies/directives) to reload live
            if (['create_card','exile_card','update_card','schedule_card'].includes(data.name)) {
              window.dispatchEvent(new CustomEvent('exec:cards-changed', { detail: { name: data.name } }));
            }
          } else if (data.type === 'done') {
            stage = data.next_stage;
          }
        }
      }
      cur.remove();
      if (fullText) messages.push({ role: 'assistant', content: fullText });
    } catch (e) {
      cur.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'msg sys';
      errDiv.style.color = 'rgba(255,100,100,0.7)';
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
          if (!isOpen) setUnread(unreadCount + 1);
        }
      } catch (_) {}
    };
    src.onerror = function () {
      src.close();
      setTimeout(connectMonitorStream, 5000);
    };
  }

})();
