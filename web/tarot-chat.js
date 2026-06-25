
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

// The querent may type only when it is their turn: NOT while the reader streams
// a turn (reader-speaking) and NOT while the opening is held for the first
// gesture (opening-pending). Gating focus on this keeps the caret (and the soft
// keyboard) from appearing mid-reading -- the cursor shows only when it's time
// to type.
function _canType() {
  return !document.body.classList.contains('reader-speaking')
      && !document.body.classList.contains('opening-pending');
}

function focusInput() {
  if (document.body.classList.contains('no-input')) return;
  if (cardZoom.classList.contains('open')) return;
  if (!_canType()) return;
  const tries = [0, 60, 180];
  for (const t of tries) {
    setTimeout(() => {
      if (document.body.classList.contains('no-input')) return;
      if (cardZoom.classList.contains('open')) return;
      if (!_canType()) return;
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
  if (!_canType()) return;
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
  if (!_canType()) return;
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

// Tapping the reader's text area focuses the composer (raises the soft keyboard)
// so a reply can be typed without aiming at the input bar. Use `click`, not
// `pointerdown`: pointerdown on the non-focusable terminal moves focus away as
// the tap completes (blurring the input we just focused), whereas click fires
// after that and the focus sticks — and a scroll-drag yields no click, so the
// scrollback still drags. Skip while the reader speaks (don't cover the reading)
// and when a real control/card/zoom owns the tap.
terminal.addEventListener('click', e => {
  if (document.body.classList.contains('reader-speaking')) return;
  if (e.target.closest('button, a, input, textarea, [contenteditable], #card-zoom')) return;
  _focusNow();
});

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

// Faint terminal hint shown while the opening turn waits for the first gesture
// (voice on, not yet unlocked). Returns a cleanup that removes it.
function showBeginHint() {
  const hint = document.createElement('div');
  hint.className = 'begin-hint';
  hint.textContent = '[ tap anywhere to begin the reading ]';
  terminal.appendChild(hint);
  return () => hint.remove();
}

let _openingEv = null;
if (!significator) {
  const tm = tarotTimeMarker();
  _openingEv = spread
    ? `[opened /tarot; no Significator yet (spread already drawn — Significator must be chosen before any reading continues); ${tm}]`
    : `[opened /tarot; no Significator yet, no spread; ${tm}]`;
} else if (!messages.length) {
  _openingEv = `[opened /tarot; Significator already chosen: ${significator.name}; no spread yet; ${tarotTimeMarker()}]`;
}
if (_openingEv) {
  beginOpening(_openingEv);
} else {
  // No opening turn (returning mid-reading) -> still unlock on first gesture so
  // the next reader turn narrates.
  tarotVoice.armPersistedUnlock();
}

// Fresh reading: gate the opening behind the "who reads for you?" screen. Add the
// opening marker once, eager-generate EVERY persona's opening in parallel (server
// streams into buffers), then let the pick replay the chosen one instantly and
// abort the rest. The pick is the gesture that unlocks audio for narration.
async function beginOpening(ev) {
  await tarotPersona.ready;
  const cast = tarotPersona.list();
  if (cast.length <= 1) { openingNoChoice(ev); return; }  // degraded: nothing to choose
  addEventMsg(ev);
  messages.push({role: 'user', content: ev});
  const pre = {};
  for (const p of cast) pre[p.id] = prefetchOpening(p.id);
  document.body.classList.add('opening-pending');
  tarotPersona.chooseScreen((id) => {
    document.body.classList.remove('opening-pending');
    // Abort the openings we won't use; swallow their rejection so a discarded
    // prefetch never surfaces as an unhandled rejection.
    for (const k in pre) if (k !== id) { pre[k].abort(); pre[k].promise.catch(() => {}); }
    streamResponse(null, pre[id].promise);
  });
}

// Fallback when the persona list is unavailable (single persona): the original
// eager-hold-for-gesture opening — generate now, hold the reveal+voice until the
// first gesture if voice is on but not yet unlocked.
function openingNoChoice(ev) {
  if (tarotVoice.wantsDeferredOpening()) {
    const clearHint = showBeginHint();
    document.body.classList.add('opening-pending');
    let openGate;
    const gate = new Promise((res) => { openGate = res; });
    tarotVoice.armOpeningUnlock(() => {
      document.body.classList.remove('opening-pending');
      clearHint();
      openGate();
    });
    autoTrigger(ev, gate);
  } else {
    autoTrigger(ev);
  }
}
