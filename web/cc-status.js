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

const ccStatusState = { model: '', ctx: 0, windows: {} };

function ccCtxWindow(model) {
  return /\[1m\]/i.test(model || '') ? CC_CTX_1M : CC_CTX_DEFAULT;
}

/** `claude-opus-5[1m]` -> `opus-5[1m]`: the part that differs. */
function ccModelShort(model) {
  return (model || '').replace(/^claude-/, '') || 'claude';
}

/** 7320000 -> `2h02m`, 540000 -> `9m`. The CLI shows time-to-reset the same way. */
function ccUntil(ms) {
  if (!ms || ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? h + 'h' + String(m).padStart(2, '0') + 'm' : m + 'm';
}

function ccWindowText(key, label) {
  const w = ccStatusState.windows[key];
  if (!w || w.pct == null) return '';
  const left = w.resetsAt ? ccUntil(w.resetsAt * 1000 - Date.now()) : '';
  return label + ':' + Math.round(w.pct) + '%' + (left ? ' (' + left + ')' : '');
}

/** The conversation's own opening line, which is what it is "about". */
function ccStatusTitle() {
  const first = document.querySelector('#terminal .msg.user .msg-body');
  const text = first ? first.textContent.trim() : '';
  return text ? text.slice(0, 44) : '/cc';
}

function ccStatusRender() {
  const bar = document.getElementById('cc-status');
  if (!bar) return;
  const pct = ccStatusState.ctx
    ? Math.min(100, Math.round((ccStatusState.ctx / ccCtxWindow(ccStatusState.model)) * 100))
    : null;
  const bits = ['wai-root', '/cc'];
  if (pct != null) bits.push('ctx:' + pct + '%');
  const five = ccWindowText('five_hour', '5h');
  const seven = ccWindowText('seven_day', '7d') || ccWindowText('seven_day_opus', '7d');
  if (five) bits.push(five);
  if (seven) bits.push(seven);

  bar.querySelector('.cs-title').textContent = ccStatusTitle();
  bar.querySelector('.cs-model').textContent = ccModelShort(ccStatusState.model);
  bar.querySelector('.cs-meta').textContent = bits.join('  ');
}

/** Every SSE frame passes through here; only three carry status. */
function ccStatusOn(data) {
  if (!data) return;
  if (data.type === 'session' && data.model) ccStatusState.model = data.model;
  else if (data.type === 'done' && data.ctxTokens) ccStatusState.ctx = data.ctxTokens;
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
  const set = () => document.documentElement.style.setProperty(
    '--cc-status-h', Math.ceil(bar.getBoundingClientRect().height) + 'px');
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
  window.addEventListener('resize', set);
}

ccStatusRender();
ccStatusMeasure();
// The reset countdown is only true at the moment it is drawn.
setInterval(ccStatusRender, 60000);
