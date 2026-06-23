async function streamResponse() {
  streaming = true;
  updateInputBarVisibility();
  const {div, body, cur} = addStreamDiv();
  let buffered = '';   // received from server
  let displayed = '';  // rendered to DOM
  let serverDone = false;
  let drainCancelled = false;
  const pendingSys = [];  // sys notes held until the reader finishes speaking
  let pendingDeal = null; // frame to deal once the reader is done speaking

  // Punctuation-weighted pacing. In SILENT mode these are the literal per-char
  // delays (tuned to an unhurried reader, ~130 wpm). In VOICE mode the SAME
  // weights set only the SHAPE of the typing — the dramatic pauses at periods
  // and em-dashes — while the total is rescaled to the measured audio duration
  // and driven off the playback clock, so the text tracks the actual voice.
  const SPEED = 1.25;       // overall pace multiplier (silent mode)
  const BASE_MS = 65;
  function charWeight(ch) {
    switch (ch) {
      case '.': case '!': case '?': return 850;
      case ',': case ';': case ':': return 420;
      case '—': case '-':           return 480; // em-dash, hyphen
      case '\n':                    return 1100;
      case ' ':                     return 110;
      default:                      return BASE_MS;
    }
  }
  function render() {
    body.innerHTML = renderText(displayed);
    (body.lastElementChild || body).appendChild(cur);
    terminal.scrollTop = terminal.scrollHeight;
  }
  // SILENT: reveal one char at a time at the weighted (guessed) pace.
  function drainGuessed() {
    if (drainCancelled) return;
    if (displayed.length < buffered.length) {
      displayed = buffered.slice(0, displayed.length + 1);
      render();
      setTimeout(drainGuessed, charWeight(displayed[displayed.length - 1]) / SPEED);
    } else if (!serverDone) {
      setTimeout(drainGuessed, 50);
    }
  }
  // VOICE: drive the reveal off the audio clock. `buffered` is final by the time
  // this runs (after the server stream completes), so the weight schedule is fixed.
  function drainAudio(ctl) {
    const text = buffered;
    const cum = new Array(text.length + 1);
    cum[0] = 0;
    for (let i = 0; i < text.length; i++) cum[i + 1] = cum[i] + charWeight(text[i]);
    const totalW = cum[text.length] || 1;
    function tick() {
      if (drainCancelled) return;
      if (!ctl.ok) { drainGuessed(); return; }  // audio fell through → guessed pace
      const dur = ctl.duration();
      const el = ctl.elapsed();
      if (dur > 0) {
        // fraction of the voice consumed; don't outrun audio that's still buffering
        let frac = ctl.ended ? el / dur : Math.min(el / dur, 0.999);
        frac = Math.max(0, Math.min(1, frac));
        const targetW = frac * totalW;
        let n = displayed.length;
        while (n < text.length && cum[n + 1] <= targetW) n++;
        if (n !== displayed.length) { displayed = text.slice(0, n); render(); }
      }
      const audioFinished = ctl.ended && el >= dur;
      if (audioFinished && displayed.length >= text.length) return;  // done
      if (audioFinished && displayed.length < text.length) {
        // tail with no audio behind it (e.g. a stripped invite) → flush briskly
        displayed = text.slice(0, displayed.length + 2);
        render();
        setTimeout(tick, 16);
        return;
      }
      requestAnimationFrame(tick);
    }
    tick();
  }

  // Decide the path up front. Voice mode holds the text until audio starts (the
  // reader "draws breath" behind a blinking cursor); silent mode types as the
  // server text arrives, exactly as before.
  const voiceReady = tarotVoice.ready();
  let voiceCtl = null;
  if (!voiceReady) drainGuessed();

  try {
    const r = await fetch('/api/tarot/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({messages, spread: filteredSpread(), session_id: spread?.session_id || null}),
    });
    if (!r.ok) throw new Error(await r.text());
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'text') {
          buffered += data.delta;
        } else if (data.type === 'tool_call') {
          if (data.name === 'set_significator' && data.input?.card_id) {
            const cid = data.input.card_id;
            if (significator) {
              pendingSys.push(`[ set_significator ignored: Significator already locked (${significator.name}) ]`);
            } else if (data.count === 0) {
              pendingSys.push(`[ set_significator failed: ${cid} (not a court card) ]`);
            } else {
              const c = courtList().find(x => x.card_id === cid);
              if (c) {
                significator = {card_id: c.card_id, name: c.name, image: c.image};
                localStorage.setItem(LS_SIG, JSON.stringify(significator));
                renderSigCard();
              }
              pendingSys.push(`[ Significator set: ${c?.name || cid} ]`);
            }
          } else if (data.name === 'deal_spread') {
            if (spread) {
              pendingSys.push('[ deal_spread ignored: spread already dealt ]');
            } else if (data.count === 0) {
              pendingSys.push('[ deal_spread error — reader will retry ]');
            } else {
              // no sys note — the '[drew a ...]' event marker already
              // announces the deal. defer the actual draw until the reader
              // has finished speaking.
              pendingDeal = data.input?.frame || 'past_present_future';
            }
          } else {
            const label = data.input?.card_id ? `card lookup — ${data.input.card_id}` : `${data.name} — ${data.count}`;
            pendingSys.push(`[ ${label} ]`);
          }
        }
      }
    }
    serverDone = true;
    // Voice mode: strip any trailing flip-invite BEFORE narrating (so the voice
    // and the typewriter both work from the final text), then start the reader
    // and pace the reveal to it. Silent mode strips after typing (below).
    if (voiceReady && pendingDeal) buffered = stripDealInvite(buffered);
    if (voiceReady) {
      voiceCtl = tarotVoice.speak(buffered);
      drainAudio(voiceCtl);
    }
    // wait for the reveal to catch up — and, in voice mode, for the voice to end
    while (
      displayed.length < buffered.length ||
      (voiceCtl && voiceCtl.ok && !voiceCtl.ended)
    ) {
      await new Promise(r => setTimeout(r, 50));
    }
    cur.remove();
    // The deal turn must end at "let me set the cards." — the flip invite is the
    // frontend's job now (see drawSpread). If the reader tacked one on anyway,
    // strip the trailing invite so it isn't duplicated.
    if (pendingDeal) {
      const stripped = stripDealInvite(buffered);
      if (stripped !== buffered) {
        buffered = stripped;
        body.innerHTML = renderText(buffered);
      }
    }
    // backstop: reader declared the Significator in prose but skipped the
    // set_significator tool call. Match the one court card it named and fill the
    // slot so the flow doesn't stall.
    if (!significator && buffered) {
      const low = buffered.toLowerCase();
      const named = courtList().filter(c => low.includes(c.name.toLowerCase()));
      if (named.length === 1) {
        const c = named[0];
        significator = {card_id: c.card_id, name: c.name, image: c.image};
        localStorage.setItem(LS_SIG, JSON.stringify(significator));
        renderSigCard();
      }
    }
    // reader done speaking — now emit any held sys notes
    for (const m of pendingSys) addMsg('sys', m);
    const sysMsgs = terminal.querySelectorAll('.msg.sys');
    for (let i = 0; i < sysMsgs.length - 6; i++) sysMsgs[i].remove();
    if (buffered) {
      messages.push({role: 'assistant', content: buffered});
      localStorage.setItem(LS_MESSAGES, JSON.stringify(messages));
    }
  } catch(e) {
    serverDone = true;
    drainCancelled = true;
    cur.remove();
    div.textContent = '[error: ' + e.message + ']';
    div.style.color = 'hsl(var(--orange-glow-hsl) / 0.8)';
    pendingDeal = null;
  }
  streaming = false;
  updateInputBarVisibility();
  // draw the spread only now — after the reader stopped and the note printed
  if (pendingDeal) drawSpread('three', pendingDeal);
  else focusInput();
}

