/* The Exec panel's status bar -- the second row of Wai's terminal Claude Code
 * status line (~/.claude/statusline-command.sh) less its folder and user, in
 * the same order and colours, UNDER the input bar (Wai, 2026-11-18: "move the
 * statusbar under the input bar and make it show what is showing in the second
 * row of this statusbar (excl folder and user)"). It was the /cc page's until
 * that page folded into the panel, 2026-09-29.
 *
 * Everything here is REPORTED, never estimated: the terminal's own figures, or
 * the subscription's usage endpoint via the sidecar. A status line that guessed
 * would be worse than none.
 *
 * Loaded before exec-bubble.js, same global scope; the stream hands it every
 * SSE frame (execStatusOn) and the panel mounts it (execStatusMount).
 */
'use strict';

const EXEC_SEVEN_DAY_S = 7 * 86400;

// All from /api/cc/limits: the terminal status line's own figures while it is
// writing them, else the sidecar's (routes_cc._term_status). No ctx/base: Wai,
// 2026-11-18, "no need for context and base".
const execStatusState = { windows: {}, credits: null, alts: null, snoozeUntil: 0 };

// The windows are cached: a freshly opened page had an empty bar until the
// first fetch landed, which reads as broken rather than as waiting. The cache is a first paint, replaced by live
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
    // is dropped whole rather than shown.
    if (!raw.at || Date.now() - raw.at > EXEC_CACHE_TTL_MS) return;
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
      windows: execStatusState.windows,
    }));
  } catch { /* private mode: the bar just does not survive a reload */ }
}

/* A conversation's hue (the /list rows, exec-sessions.js), the way the terminal's status line colours a title: a hash of the title
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

/** 7320000 -> `2h02m`, 540000 -> `9m`. The CLI shows time-to-reset the same way. */
function execUntil(ms) {
  if (!ms || ms <= 0) return '';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? h + 'h' + String(m).padStart(2, '0') + 'm' : m + 'm';
}

/* The conversation's generated title is NOT shown in the panel (Wai, 2026-09-30:
 * the band was dropped). It is still asked for after each reply, because the
 * request is what generates and caches it server-side (cc_title.py), and /list
 * names conversations by that cache -- without it a row would fall back to the
 * SDK's summary, which is the <exec-context> board block the turn opened with. */
async function execTitleRefresh() {
  try { await fetch('/api/cc/title', { cache: 'no-store' }); } catch { /* /list keeps its last name */ }
}

/** The 7d pace cap, the terminal's formula (hooks/pace-cap.py): whole days
 *  into the 7d window x 95/7 -- the last 5% is a snooze-only reserve. */
function execPaceCap(resetsAt) {
  if (!resetsAt) return null;
  const into = Math.max(0, Date.now() / 1000 - (resetsAt - EXEC_SEVEN_DAY_S));
  return Math.round(Math.max(1, Math.ceil(into / 86400)) * 95 / 7);
}

/** Minutes left on the snooze, rounded up, the terminal's way: `45m`, `1h05m`. */
function execSnoozeLeft(until) {
  const mins = Math.ceil((until * 1000 - Date.now()) / 60000);
  if (mins <= 0) return '';
  return mins >= 60 ? Math.floor(mins / 60) + 'h' + String(mins % 60).padStart(2, '0') + 'm' : mins + 'm';
}

function execText(cls, text, boldPart) {
  const el = document.createElement('span');
  el.className = cls;
  el.append(text);
  if (boldPart != null) {
    const b = document.createElement('b');
    b.textContent = boldPart;
    el.append(b);
  }
  return el;
}

function execPill(cls, text) {
  const el = document.createElement('span');
  el.className = 'cs-pill ' + cls;
  el.textContent = text;
  return el;
}

/* Same items, order and colours as the terminal's row 2: 7d used/pace cap,
 * the snooze, 5h and its reset, credits (only while a window is at 100%, i.e.
 * while they are being spent), other sessions. A value the
 * page has no number for is left out, as the terminal leaves it out. */
