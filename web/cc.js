/* /cc — a personal Claude chat page on the shared chat terminal.
 *
 * Same shell as mtg.js (contenteditable input, caret mirror, iOS gesture focus,
 * marked-rendered assistant prose). What differs is the payload: the stream is
 * SSE over POST, so EventSource is unusable (GET only) and frames are parsed off
 * a fetch body reader. Event vocabulary is the sidecar's, relayed verbatim by
 * cc_client.py: session / text / thinking / tool / tool_result / done / busy /
 * error. */

let streaming = false;
// Chat pace: three times the tarot reader's. These pages are read for an answer.
const CC_TYPE_SPEED = 3;
let pending = [];   // images pasted but not yet sent

const terminal = document.getElementById('terminal');

// Terminal bottom is CSS-driven (see cc.css #terminal). JS only mirrors the
// input bar's real height into --input-h, on layout changes — NOT on viewport
// scroll, so manual scrollback isn't yanked and the keyboard isn't chased.
const _inputBar = document.getElementById('input-bar');
function syncInputH() {
  document.documentElement.style.setProperty('--input-h', _inputBar.offsetHeight + 'px');
}
window.addEventListener('resize', syncInputH);
window.addEventListener('load', syncInputH);
syncInputH();

const _msgInput = document.getElementById('msg-input');
_msgInput.addEventListener('focus', () => {
  requestAnimationFrame(() => { terminal.scrollTop = terminal.scrollHeight; });
});

// marked's default link renderer runs href through cleanUrl()/encodeURI() before
// interpolating it into the <a>; replacing it means redoing that safety here.
// Agent output can quote a hostile URL out of a file it just read, so a
// javascript:/data: destination is dropped rather than rendered.
function _escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _safeHref(href) {
  if (!href) return null;
  try {
    const u = new URL(href, document.baseURI);
    return (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') ? u.href : null;
  } catch {
    return null;
  }
}
const _renderer = new marked.Renderer();
_renderer.link = ({ href, title, text }) => {
  const safe = _safeHref(href);
  if (!safe) return text;
  const titleAttr = title ? ` title="${_escapeAttr(title)}"` : '';
  return `<a href="${_escapeAttr(safe)}" target="_blank" rel="noopener"${titleAttr}>${text}</a>`;
};
marked.use({ breaks: true });

function renderText(raw) {
  return marked.parse(raw, { renderer: _renderer });
}

function atBottom() {
  return terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
}

function addMsg(role, text, images) {
  // Only chase the tail when the reader is already there — yanking the view down
  // mid-scroll while a long tool result streams is the worst thing a transcript
  // can do.
  const stick = atBottom();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'assistant' || role === 'user') {
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = renderText(text);
    ccRenderSvgBlocks(body);
    addImages(body, images);
    div.appendChild(body);
  } else {
    div.textContent = text;
  }
  terminal.appendChild(div);
  if (stick) terminal.scrollTop = terminal.scrollHeight;
  return div;
}

function addToolMsg(name, arg) {
  const stick = atBottom();
  const div = document.createElement('div');
  div.className = 'msg tool';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const b = document.createElement('b');
  b.textContent = name || 'tool';
  body.appendChild(b);
  if (arg) body.appendChild(document.createTextNode(' ' + arg));
  div.appendChild(body);
  terminal.appendChild(div);
  if (stick) terminal.scrollTop = terminal.scrollHeight;
  return div;
}

function addStreamDiv() {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const cur = document.createElement('span');
  cur.id = 'blinkcursor';
  cur.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(cur);
  div.appendChild(body);
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
  return { div, body, cur };
}

function summarize(inp) {
  if (inp == null) return '';
  if (typeof inp === 'string') return clamp(inp, 200);
  // Show the field that says what the call DOES, not a JSON dump. `query` and
  // `url` come first for the web tools: WebSearch has neither of the older keys
  // and fell through to a raw JSON dump, and WebFetch carries a `prompt` too --
  // which is the instruction to the fetcher, not the thing being fetched.
  const key = inp.query || inp.url || inp.command || inp.file_path
    || inp.pattern || inp.path || inp.prompt;
  if (typeof key === 'string') return clamp(key, 200);
  try { return clamp(JSON.stringify(inp), 200); } catch { return ''; }
}