// focus the composer whenever it is the querent's turn. Retries across a few
// frames because focus on a just-unhidden element is silently dropped.
function _caretToEnd() {
  // contenteditable .focus() alone leaves no caret/selection inside the node, so
  // typing has nowhere to land. Put the caret at the end explicitly.
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(_msgInput);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function focusInput() {
  if (document.body.classList.contains('no-input')) return;
  if (cardZoom.classList.contains('open')) return;
  const tries = [0, 60, 180];
  for (const t of tries) {
    setTimeout(() => {
      if (document.body.classList.contains('no-input')) return;
      if (cardZoom.classList.contains('open')) return;
      _msgInput.focus({preventScroll: true});
      // only seat the caret if focus actually landed and there isn't already a
      // live selection inside the field (don't stomp a mid-edit cursor)
      if (document.activeElement === _msgInput) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !_msgInput.contains(sel.anchorNode)) _caretToEnd();
        renderCaret();
      }
    }, t);
  }
}

const _pre = document.getElementById('input-pre');
const _post = document.getElementById('input-post');
const _inputCursor = document.getElementById('input-cursor');
const _msgInput = document.getElementById('msg-input');

function _caretOffset() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !_msgInput.contains(sel.anchorNode)) return _msgInput.innerText.length;
  const range = document.createRange();
  range.selectNodeContents(_msgInput);
  // After clearing the input (submit), the stale selection offset can point past
  // the emptied node — WebKit throws IndexSizeError where Chromium clamps. Falling
  // back keeps renderCaret (hence sendMsg) from aborting and blanking the page.
  try {
    range.setEnd(sel.anchorNode, sel.anchorOffset);
  } catch {
    return _msgInput.innerText.length;
  }
  return range.toString().length;
}

function renderCaret() {
  const text = _msgInput.innerText;
  const pos = _caretOffset();
  _pre.textContent = text.slice(0, pos);
  _post.textContent = text.slice(pos);
}

_msgInput.addEventListener('input', renderCaret);

