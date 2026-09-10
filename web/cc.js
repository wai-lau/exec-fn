/* /cc — sandboxed Claude Code on the shared chat terminal.
 *
 * Same shell as mtg.js (contenteditable input, caret mirror, iOS gesture focus,
 * marked-rendered assistant prose). What differs is the payload: the stream is
 * SSE over POST, so EventSource is unusable (GET only) and frames are parsed off
 * a fetch body reader. Event vocabulary is the sidecar's, relayed verbatim by
 * cc_client.py: session / text / thinking / tool / tool_result / done / busy /
 * error. */

let streaming = false;
let sessionId = null;   // resumes the sidecar's conversation across runs

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

function addMsg(role, text) {
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
  // Show the field that says what the call DOES, not a JSON dump.
  const key = inp.command || inp.file_path || inp.pattern || inp.path || inp.prompt;
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
    } else if (d.authed === false) {
      addMsg('sys warn', '[ cc-agent not logged in — run: sudo -u cc-agent -H /usr/bin/claude, then /login ]');
    } else {
      addMsg('sys', '[ sandbox ready — /srv/cc-sandbox · Read/Write/Edit/Glob/Grep/Bash ]');
    }
  } catch {
    addMsg('sys warn', '[ sidecar unreachable ]');
  }
}

// ── run ───────────────────────────────────────────────────────────────────
async function sendMsg() {
  if (streaming) return;
  const text = _msgInput.innerText.trim();
  if (!text) return;
  _msgInput.textContent = '';
  renderCaret();
  syncInputH();
  _msgInput.focus();
  addMsg('user', text);
  await streamResponse(text);
}

async function streamResponse(prompt) {
  streaming = true;
  let { div, body, cur } = addStreamDiv();
  let fullText = '';

  // The assistant bubble is created up front to carry the typing dots. A tool
  // call arriving before any prose would otherwise be appended AFTER an empty
  // bubble; instead the empty one is dropped and a fresh bubble opens for the
  // prose that follows, so the transcript stays in real order.
  const dropIfEmpty = () => {
    if (!fullText) { cur.remove(); div.remove(); div = null; }
    else { cur.remove(); }
  };
  const reopen = () => {
    const s = addStreamDiv();
    div = s.div; body = s.body; cur = s.cur;
    fullText = '';
  };

  try {
    const b = { prompt: prompt };
    if (sessionId) b.sessionId = sessionId;
    const r = await fetch('/api/cc/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
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

        if (data.type === 'session') {
          sessionId = data.sessionId || sessionId;
        } else if (data.type === 'text') {
          if (!div) reopen();
          fullText += data.text;
          body.innerHTML = renderText(fullText);
          (body.lastElementChild || body).appendChild(cur);
          if (atBottom()) terminal.scrollTop = terminal.scrollHeight;
        } else if (data.type === 'thinking') {
          if (data.text) { dropIfEmpty(); addMsg('think', data.text); }
        } else if (data.type === 'tool') {
          dropIfEmpty();
          addToolMsg(data.name, summarize(data.input));
        } else if (data.type === 'tool_result') {
          const t = (data.text || '').trim();
          if (t) { dropIfEmpty(); addMsg('out' + (data.isError ? ' err' : ''), clamp(t)); }
        } else if (data.type === 'done') {
          const bits = [];
          if (data.turns != null) bits.push(data.turns + ' turn' + (data.turns === 1 ? '' : 's'));
          if (data.ms != null) bits.push((data.ms / 1000).toFixed(1) + 's');
          if (bits.length) { dropIfEmpty(); addMsg('sys', '[ ' + bits.join(' · ') + ' ]'); }
        } else if (data.type === 'busy') {
          dropIfEmpty();
          addMsg('sys warn', '[ busy — one run at a time (memory ceiling); try again shortly ]');
        } else if (data.type === 'error') {
          dropIfEmpty();
          addMsg('sys warn', '[ ' + (data.detail || 'error') + ' ]');
        }
      }
    }
    if (div) { cur.remove(); if (!fullText) div.remove(); }
  } catch (e) {
    if (div) { cur.remove(); if (!fullText) div.remove(); }
    addMsg('sys warn', '[ ' + e.message + ' ]');
  }

  streaming = false;
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
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
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

announceState();

// defer: the nav script sets --nav-h after this script runs, so the input bar
// isn't positioned yet on this tick
requestAnimationFrame(() => { syncInputH(); terminal.scrollTop = terminal.scrollHeight; });
