// Asset loaders for the exec bubble: the lazy marked.js fetch, the markdown
// sanitiser that pairs with it, and the exec-bubble.css injection. Split out of
// exec-bubble.js (500-line cap); loaded immediately before it, same global
// scope, so exec-bubble.js calls these by bare name like its own functions.
'use strict';

// Exec's reveal: /tarot's typewriter at SPEED 2 (typewriter.js), so a reply
// arrives at a readable pace rather than in stream-sized bursts. The glue lives
// here rather than in exec-bubble.js, which is at 484 of the 500-line cap.
const EXEC_TYPE_SPEED = 2;

function execTyper(body, cur, termEl) {
  const tw = { buffered: '', displayed: '', serverDone: false, cancelled: false };
  let typing = null;
  function start() {
    if (typing) return typing;
    typing = new Promise((resolve) => {
      twGuess(tw, (shown) => {
        body.innerHTML = mdHtml(shown);
        (body.lastElementChild || body).appendChild(cur);
        termEl.scrollTop = termEl.scrollHeight;
      }, { speed: EXEC_TYPE_SPEED, onDone: resolve }).start();
    });
    return typing;
  }
  // Wait for the reveal to catch up before the caller settles the bubble.
  function finish() {
    tw.serverDone = true;
    return typing || Promise.resolve();
  }
  return { push: (text) => { tw.buffered = text; start(); }, finish };
}

// ── marked lazy-load ────────────────────────────────────────────────────────
function loadMarked(cb) {
  if (window.marked) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
  s.onload = cb;
  document.head.appendChild(s);
}

// marked passes raw HTML straight through — strip <script>/on*=/javascript: URLs.
function mdHtml(t) { return marked.parse(t).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"'); }

// Load the stylesheets and invoke cb once they have applied (or failed).
// Callers wait on this before building the panel so it never paints unstyled.
//
// TWO files, in this order: chat-msg.css is the transcript vocabulary shared
// with /mtg, /cc and /tarot, and exec-bubble.css is the panel chrome that
// overrides it. Order is the cascade here -- both are appended to <head> with
// equal specificity, so a swap would hand the pages' rules the last word over
// the panel's.
function loadStyles(cb) {
  const existing = document.querySelector('link[data-exec-css]');
  if (existing) { cb(); return; }
  const hrefs = ['/chat-msg.css?v=2', '/exec-bubble.css?v=21'];
  let left = hrefs.length;
  // One callback once BOTH have settled; a failed fetch still counts, so a CSS
  // 404 can never hang the panel.
  const done = () => { if (--left === 0) cb(); };
  for (const href of hrefs) {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    el.setAttribute('data-exec-css', '');
    el.onload = done;
    el.onerror = done;
    document.head.appendChild(el);
  }
}
