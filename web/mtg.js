let messages = [];
let streaming = false;
let _sessionId = 'mtg_' + Date.now().toString(36);

const terminal = document.getElementById('terminal');
const _WELCOME = "Hi (＊＾▽＾)／! Ask about card interactions, rules, or mechanics - I'll look up oracle text, rulings, and comprehensive rules.";

// Terminal bottom is CSS-driven (see #terminal rule). JS only mirrors the input
// bar's real height into --input-h, on layout changes — NOT on viewport scroll,
// so manual scrollback isn't yanked and the keyboard animation isn't chased.
const _inputBar = document.getElementById('input-bar');
function syncInputH() {
  document.documentElement.style.setProperty('--input-h', _inputBar.offsetHeight + 'px');
}
window.addEventListener('resize', syncInputH);
window.addEventListener('load', syncInputH);
syncInputH();
// Keyboard opening shrinks the terminal from the bottom; keep the newest line
// visible. One-shot on focus, not on every viewport event.
document.getElementById('msg-input').addEventListener('focus', () => {
  requestAnimationFrame(() => { terminal.scrollTop = terminal.scrollHeight; });
});

const _renderer = new marked.Renderer();
_renderer.link = ({href, title, text}) => {
  if (href && href.includes('scryfall.com')) {
    const plain = text.replace(/<[^>]*>/g, '');
    return `<span data-card="${plain.replace(/"/g, '&quot;')}">${text}</span>`;
  }
  return `<a href="${href}" target="_blank" rel="noopener"${title ? ` title="${title}"` : ''}>${text}</a>`;
};
marked.use({ breaks: true });

function renderText(raw) {
  return marked.parse(raw, {renderer: _renderer});
}

function addMsg(role, text) {
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
  terminal.scrollTop = terminal.scrollHeight;
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
  return {div, body, cur};
}

async function sendMsg() {
  if (streaming) return;
  const input = document.getElementById('msg-input');
  const text = input.innerText.trim();
  if (!text) return;
  input.textContent = '';
  renderCaret();
  syncInputH();
  input.focus();
  addMsg('user', text);
  messages.push({role:'user', content: text});
  await streamResponse();
}

async function streamResponse() {
  streaming = true;
  const {div, body, cur} = addStreamDiv();
  let fullText = '';

  try {
    const r = await fetch('/api/mtg/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages, session_id: _sessionId}),
    });

    if (!r.ok) throw new Error(await r.text());

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'text') {
          fullText += data.delta;
          body.innerHTML = renderText(fullText);
          (body.lastElementChild || body).appendChild(cur);
          terminal.scrollTop = terminal.scrollHeight;
        } else if (data.type === 'tool_call') {
          const label = data.name === 'lookup_card' ? `card lookup — ${data.count} found`
            : data.name === 'lookup_rulings' ? `rulings — ${data.count} found`
            : `rules — ${data.count} found`;
          addMsg('sys', `[ ${label} ]`);
          const sysMsgs = terminal.querySelectorAll('.msg.sys');
          if (sysMsgs.length > 3) sysMsgs[0].remove();
        }
      }
    }

    cur.remove();
    if (fullText) messages.push({role:'assistant', content: fullText});
  } catch(e) {
    cur.remove();
    div.textContent = '[error: ' + e.message + ']';
    div.style.color = 'hsl(var(--orange-glow-hsl) / 0.8)';
  }

  streaming = false;
}

addMsg('assistant', _WELCOME);

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

_msgInput.addEventListener('input', () => {
  renderCaret();
  syncInputH();  // bar may grow/shrink a line; CSS re-pins the terminal
});
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
  syncInputH();
});
_msgInput.focus();
renderCaret();

// iOS raises the soft keyboard only for a focus() inside a user gesture, so the
// on-load focus above can't summon it. Seat focus on the first interaction so the
// chat is typable with the keyboard up.
(function () {
  const onFirst = e => {
    // Taps on a real control manage their own focus — let them through.
    if (e.target.closest('button, a, input, textarea, [contenteditable]')) {
      document.removeEventListener('pointerdown', onFirst, true);
      return;
    }
    // Empty-space tap: completing it on a non-editable element would blur the
    // input we just focused and iOS drops the keyboard — preventDefault stops the
    // focus steal.
    e.preventDefault();
    document.removeEventListener('pointerdown', onFirst, true);
    _msgInput.focus({preventScroll: true});
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

// defer: the nav script sets --nav-h after this script runs, so the input
// bar isn't positioned yet on this tick
requestAnimationFrame(() => { syncInputH(); terminal.scrollTop = terminal.scrollHeight; });

// Card image hover tooltip via Scryfall
const _tooltip = document.getElementById('card-tooltip');
const _tooltipImg = document.getElementById('card-tooltip-img');
const _imgCache = {};

function _positionTooltip(e) {
  const pad = 16, w = 223 + pad;
  const x = e.clientX + pad + w > window.innerWidth ? e.clientX - w : e.clientX + pad;
  const y = Math.min(e.clientY - 40, window.innerHeight - 340);
  _tooltip.style.left = x + 'px';
  _tooltip.style.top = y + 'px';
}

async function _showCardImage(name, e) {
  _tooltip.className = 'loading';
  _tooltip.style.display = 'flex';
  _positionTooltip(e);
  _tooltipImg.src = '';

  if (!_imgCache[name]) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
      if (!r.ok) { _imgCache[name] = null; }
      else {
        const d = await r.json();
        const img = d.image_uris?.normal || d.card_faces?.[0]?.image_uris?.normal || null;
        _imgCache[name] = img ? {img, url: d.scryfall_uri} : null;
      }
    } catch { _imgCache[name] = null; }
  }

  if (_imgCache[name]) {
    _tooltipImg.src = _imgCache[name].img;
    _tooltip.className = '';
  } else {
    _tooltip.style.display = 'none';
  }
}

terminal.addEventListener('click', e => {
  const el = e.target.closest('[data-card]');
  if (!el || !el.closest('.msg.assistant')) return;
  const cached = _imgCache[el.dataset.card];
  if (cached?.url) window.open(cached.url, '_blank', 'noopener');
});

terminal.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-card]');
  if (el && el.closest('.msg.assistant')) {
    _showCardImage(el.dataset.card, e);
    el._mtgActive = true;
  }
});

terminal.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-card]');
  if (el && el._mtgActive) _positionTooltip(e);
});

terminal.addEventListener('mouseout', e => {
  const el = e.target.closest('[data-card]');
  if (el && el._mtgActive) {
    el._mtgActive = false;
    _tooltip.style.display = 'none';
  }
});
