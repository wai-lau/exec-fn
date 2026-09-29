/* The Exec panel's status bar -- the same numbers the Claude Code status line
 * shows in a terminal, in the same shape, at the top of the panel. (It was the
 * /cc page's until that page folded into the panel, 2026-09-29.)
 *
 * Everything here is REPORTED by the sidecar, never estimated: the model comes
 * from the SDK's init frame, the context size from the input side of the last
 * result (prompt + cache reads), and the 5h / 7d windows from the subscription's
 * usage endpoint. A status line that guessed would be worse than none.
 *
 * Loaded before exec-bubble.js, same global scope; the stream hands it every
 * SSE frame (execStatusOn) and the panel mounts it (execStatusMount).
 */
'use strict';

// Claude's context window, by model id. [1m] is the million-token variant; the
// rest sit at 200K. Wrong only if a model ships with a new window and this is
// not updated -- at which point the percentage is off, not the page.
const CC_CTX_1M = 1000000;
const EXEC_CTX_DEFAULT = 200000;
// The subscription's short window, used to turn "1h20m left" into a gauge.
const EXEC_FIVE_HOUR_MS = 5 * 60 * 60 * 1000;

const execStatusState = { model: '', ctx: 0, base: 0, windows: {}, title: '' };

// The statusline script's definition, mirrored: `base` is the SMALLEST total
// input ever observed -- system prompt + tools + standing context, the floor a
// conversation can never go below -- and it persists, because the first turn
// after a /new is the only time you see it cleanly. localStorage here is the
// analogue of the script's ~/.claude/cache/statusline_baseline_global.
const EXEC_BASE_KEY = 'exec.ctxbase';
// EVERY slot is cached, not just base. The model arrives with the first reply,
// the windows with the first fetch and the context with the first result -- so
// a freshly opened page had an empty bar until it was spoken to, which reads as
// broken rather than as waiting. The cache is a first paint, replaced by live
// numbers the moment any of them land.
const EXEC_STATE_KEY = 'exec.status';
// How long a cached paint is worth showing before the page would rather show
// nothing. Long enough to cover a night, short enough that a figure from a
// different week never appears.
const EXEC_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function execStateLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(EXEC_STATE_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return;
    // A cached number is a first paint, not a fact. Anything older than the TTL
    // is dropped whole rather than shown: a context figure from yesterday's
    // conversation is not "slightly stale", it is about something else.
    if (!raw.at || Date.now() - raw.at > EXEC_CACHE_TTL_MS) return;
    execStatusState.model = raw.model || '';
    execStatusState.ctx = raw.ctx || 0;
    execStatusState.title = raw.title || '';
    const wins = raw.windows && typeof raw.windows === 'object' ? raw.windows : {};
    // A window whose reset has already passed has rolled over; its utilization
    // describes a period that is finished, so it goes rather than misinforms.
    const now = Date.now() / 1000;
    for (const [k, w] of Object.entries(wins)) {
      if (w && (!w.resetsAt || w.resetsAt > now)) execStatusState.windows[k] = w;
    }
  } catch { /* unreadable or private mode: start empty */ }
}

function execStateSave() {
  try {
    localStorage.setItem(EXEC_STATE_KEY, JSON.stringify({
      at: Date.now(),
      model: execStatusState.model,
      ctx: execStatusState.ctx,
      title: execStatusState.title,
      windows: execStatusState.windows,
    }));
  } catch { /* private mode: the bar just does not survive a reload */ }
}

function execBaseLoad() {
  try { return parseInt(localStorage.getItem(EXEC_BASE_KEY) || '0', 10) || 0; } catch { return 0; }
}

function execBaseNote(total) {
  if (!total) return;
  if (!execStatusState.base || total < execStatusState.base) {
    execStatusState.base = total;
    try { localStorage.setItem(EXEC_BASE_KEY, String(total)); } catch { /* private mode */ }
  }
}

/* Title hue, the way the terminal's status line does it: a hash of the title
 * modulo 360, at high saturation and mid lightness, so a conversation keeps its
 * colour and two conversations rarely share one. The shell script hashes with
 * md5 and the browser has no md5 (SubtleCrypto is SHA-only), so this is FNV-1a
 * -- same behaviour, and the exact hue for a given title will not match the
 * terminal's. */