function clamp(s, n) {
  n = n || 4000;
  return s.length > n ? s.slice(0, n) + ' …' : s;
}

// ── health ────────────────────────────────────────────────────────────────
/** Report the sidecar's state as a terminal line, not a silent badge.
 *
 * A logged-out sidecar answers every run with "Not logged in · Please run
 * /login", which reads as a broken page unless something says otherwise — that
 * is exactly how this got reported as down. Said once, on load, in the warn
 * colour. */
async function announceState() {
  try {
    const r = await fetch('/api/cc/health', { cache: 'no-store' });
    const d = await r.json();
    if (d.unreachable || !d.ok) {
      addMsg('sys warn', '[ sidecar offline — sudo systemctl status cc-sidecar ]');
      return false;
    }
    if (d.authed === false) {
      addMsg('sys warn', '[ cc-agent not logged in — run: sudo -u cc-agent -H /usr/bin/claude, then /login ]');
      return false;
    }
    return true;
  } catch {
    addMsg('sys warn', '[ sidecar unreachable ]');
    return false;
  }
}

/** Replay the ongoing conversation.
 *
 * /cc is ONE continuing thread: the session lives on the sidecar, so a reload —
 * or a different device — resumes it instead of starting over, which is what it
 * used to do on every single load. Rendered before the input is usable so the
 * page never looks empty while the model still remembers everything. */
async function loadHistory() {
  try {
    const r = await fetch('/api/cc/history', { cache: 'no-store' });
    const d = await r.json();
    const msgs = d.messages || [];
    for (const m of msgs) addMsg(m.role === 'user' ? 'user' : 'assistant', m.text, m.images);
    // No "continuing" line, and no "ready" either. A sys line is for something
    // Claude DID -- a search, a fetch, a failure -- not for telling you the page
    // works the way it always works: a transcript says it continued, and an
    // empty one says it is new.
    terminal.scrollTop = terminal.scrollHeight;
  } catch {
    addMsg('sys warn', '[ could not load the conversation ]');
  }
}

async function sendMsg() {
  if (streaming) return;
  const text = _msgInput.innerText.trim();
  // An image on its own is a real message ("what is this?"), so an empty box
  // is only empty when there is nothing pending either.
  if (!text && !pending.length) return;
  _msgInput.textContent = '';
  renderCaret();
  syncInputH();
  // Keep the keyboard up between typed messages -- but NOT during a voice
  // session, where focusing the box is what raises the keyboard, shrinks the
  // viewport and takes the nav bar with it, for an input nobody is typing into.
  if (typeof ccMicActive !== 'function' || !ccMicActive()) _msgInput.focus();
  // EVERY leading slash goes through runCommand, images attached or not. The
  // `&& !pending.length` that used to be here meant a command typed with a
  // screenshot attached was sent to the SDK verbatim -- including `/clear`,
  // which the SDK honours silently and which would have dropped the
  // conversation WITHOUT the archive that /new writes first.
  if (text.startsWith('/')) {
    if (await runCommand(text)) return;
  }
  const imgs = pending.slice();
  pending = [];
  thumbStrip();
  addMsg('user', text, imgs);
  await streamResponse(text, imgs);
}

/** Park the blinking cursor on a line, and return that line.
 *
 * The cursor follows the work. Dropping the empty bubble for a tool call took
 * the only "still going" signal off the screen with it, so a long search or
 * fetch looked like a page that had stopped -- it now rides whatever line is
 * last until the turn actually ends. */
function park(el, cur) {
  if (el && cur) el.appendChild(cur);
  return el;
}