function execStatusRender() {
  const bar = document.getElementById('exec-status');
  if (!bar) return;
  const row = bar.querySelector('.cs-meta');
  row.textContent = '';
  // Each field with its pill is one group; the groups spread evenly across
  // the row (Wai, 2026-11-18: "space out the text equally").
  let grp = null;
  const group = () => { grp = row.appendChild(document.createElement('span')); grp.className = 'cs-grp'; };
  const add = (el) => grp.appendChild(el);
  group();
  const five = execStatusState.windows.five_hour;
  const seven = execStatusState.windows.seven_day || execStatusState.windows.seven_day_opus;

  if (seven && seven.pct != null) {
    const cap = execPaceCap(seven.resetsAt);
    const sd = execText('cs-7d', '7d:', String(Math.round(seven.pct)));
    sd.append((cap != null ? '/' + cap : '') + '%');
    add(sd);
  }
  const snz = execStatusState.snoozeUntil ? execSnoozeLeft(execStatusState.snoozeUntil) : '';
  if (snz) add(execPill('cs-snooze', snz));
  group();
  if (five && five.pct != null) add(execText('cs-5h', '5h:' + Math.round(five.pct) + '%'));
  if (five && five.resetsAt) {
    const left = execUntil(five.resetsAt * 1000 - Date.now());
    if (left) add(execPill('cs-reset', left));
  }
  group();
  const maxed = [five, seven].some((w) => w && w.pct >= 100);
  if (maxed && execStatusState.credits) add(execPill('cs-credits', 'c:$' + execStatusState.credits));
  group();
  if (execStatusState.alts > 0) add(execText('cs-alts', 'alts:', String(execStatusState.alts)));
  row.querySelectorAll('.cs-grp:empty').forEach((g) => g.remove());
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
    if (!j) return;
    // The host's figures arrive even when the sidecar has no numbers.
    execStatusState.alts = typeof j.alts === 'number' ? j.alts : null;
    execStatusState.snoozeUntil = j.snoozeUntil || 0;
    if (j.ok) {
      if (j.five_hour) execStatusState.windows.five_hour = j.five_hour;
      if (j.seven_day) execStatusState.windows.seven_day = j.seven_day;
      if (j.seven_day_opus) execStatusState.windows.seven_day_opus = j.seven_day_opus;
      execStatusState.credits = j.credits || null;
    }
    execStateSave();
    execStatusRender();
  } catch { /* offline: the bar simply omits them */ }
}

/** Every SSE frame passes through here; only `limits` carries status. */
function execStatusOn(data) {
  if (data && data.type === 'limits' && data.kind) {
    execStatusState.windows[data.kind] = { pct: data.pct, resetsAt: data.resetsAt };
  } else return;
  execStateSave();
  execStatusRender();
}

/** Build the bar at the bottom of the panel, under the input bar, and start
 *  it. Called by exec-bubble.js once the panel exists; everything above is
 *  inert until then. In the panel's own flow, not fixed: the panel is the
 *  thing that scrolls in and out, and the bar goes with it. */
function execStatusMount(panel) {
  const bar = document.createElement('div');
  bar.id = 'exec-status';
  bar.innerHTML = '<span class="cs-meta"></span>';
  panel.appendChild(bar);
  execStateLoad();
  execStatusRender();
  execLimitsFetch();
  // A turn moves the windows, so refresh when one ends as well as on the timer.
  execTermEl.addEventListener('exec:reply-done', execLimitsFetch);
  execTermEl.addEventListener('exec:reply-done', execTitleRefresh);
  // The reset and snooze countdowns are only true at the moment they are drawn,
  // and alts/snooze move without a turn: refetch (server-cached a minute) too.
  setInterval(() => { execStatusRender(); execLimitsFetch(); }, 60000);
}