function execHue(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

function execCtxWindow(model) {
  return /\[1m\]/i.test(model || '') ? CC_CTX_1M : EXEC_CTX_DEFAULT;
}

/** 7320000 -> `2h02m`, 540000 -> `9m`. The CLI shows time-to-reset the same way. */
function execUntil(ms) {
  if (!ms || ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? h + 'h' + String(m).padStart(2, '0') + 'm' : m + 'm';
}

/* The conversation's GENERATED title -- what the CLI's own status line shows.
 * The SDK writes a summary per session and honours a rename, so a conversation
 * is called "Crisis fragments endgame" rather than "poe2, what are crisis
 * fragments for? I'm like deep into e…". Absent on a brand-new conversation,
 * which is what the transcript fallback below is for. */
async function execTitleFetch() {
  try {
    const r = await fetch('/api/cc/title', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.title && j.title !== execStatusState.title) {
      execStatusState.title = j.title;
      execStateSave();
      execStatusRender();
    }
  } catch { /* offline: the opening line still titles it */ }
}

/** The conversation's own opening line, which is what it is "about".
 *
 * Falls through user -> assistant: a conversation that opens with a pasted
 * screenshot and no words has an empty first user message, and titling that
 * nothing says nothing when the reply right under it does. */
function execStatusTitle() {
  if (execStatusState.title) return execStatusState.title.slice(0, 48);
  for (const sel of ['#exec-term .msg.user .msg-body', '#exec-term .msg.assistant .msg-body']) {
    const el = document.querySelector(sel);
    const text = el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
    if (text) return text.slice(0, 48);
  }
  return '';   // nothing said yet -- no title, rather than a stand-in
}

function execStatusRender() {
  const bar = document.getElementById('exec-status');
  if (!bar) return;
  const title = execStatusTitle();
  bar.style.setProperty('--cs-hue', execHue(title) + 'deg');
  // Row 1 is the conversation's title and nothing else -- and with no title
  // there is no row: a full-width band of colour saying nothing is louder than
  // anything else on the page. It comes back the moment the conversation has a
  // first line.
  const el = bar.querySelector('.cs-title');
  el.textContent = title;
  el.hidden = !title;

  // Built as spans, not one string: each field carries its own colour, the way
  // the terminal's line does. The model leads row 2 in the title's own hue --
  // it belongs with the metrics, not competing with the title above.
  const meta = bar.querySelector('.cs-meta');
  meta.textContent = '';
  // FIVE boxes, always all five, in the same order every time: ctx, base, 5h,
  // its reset, 7d. A slot that renders only once it has a value makes the row
  // jump as numbers arrive, and an absent ctx reads as broken rather than as
  // "no reply yet" -- so a missing value is 0, not a missing box. The model and
  // the path are not among them: the model is still tracked (it decides which
  // context window ctx% is measured against) but naming it in Exec's own
  // panel says nothing.
  const win = execCtxWindow(execStatusState.model);
  const five = execStatusState.windows.five_hour || {};
  const seven = execStatusState.windows.seven_day || execStatusState.windows.seven_day_opus || {};
  const pctOf = (n) => (n ? Math.min(100, Math.round((n / win) * 100)) : 0);

  // Each box also carries its own little gauge (execSeg's third argument): a bar
  // is read at a glance where a two-digit number has to be read. The reset box
  // gauges the window it counts down -- how much of the 5h has BURNED, so all
  // five bars mean the same thing (more filled = less left) instead of one of
  // them running backwards.
  meta.appendChild(execSeg('cs-ctx', 'ctx:' + pctOf(execStatusState.ctx) + '%', pctOf(execStatusState.ctx)));
  meta.appendChild(execSeg('cs-base', '(base:' + pctOf(execStatusState.base) + '%)', pctOf(execStatusState.base)));
  meta.appendChild(execSeg('cs-5h', '5h:' + Math.round(five.pct || 0) + '%', five.pct || 0));
  const left = five.resetsAt ? five.resetsAt * 1000 - Date.now() : 0;
  meta.appendChild(execSeg('cs-reset', '(' + (five.resetsAt ? execUntil(left) || '0m' : '0m') + ')', execBurned(left)));
  meta.appendChild(execSeg('cs-7d', '7d:' + Math.round(seven.pct || 0) + '%', seven.pct || 0));
}

/** How much of the 5h window is gone, as a percentage, from the time left on
 *  it. No reset time means nothing is known, which reads as an empty bar rather
 *  than a full one -- an unknown must never look like an alarm. */
function execBurned(msLeft) {
  if (!msLeft || msLeft <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - (msLeft / EXEC_FIVE_HOUR_MS) * 100)));
}

