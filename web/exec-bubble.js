(function () {
  'use strict';
  if (window.location.pathname === '/exec') return;

  // ── state ─────────────────────────────────────────────────────────────────
  let isOpen = false;
  let messages = [];
  let stage = 'planning';
  let streaming = false;
  let monitorTotal = 0;          // monitor notifications known this session

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
        if (window.execMicInit) execMicInit(micHost());
        execRestorePosition(bubble);
        // SSE connects only after history resolves, so a comment landing mid-fetch can't double-render.
        loadHistory().then(function () { handleExecParam(); connectMonitorStream(); });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── styles ────────────────────────────────────────────────────────────────
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
          '<button id="exec-ph-close">[x]</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    termEl = document.getElementById('exec-term');
    msgInput = document.getElementById('exec-minput');
    preEl = document.getElementById('exec-ipre');
    postEl = document.getElementById('exec-ipost');
    document.getElementById('exec-ph-close').addEventListener('click', closePanel);
    // The voice toggle is the shared control (voice-ui.js) — same element and
    // same data-on contract as /tarot's and /cc's; only the placement is ours.
    if (window.execVoice) {
      const line = document.getElementById('exec-iline');
      line.insertBefore(execVoice.button({ id: 'exec-mute' }),
                        document.getElementById('exec-ph-close'));
    }
    // Click-outside-to-close, decided in the CAPTURE phase -- a control that
    // removes itself on tap (exec-choices' answer buttons) leaves a DETACHED
    // target, which a bubble-phase containment test reads as 'outside'.
    // Why it has to be capture: ARCHITECTURE.md §12.
    let fromInside = false;
    function markOrigin(e) {
      fromInside = panel.contains(e.target) || bubble.contains(e.target);
    }
    function closeIfOutside() {
      if (!isOpen) return;
      if (!fromInside) closePanel();
    }
    document.addEventListener('click', markOrigin, true);
    document.addEventListener('touchend', markOrigin, true);
    document.addEventListener('click', closeIfOutside);
    document.addEventListener('touchend', closeIfOutside);
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

  // Closing ends any voice session: a mic left open behind a hidden panel is
  // one that keeps sending messages with nothing on screen to show for it.
  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    if (window.execMicStop) execMicStop();
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
      // `.mic` is the `$` prompt, a SPAN: without it the preventDefault below
      // eats the first tap on the mic and it only opens on the second.
      if (e.target.closest('button, a, input, textarea, [contenteditable], .mic')) {
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
  function addMsg(role, text, cardId) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    // A nudge writes its answers as a trailing [a | b | c] line: strip it here,
    // and exec-choices.js renders it as buttons under the message. An ordinary
    // Exec reply can end on the same row (it asks Wai questions with a small
    // answer set all the time) — parsing only the nudge role is what left those
    // printing as raw brackets with no buttons under them. A chat reply carries
    // no card id in its payload, so a question about a card names it IN the row
    // (`[card=... | a | b]`) and parse() hands it back; the push's id wins when
    // both exist, being the one the server chose rather than the model.
    const parseable = role === 'probe' || role === 'assistant';
    const choices = parseable && window.execChoices ? execChoices.parse(text) : null;
    if (choices) cardId = cardId || choices.cardId;
    if (choices) text = choices.clean;
    if (role === 'user' || role === 'assistant' || role === 'probe') {
      // Exec turns get a clickable replay glyph (execVoice.mark, see exec-voice.js).
      if ((role === 'assistant' || role === 'probe') && window.execVoice) div.appendChild(execVoice.mark(role, text));
      const body = document.createElement('div');
      body.className = 'msg-body';
      if (role === 'user') {
        execRenderUserBody(body, text);
      } else {
        body.innerHTML = mdHtml(text);
      }
      div.appendChild(body);
    } else {
      div.textContent = text;
    }
    termEl.appendChild(div);
    if (choices) execChoices.attach(termEl, div, choices.opts, sendText, cardId, function (t) { addMsg('sys', t); }, text);
    termEl.scrollTop = termEl.scrollHeight;
    return div;
  }

  // The render primitives live in exec-bubble-msg.js (the 500-line cap); they
  // need no panel state, so they take what little they use.
  const addStreamDiv = () => chatStreamDiv(termEl, { id: 'exec-bc' });
  const fmtTs = execFmtTs;

  // ── input ─────────────────────────────────────────────────────────────────
  // The caret mirror is shared (chat-dom.js). This copy was the one that never
  // grew the try/catch the other three did -- a stale selection after a send
  // throws IndexSizeError on WebKit, which is Wai's phone.
  let caret = null;
  function renderCaret() {
    if (!caret) caret = chatCaret(msgInput, preEl, postEl);
    caret.render();
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
    sendText(text);
  }

  // The panel mic (exec-mic.js, engine in voice-input.js) drives the composer
  // from outside this closure: it needs the send path a typed message takes,
  // and the two states whose audio must never become the next message — a reply
  // still streaming, and Exec's GLaDOS voice playing that reply out loud.
  function micHost() {
    return {
      prompt: document.getElementById('exec-prompt'),
      send: sendMsg,
      fill: function (t) { msgInput.textContent = t; renderCaret(); },
      blur: function () { if (document.activeElement === msgInput) msgInput.blur(); },
      busy: function () { return streaming || !!(window.execVoice && execVoice.isSpeaking()); },
    };
  }

  // Typing and tapping a nudge's choice button reach the same path, so a tapped
  // answer IS the message Wai would have typed.
  function sendText(text) {
    if (streaming || !text) return;
    const ts = fmtTs();
    addMsg('user', ts + ' ' + text);
    messages.push({ role: 'user', content: ts + ' ' + text });
    streamResponse();
  }

  // ── stream response ───────────────────────────────────────────────────────
  async function streamResponse() {
    streaming = true;
    const { div: streamDiv, body, cur } = addStreamDiv();
    let fullText = '';
    // With the voice on and usable, the reveal is the narrator's to pace: the
    // typer buffers instead of typing, and twAudio spreads the text across the
    // measured utterance below.
    const typer = execTyper(body, cur, termEl,
                            () => !!(window.execVoice && execVoice.isOn() && execVoice.ready()));
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
            typer.push(fullText);
          } else if (data.type === 'tool_call') {
            addMsg('sys', execHistory.toolSysText(data.name, data.input || {}, data.result || {}));
            // notify card views (rd/hq/directives) to reload live
            if (['create_card','archive_card','exile_card','update_card','schedule_card'].includes(data.name)) {
              window.dispatchEvent(new CustomEvent('exec:cards-changed', { detail: { name: data.name } }));
            }
          } else if (data.type === 'done') {
            stage = data.next_stage;
          }
        }
      }
      // Speak as soon as the TEXT is final — the read loop above has just
      // ended, so fullText is complete — rather than after the reveal. This
      // used to sit below `await typer.finish()`, which is the whole typewriter
      // run, so the voice only opened its mouth once the last character had
      // landed and a long reply was read out to a screen that had finished
      // saying it.
      //
      // The controller decides the pace from here: a live utterance reveals the
      // text across it (typing at the narrator's speed), and a dead one — voice
      // off, not unlocked, upstream unreachable — falls straight through to the
      // guessed pace, which is also what finish() starts when nothing else has.
      const vctl = fullText && window.execVoice ? execVoice.speak(fullText) : null;
      if (vctl && vctl.ok) await typer.audio(vctl);
      else await typer.finish();
      cur.remove();
      if (fullText) {
        // The typewriter has already typed any trailing [a | b | c] row as
        // prose — re-render the body without it and hand the row to
        // exec-choices, the same buttons a nudge gets.
        const ch = window.execChoices ? execChoices.parse(fullText) : null;
        if (ch && (ch.opts.length || ch.cardId)) {
          body.innerHTML = mdHtml(ch.clean);
          execChoices.attach(termEl, streamDiv, ch.opts, sendText, ch.cardId,
                             function (t) { addMsg('sys', t); }, ch.clean);
        }
        messages.push({ role: 'assistant', content: fullText });
        // the replay glyph, not the narration — that already started above
        if (window.execVoice) streamDiv.insertBefore(execVoice.mark('assistant', fullText), streamDiv.firstChild);
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
    if (window.execMicReplyDone) execMicReplyDone();
  }

  // ── history ───────────────────────────────────────────────────────────────
  // Replay lives in exec-bubble-history.js (500-line cap); the panel keeps the
  // state it hands back.
  async function loadHistory() {
    const res = await execHistory.load(addMsg);
    if (!res) return;
    messages = res.messages;
    stage = res.stage;
    monitorTotal = res.monitorTotal;
    if (isOpen) markRead(); else recomputeUnread();
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

  var monitorConnected = false;

  function connectMonitorStream() {
    var src = new EventSource('/api/monitor/stream');
    // A dropped stream (backgrounded tab, phone asleep, network flap) eats
    // every push it missed -- EventSource never replays. So on a RECONNECT,
    // nudge any open board to refetch; without this a gap shorter than the
    // 30s wake threshold left /hq and /rd sitting on a stale board.
    src.onopen = function () {
      if (monitorConnected) window.dispatchEvent(new Event('exec:cards-changed'));
      monitorConnected = true;
    };
    src.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.thinking !== undefined) {
          setMonitorThinking(data.thinking);
        } else if (data.cards_changed) {  // serverside mutation -> open board reloads live
          window.dispatchEvent(new Event('exec:cards-changed'));
        } else if (data.comment) {
          setMonitorThinking(false);
          addMsg('probe', data.comment, data.card_id);
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