/** The turn/time receipt, or null when nothing happened worth reporting.
 *
 * An ordinary reply needs no line: the answer is the receipt. It is worth one
 * only when a tool ran (more than one turn) or the wait was long enough to want
 * explaining. */
function ccDoneLine(data) {
  const bits = [];
  if (data.turns > 1) bits.push(data.turns + ' turns');
  if (data.ms != null && data.ms >= 15000) bits.push((data.ms / 1000).toFixed(1) + 's');
  return bits.length ? '[ ' + bits.join(' · ') + ' ]' : null;
}

async function streamResponse(prompt, imgs) {
  streaming = true;
  let { div, body, cur } = addStreamDiv();
  let fullText = '';

  // The assistant bubble is created up front to carry the typing dots. A tool
  // call arriving before any prose would otherwise be appended AFTER an empty
  // bubble; instead the empty one is dropped and a fresh bubble opens for the
  // prose that follows, so the transcript stays in real order.
  // Idempotent, and that is the whole point: a turn routinely fires several of
  // these in a row (tool, tool_result, tool again -- the archive tools list
  // then read), and the first call sets div to null. Without the guard the
  // second one called .remove() on null and the turn died with "null is not an
  // object", losing the reply that was still streaming behind it.
  const dropIfEmpty = () => {
    if (!div) return;
    cur.remove();
    if (!fullText) { div.remove(); div = null; tw.cancelled = true; }
  };
  const reopen = () => {
    const s = addStreamDiv();
    div = s.div; body = s.body; cur = s.cur;
    fullText = '';
    // A new bubble gets a new reveal. The old state object is cancelled rather
    // than reused: a typer still running against it would otherwise keep
    // writing into the bubble that was just closed.
    tw.cancelled = true;
    tw = { buffered: '', displayed: '', serverDone: false, cancelled: false };
    typing = null;
  };

  // Reveal the reply at a readable pace instead of in stream-sized bursts --
  // the same engine /tarot uses, at SPEED 3 (typewriter.js). It never lags the
  // stream by much: the weights are per character and the text is already here.
  let tw = { buffered: '', displayed: '', serverDone: false, cancelled: false };
  let typing = null;
  const startTyper = () => {
    if (typing) return;
    typing = new Promise((resolve) => {
      twGuess(tw, (shown) => {
        body.innerHTML = renderText(shown);
        (body.lastElementChild || body).appendChild(cur);
        if (atBottom()) terminal.scrollTop = terminal.scrollHeight;
      }, { speed: CC_TYPE_SPEED, onDone: resolve }).start();
    });
  };

  try {
    const r = await fetch('/api/cc/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        // strip the data: URL used for the local thumbnail; the wire wants
        // bare base64 and the prefix would fail the sidecar's validation
        images: (imgs || []).map(i => ({ media_type: i.media_type, data: i.data })),
      }),
    });
    if (!r.ok || !r.body) {
      let msg = 'request failed (' + r.status + ')';
      try { msg = (await r.json()).error || msg; } catch { /* non-JSON body */ }
      throw new Error(msg);
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      // A chunk boundary can split a frame anywhere, including mid-UTF-8, so the
      // decoder streams and the buffer tail is carried to the next read.
      buf += dec.decode(step.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        // The status bar reads model / context / rate-limit windows off the
        // same stream; it ignores everything else.
        if (typeof ccStatusOn === 'function') ccStatusOn(data);

        if (data.type === 'session') {
          /* the sidecar owns the thread; nothing to track here */
        } else if (data.type === 'text') {
          if (!div) reopen();
          fullText += data.text;
          tw.buffered = fullText;
          startTyper();
        } else if (data.type === 'thinking') {
          if (data.text) { dropIfEmpty(); park(addMsg('think', data.text), cur); }
        } else if (data.type === 'tool') {
          dropIfEmpty();
          park(addToolMsg(data.name, summarize(data.input)), cur);
        } else if (data.type === 'tool_result') {
          const t = (data.text || '').trim();
          if (t) { dropIfEmpty(); park(addMsg('out' + (data.isError ? ' err' : ''), clamp(t)), cur); }
        } else if (data.type === 'done') {
          const receipt = ccDoneLine(data);
          if (receipt) { dropIfEmpty(); addMsg('sys', receipt); }
        } else if (data.type === 'busy') {
          dropIfEmpty();
          addMsg('sys warn', '[ busy — one run at a time (memory ceiling); try again shortly ]');
        } else if (data.type === 'error') {
          dropIfEmpty();
          addMsg('sys warn', '[ ' + (data.detail || 'error') + ' ]');
        }
      }
    }
    // Let the reveal catch up before settling: the final render is the markdown
    // pass that also swaps in SVG diagrams, and running it while the typer is
    // still going would print the whole reply and then keep typing over it.
    tw.serverDone = true;
    if (typing) await typing;
    if (div) {
      cur.remove();
      if (!fullText) div.remove();
      else { body.innerHTML = renderText(fullText); ccRenderSvgBlocks(body); }
    }
  } catch (e) {
    if (div) { cur.remove(); if (!fullText) div.remove(); }
    addMsg('sys warn', '[ ' + e.message + ' ]');
  }

  streaming = false;
  // The turn is over. cc-mic.js listens for this to re-arm a voice session; the
  // event says only "a reply finished" and knows nothing about the microphone.
  terminal.dispatchEvent(new CustomEvent('cc:reply-done'));
}

