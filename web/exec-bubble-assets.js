// Asset loaders for the exec bubble: the lazy marked.js fetch, the markdown
// sanitiser that pairs with it, and the stylesheet injection. (The reveal moved
// to exec-stream.js.) Split out of
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

// A link in a reply opens in a NEW TAB, always. The panel lives ON /rd and /hq,
// so following one in place tears the board down — and the panel with it, mid
// nudge, with the answer row still unanswered. Scheme-checked through URL()
// rather than by spelling: the regex scrub below only catches a literal
// `javascript:`, and `java\nscript:` is the same href to a browser.
function execSafeHref(href) {
  try {
    const u = new URL(href || '', document.baseURI);
    return (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') ? u.href : null;
  } catch { return null; }
}

// marked is lazy-loaded, so the renderer cannot be built at parse time. A build
// that hands back no Renderer falls back to plain parse rather than throwing:
// mdHtml is on the render path of EVERY message, so an exception here is a
// blank transcript, and same-tab links are a far smaller loss than that.
let execMdRenderer = null;
function execRenderer() {
  if (execMdRenderer) return execMdRenderer;
  if (!window.marked || typeof marked.Renderer !== 'function') return null;
  execMdRenderer = new marked.Renderer();
  execMdRenderer.link = ({ href, text }) => {
    const safe = execSafeHref(href);
    if (!safe) return text; // unusable scheme — keep the label, drop the link
    return '<a href="' + safe.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">' + text + '</a>';
  };
  return execMdRenderer;
}

// marked passes raw HTML straight through — strip <script>/on*=/javascript: URLs.
function mdHtml(t) { const r = execRenderer(); return marked.parse(t, r ? { renderer: r } : undefined).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"'); }

// Load the stylesheets and invoke cb once they have applied (or failed).
// Callers wait on this before building the panel so it never paints unstyled.
//
// FOUR files, in this order: chat-msg.css is the transcript vocabulary shared
// with /mtg and /tarot, voice-ui.css is the narrator control shared with
// /tarot, exec-term.css is the agent transcript (tools, diagrams, images, the
// status bar), and exec-bubble.css is the panel chrome that overrides them. Order is the cascade here -- both are appended to <head> with
// equal specificity, so a swap would hand the pages' rules the last word over
// the panel's.
function loadStyles(cb) {
  const existing = document.querySelector('link[data-exec-css]');
  if (existing) { cb(); return; }
  const hrefs = ['/chat-msg.css?v=6', '/voice-ui.css?v=4', '/exec-term.css?v=3', '/exec-bubble.css?v=30'];
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