function execSeg(cls, text, pct) {
  const el = document.createElement('span');
  el.className = cls;
  el.appendChild(document.createTextNode(text));
  // ONE fill on a capacity track, not a row of marks: a pill that extends is
  // read as a level, where ten separate ones are read by counting. A zero gets
  // no fill element at all -- min-width would otherwise floor it at a visible
  // pill and empty would look like a little.
  const bar = document.createElement('b');
  bar.className = 'cs-bar';
  const p = Math.max(0, Math.min(100, pct || 0));
  if (p > 0) {
    const fill = document.createElement('i');
    fill.style.setProperty('--cs-pct', Math.round(p));
    bar.appendChild(fill);
  }
  el.appendChild(bar);
  return el;
}

/* The 5h / 7d windows come from /api/cc/limits, not from the stream: the SDK
 * declares a rate_limit_event it never emits, so the sidecar asks the same
 * endpoint the CLI does. Fetched on load and after each reply, and cached a
 * minute server-side -- these move in percent-points per hour. */
async function execLimitsFetch() {
  try {
    const r = await fetch('/api/cc/limits', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.ok) return;     // logged out or unreachable: show nothing
    if (j.five_hour) execStatusState.windows.five_hour = j.five_hour;
    if (j.seven_day) execStatusState.windows.seven_day = j.seven_day;
    if (j.seven_day_opus) execStatusState.windows.seven_day_opus = j.seven_day_opus;
    execStateSave();
    execStatusRender();
  } catch { /* offline: the bar simply omits them */ }
}

/** Every SSE frame passes through here; only three carry status. */
function execStatusOn(data) {
  if (!data) return;
  if (data.type === 'session' && data.model) execStatusState.model = data.model;
  else if (data.type === 'done' && data.ctxTokens) {
    execStatusState.ctx = data.ctxTokens;
    execBaseNote(data.ctxTokens);
  }
  else if (data.type === 'limits' && data.kind) {
    execStatusState.windows[data.kind] = { pct: data.pct, resetsAt: data.resetsAt };
  } else return;
  execStateSave();
  execStatusRender();
}

/* The title comes from the transcript, which arrives asynchronously: the bar
 * renders long before the history has replayed a single line, so a one-shot
 * render titles every conversation empty. Watch until there is something to
 * read, then stop. */
function execStatusWatchTitle() {
  if (!execTermEl || !window.MutationObserver) return;
  const obs = new MutationObserver(() => {
    execStatusRender();
    if (execStatusTitle()) obs.disconnect();
  });
  obs.observe(execTermEl, { childList: true, subtree: true });
}

/** Build the bar at the top of the panel and start it. Called by
 *  exec-bubble.js once the panel exists; everything above is inert until then.
 *  In the panel's own flow, not fixed: the panel is the thing that scrolls in
 *  and out, and the bar goes with it. */
function execStatusMount(panel) {
  const bar = document.createElement('div');
  bar.id = 'exec-status';
  bar.innerHTML = '<span class="cs-meta"></span><span class="cs-title"></span>';
  panel.insertBefore(bar, panel.firstChild);
  execStateLoad();
  execStatusState.base = execBaseLoad();
  execStatusRender();
  execStatusWatchTitle();
  execLimitsFetch();
  execTitleFetch();
  // A turn is the only thing that moves these, so refresh when one ends rather
  // than on a timer.
  execTermEl.addEventListener('exec:reply-done', execLimitsFetch);
  execTermEl.addEventListener('exec:reply-done', execTitleFetch);
  // A cleared conversation is back at the floor. base and the windows survive
  // (they are account-wide, not conversation-wide); the context does not.
  execTermEl.addEventListener('exec:conversation-new', () => {
    execStatusState.ctx = 0;
    execStatusState.title = '';
    execStateSave();
    execStatusRender();
  });
  // The reset countdown is only true at the moment it is drawn.
  setInterval(execStatusRender, 60000);
}