// ── input (mtg idioms) ────────────────────────────────────────────────────
const _pre = document.getElementById('input-pre');
const _post = document.getElementById('input-post');
const _inputCursor = document.getElementById('input-cursor');

function _caretOffset() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !_msgInput.contains(sel.anchorNode)) return _msgInput.innerText.length;
  const range = document.createRange();
  range.selectNodeContents(_msgInput);
  // After clearing the input on submit, the stale selection offset can point past
  // the emptied node — WebKit throws IndexSizeError where Chromium clamps.
  // Falling back keeps renderCaret (hence sendMsg) from aborting.
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

_msgInput.addEventListener('input', () => { renderCaret(); syncInputH(); });
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
// Paste plain text only: rich HTML drags in inline colors (invisible on the dark
// terminal) and stray nodes the input wasn't built for.
_msgInput.addEventListener('paste', e => {
  const cd = e.clipboardData || window.clipboardData;
  // A screenshot paste carries an image FILE, not text. Take those first;
  // anything else falls through to the plain-text path below, which exists
  // because rich HTML drags in inline colors invisible on a dark terminal.
  const files = Array.from(cd.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    Promise.all(files.slice(0, 4).map(shrink)).then(list => {
      for (const im of list) if (im && pending.length < 4) pending.push(im);
      thumbStrip();
    });
    return;
  }
  e.preventDefault();
  const text = cd.getData('text/plain');
  document.execCommand('insertText', false, text);
  renderCaret();
  syncInputH();
});
_msgInput.focus();
renderCaret();

// iOS raises the soft keyboard only for a focus() inside a user gesture, so the
// on-load focus above can't summon it. Seat focus on the first interaction.
(function () {
  const onFirst = e => {
    if (e.target.closest('button, a, input, textarea, [contenteditable]')) {
      document.removeEventListener('pointerdown', onFirst, true);
      return;
    }
    // Empty-space tap: completing it on a non-editable element would blur the
    // input we just focused and iOS drops the keyboard.
    e.preventDefault();
    document.removeEventListener('pointerdown', onFirst, true);
    _msgInput.focus({ preventScroll: true });
    if (document.activeElement === _msgInput) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(_msgInput);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      renderCaret();
    }
  };
  document.addEventListener('pointerdown', onFirst, { capture: true, passive: false });
})();

(async () => {
  if (await announceState()) await loadHistory();
})();

// defer: the nav script sets --nav-h after this script runs, so the input bar
// isn't positioned yet on this tick
requestAnimationFrame(() => { syncInputH(); terminal.scrollTop = terminal.scrollHeight; });
