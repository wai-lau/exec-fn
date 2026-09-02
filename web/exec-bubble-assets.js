// Asset loaders for the exec bubble: the lazy marked.js fetch, the markdown
// sanitiser that pairs with it, and the exec-bubble.css injection. Split out of
// exec-bubble.js (500-line cap); loaded immediately before it, same global
// scope, so exec-bubble.js calls these by bare name like its own functions.
'use strict';

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

// Load the stylesheet and invoke cb once it has applied (or failed). Callers
// wait on this before building the panel so the panel never paints unstyled.
function loadStyles(cb) {
  const existing = document.querySelector('link[data-exec-css]');
  if (existing) { cb(); return; }
  const el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = '/exec-bubble.css?v=19';
  el.setAttribute('data-exec-css', '');
  el.onload = cb;
  el.onerror = cb;  // never hang the panel on a CSS fetch failure
  document.head.appendChild(el);
}