// keep the terminal bottom pinned to the top of the input bar so a multi-line
// input pushes the scrollback up instead of covering it
const _inputBar = document.getElementById('input-bar');
const _syncInputH = () => {
  document.documentElement.style.setProperty('--input-h', _inputBar.offsetHeight + 'px');
  terminal.scrollTop = terminal.scrollHeight;
};
new ResizeObserver(_syncInputH).observe(_inputBar);
_syncInputH();
_msgInput.addEventListener('blur', () => { _inputCursor.style.display = 'none'; });
_msgInput.addEventListener('focus', () => { _inputCursor.style.display = ''; renderCaret(); });
_msgInput.addEventListener('keyup', renderCaret);
_msgInput.addEventListener('click', renderCaret);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === _msgInput) renderCaret();
});
_msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
// Paste plain text only: rich HTML drags in inline colors (invisible on the
// dark terminal) and stray nodes the input wasn't built for.
_msgInput.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
  renderCaret();
  _syncInputH();
});

// last-resort: if auto-focus was dropped, the first printable keystroke routes
// into the composer
document.addEventListener('keydown', e => {
  if (document.activeElement === _msgInput) return;
  if (document.body.classList.contains('no-input')) return;
  if (cardZoom.classList.contains('open')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length === 1) {
    _msgInput.focus({preventScroll: true});
    // place caret at end so the in-flight char appends correctly
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(_msgInput);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

async function saveReading() {
  if (!messages.length && !spread && !significator) return;
  try {
    await fetch('/api/tarot/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ significator, spread, messages }),
      keepalive: true,
    });
  } catch (e) {
    console.warn('reading save failed', e);
  }
}

async function resetAll() {
  if (!confirm('Reset everything? This reading will be saved, then Significator, spread, and chat history cleared.')) return;
  await saveReading();
  significator = null;
  spread = null;
  messages = [];
  localStorage.removeItem(LS_SIG);
  localStorage.removeItem(LS_SPREAD);
  localStorage.removeItem(LS_MESSAGES);
  terminal.innerHTML = '';
  renderSigCard();
  renderSpread();
  autoTrigger(`[opened /tarot; no Significator yet, no spread; ${tarotTimeMarker()}]`);
}

function tarotTimeMarker() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const h = d.getHours();
  let band;
  if (h < 5)       band = 'late-night';
  else if (h < 8)  band = 'predawn';
  else if (h < 11) band = 'morning';
  else if (h < 14) band = 'midday';
  else if (h < 17) band = 'afternoon';
  else if (h < 20) band = 'dusk';
  else if (h < 23) band = 'evening';
  else             band = 'late-night';
  return `time=${hh}:${mm} ${band}`;
}
document.getElementById('reset-btn').addEventListener('click', resetAll);

sigCard.addEventListener('click', () => {
  if (significator) openZoom(significator.image, significator.name, 'Significator');
});
cardZoom.addEventListener('click', closeZoom);
renderSigCard();

focusInput();

// iOS raises the soft keyboard only for a focus() that runs synchronously inside
// a user gesture — never from a setTimeout (so focusInput, which defers, can't do
// it). The send (return key) and zoom-dismiss taps already focus in-gesture; the
// one gap is the opening turn, which has no gesture. Seat focus on the first page
// interaction so the first question is typable, then later gestures keep it up.
function _focusNow() {
  if (document.body.classList.contains('no-input')) return;
  if (cardZoom.classList.contains('open')) return;
  _msgInput.focus({preventScroll: true});
  if (document.activeElement === _msgInput) { _caretToEnd(); renderCaret(); }
}
(function armOpeningFocus() {
  const onFirst = e => {
    // Taps on a real control (the input, a button/link, a card, the zoom) manage
    // their own focus — let them through.
    if (e.target.closest('button, a, input, textarea, [contenteditable], #spread-area, #card-zoom')) {
      document.removeEventListener('pointerdown', onFirst, true);
      return;
    }
    // Empty-space tap: without this, completing the tap on a non-editable element
    // blurs the input we just focused and iOS drops the keyboard. preventDefault
    // stops the tap from stealing focus.
    e.preventDefault();
    document.removeEventListener('pointerdown', onFirst, true);
    _focusNow();
  };
  document.addEventListener('pointerdown', onFirst, { capture: true, passive: false });
})();

// No Significator -> always force Phase 1 (selection interview), wiping any
// stale chat history so the bot leads cleanly.
if (!significator && messages.length) {
  messages = [];
  localStorage.removeItem(LS_MESSAGES);
}

if (messages.length) {
  for (const m of messages) {
    if (m.role === 'user' && m.content.startsWith('[') && m.content.endsWith(']')) {
      addEventMsg(m.content);
    } else {
      addMsg(m.role, m.content);
    }
  }
}

updateInputBarVisibility();
loadSpreadsMeta().then(renderSpread);

if (!significator) {
  const tm = tarotTimeMarker();
  const ev = spread
    ? `[opened /tarot; no Significator yet (spread already drawn — Significator must be chosen before any reading continues); ${tm}]`
    : `[opened /tarot; no Significator yet, no spread; ${tm}]`;
  autoTrigger(ev);
} else if (!messages.length) {
  autoTrigger(`[opened /tarot; Significator already chosen: ${significator.name}; no spread yet; ${tarotTimeMarker()}]`);
}
