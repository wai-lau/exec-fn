/* The /cc status bar — the same numbers the Claude Code status line shows in a
 * terminal, in the same shape, pinned to the top of the page.
 *
 * Everything here is REPORTED by the sidecar, never estimated: the model comes
 * from the SDK's init frame, the context size from the input side of the last
 * result (prompt + cache reads), and the 5h / 7d windows from the subscription's
 * own rate_limit_event. A status line that guessed would be worse than none.
 *
 * It is FIXED, outside #terminal, so scrolling the transcript never takes it
 * away -- the numbers it carries are about the session, not about the part of
 * the conversation currently on screen.
 *
 * Loaded before cc.js, same global scope; cc.js hands it every SSE frame.
 */
'use strict';

// Claude's context window, by model id. [1m] is the million-token variant; the
// rest sit at 200K. Wrong only if a model ships with a new window and this is
// not updated -- at which point the percentage is off, not the page.
const CC_CTX_1M = 1000000;
const CC_CTX_DEFAULT = 200000;

const ccStatusState = { model: '', ctx: 0, base: 0, windows: {} };

// The statusline script's definition, mirrored: `base` is the SMALLEST total
// input ever observed -- system prompt + tools + standing context, the floor a
// conversation can never go below -- and it persists, because the first turn
// after a /new is the only time you see it cleanly. localStorage here is the
// analogue of the script's ~/.claude/cache/statusline_baseline_global.
const CC_BASE_KEY = 'cc.ctxbase';

function ccBaseLoad() {
  try { return parseInt(localStorage.getItem(CC_BASE_KEY) || '0', 10) || 0; } catch { return 0; }
}

function ccBaseNote(total) {
  if (!total) return;
  if (!ccStatusState.base || total < ccStatusState.base) {
    ccStatusState.base = total;
    try { localStorage.setItem(CC_BASE_KEY, String(total)); } catch { /* private mode */ }
  }
}

/* Title hue, the way the terminal's status line does it: a hash of the title
 * modulo 360, at high saturation and mid lightness, so a conversation keeps its
 * colour and two conversations rarely share one. The shell script hashes with
 * md5 and the browser has no md5 (SubtleCrypto is SHA-only), so this is FNV-1a
 * -- same behaviour, and the exact hue for a given title will not match the
 * terminal's. */
function ccHue(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

function ccCtxWindow(model) {
  return /\[1m\]/i.test(model || '') ? CC_CTX_1M : CC_CTX_DEFAULT;
}

/** `claude-opus-5[1m]` -> `opus-5[1m]`: the part that differs.
 *
 * Empty until the first reply names the model, and an empty string renders no
 * segment at all -- a placeholder reading `claude` on a page that is nothing
 * but Claude said nothing and took a slot. */
function ccModelShort(model) {
  return (model || '').replace(/^claude-/, '');
}

/** 7320000 -> `2h02m`, 540000 -> `9m`. The CLI shows time-to-reset the same way. */
function ccUntil(ms) {
  if (!ms || ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? h + 'h' + String(m).padStart(2, '0') + 'm' : m + 'm';
}

/** The conversation's own opening line, which is what it is "about".
 *
 * Falls through user -> assistant: a conversation that opens with a pasted
 * screenshot and no words has an empty first user message, and titling that
 * `/cc` says nothing when the reply right under it does. */
function ccStatusTitle() {
  for (const sel of ['#terminal .msg.user .msg-body', '#terminal .msg.assistant .msg-body']) {
    const el = document.querySelector(sel);
    const text = el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
    if (text) return text.slice(0, 48);
  }
  return '/cc';
}

function ccStatusRender() {
  const bar = document.getElementById('cc-status');
  if (!bar) return;
  const pct = ccStatusState.ctx
    ? Math.min(100, Math.round((ccStatusState.ctx / ccCtxWindow(ccStatusState.model)) * 100))
    : null;
  const title = ccStatusTitle();
  bar.style.setProperty('--cs-hue', ccHue(title) + 'deg');
  // Row 1 is the conversation's title and nothing else.
  bar.querySelector('.cs-title').textContent = title;

  // Built as spans, not one string: each field carries its own colour, the way
  // the terminal's line does. The model leads row 2 in the title's own hue --
  // it belongs with the metrics, not competing with the title above.
  const meta = bar.querySelector('.cs-meta');
  meta.textContent = '';
  // No path segment: you are standing on /cc, and it never changes.
  const model = ccModelShort(ccStatusState.model);
  if (model) meta.appendChild(ccSeg('cs-model', model));
  if (pct != null) meta.appendChild(ccSeg('cs-ctx', 'ctx:' + pct + '%'));
  if (ccStatusState.base) {
    const basePct = Math.round((ccStatusState.base / ccCtxWindow(ccStatusState.model)) * 100);
    meta.appendChild(ccSeg('cs-base', '(base:' + basePct + '%)'));
  }
  const five = ccStatusState.windows.five_hour;
  if (five && five.pct != null) {
    meta.appendChild(ccSeg('cs-5h', '5h:' + Math.round(five.pct) + '%'));
    const left = five.resetsAt ? ccUntil(five.resetsAt * 1000 - Date.now()) : '';
    if (left) meta.appendChild(ccSeg('cs-reset', '(' + left + ')'));
  }
  const seven = ccStatusState.windows.seven_day || ccStatusState.windows.seven_day_opus;
  if (seven && seven.pct != null) meta.appendChild(ccSeg('cs-7d', '7d:' + Math.round(seven.pct) + '%'));
}

function ccSeg(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

/* The 5h / 7d windows come from /api/cc/limits, not from the stream: the SDK
 * declares a rate_limit_event it never emits, so the sidecar asks the same
 * endpoint the CLI does. Fetched on load and after each reply, and cached a
 * minute server-side -- these move in percent-points per hour. */
async function ccLimitsFetch() {
  try {
    const r = await fetch('/api/cc/limits', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.ok) return;     // logged out or unreachable: show nothing
    if (j.five_hour) ccStatusState.windows.five_hour = j.five_hour;
    if (j.seven_day) ccStatusState.windows.seven_day = j.seven_day;
    if (j.seven_day_opus) ccStatusState.windows.seven_day_opus = j.seven_day_opus;
    ccStatusRender();
  } catch { /* offline: the bar simply omits them */ }
}

/** Every SSE frame passes through here; only three carry status. */
function ccStatusOn(data) {
  if (!data) return;
  if (data.type === 'session' && data.model) ccStatusState.model = data.model;
  else if (data.type === 'done' && data.ctxTokens) {
    ccStatusState.ctx = data.ctxTokens;
    ccBaseNote(data.ctxTokens);
  }
  else if (data.type === 'limits' && data.kind) {
    ccStatusState.windows[data.kind] = { pct: data.pct, resetsAt: data.resetsAt };
  } else return;
  ccStatusRender();
}

/* Publish the bar's real height so #terminal can start exactly below it.
   Measured, not assumed: the meta line wraps at narrow widths and the bit
   webfont re-wraps the title with no resize event firing -- the same reason
   --nav-h and --cal-h are observed rather than hard-coded. */
function ccStatusMeasure() {
  const bar = document.getElementById('cc-status');
  if (!bar) return;
  // OUT of .page-scroll and onto <body>. _render_page wraps a non-full_height
  // page's content in a fixed, scrolling wrapper, and a bar that is meant to
  // outlast every scroll has no business inside the thing being scrolled --
  // reported as having to scroll up to see it.
  if (bar.parentElement !== document.body) document.body.appendChild(bar);
  const set = () => document.documentElement.style.setProperty(
    '--cc-status-h', Math.ceil(bar.getBoundingClientRect().height) + 'px');
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
  window.addEventListener('resize', set);
}

ccStatusState.base = ccBaseLoad();
ccStatusRender();
ccStatusMeasure();
ccLimitsFetch();
// A turn is the only thing that moves these, so refresh when one ends rather
// than on a timer.
document.addEventListener('DOMContentLoaded', () => {
  const term = document.getElementById('terminal');
  if (term) term.addEventListener('cc:reply-done', ccLimitsFetch);
});
// The reset countdown is only true at the moment it is drawn.
setInterval(ccStatusRender, 60000);
