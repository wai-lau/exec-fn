/* Shared card color lookup — used by rd, hq, card-dialog.
   The colors themselves live in chrome.css :root (--cat-*-h/-s/-l base
   channels, --card-* size variants, computed once by the browser); this
   file only fetches the right token for a card. */
const CARD_CATS = ['Self', 'Social', 'Interfacing', 'Hobby'];

// Parse a duration string to whole minutes (no LLM). Accepts a bare number
// (minutes) or h/m units: "90"->90, "10m"->10, "2h"->120, "1h30m"->90,
// "1.5h"->90, "30min"->30. Returns null if unparseable. Shared by the card
// dialog (prep/event) and the breakdown graph (per-step estimate).
function parseDuration(s) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (!m || (m[1] == null && m[2] == null)) return null;
  const h = m[1] != null ? parseFloat(m[1]) : 0;
  const min = m[2] != null ? parseInt(m[2], 10) : 0;
  return Math.round(h * 60 + min);
}

// Format whole minutes to a compact single-unit string for the card dialog
// boxes: whole hours -> "Nh" (360 -> "6h"), otherwise "Nm" (35 -> "35m").
// 0 / null -> "" (empty box). Inverse of parseDuration for the values it emits.
function fmtDuration(min) {
  if (!min) return '';
  return min % 60 === 0 ? (min / 60) + 'h' : min + 'm';
}

function _catKey(c) {
  return CARD_CATS.includes(c.category) ? c.category.toLowerCase() : null;
}

function cardStyle(c) {
  const cat = _catKey(c);
  if (!cat) return {bg: '', border: '', dark: false, solidBg: ''};
  const v = name => `var(--card-${cat}-${name})`;
  const text = `color:${v('text')};`;
  // books take their category/size tint like any card (no longer a dark slab)
  //
  // A REMINDER is always wisp, whatever its size says. It is a calendar alert,
  // not work -- the lightest weight on the board is the honest one. It also
  // fixes reminders imported from gcal with size:null, which fell past every
  // branch below to the `else` and rendered as full COMMITMENT cards: the
  // loudest thing on /hq, for a card that is only a note that a day exists.
  if (c.is_reminder || c.size === 'wisp') {
    return {bg: `background:${v('wisp')};${text}`, border: 'border-color:transparent;', dark: true, solidBg: v('wisp-solid')};
  } else if (c.size === 'idea') {
    return {bg: `background:${v('idea')};${text}`, border: `border-color:${v('border')};`, dark: true, solidBg: v('idea-solid')};
  } else if (c.size === 'plan') {
    return {bg: `background:${v('plan')};`, border: 'border-color:transparent;', dark: false, solidBg: v('plan')};
  } else {
    return {bg: `background:${v('commitment')};`, border: `border-color:${v('border-bright')};`, dark: false, solidBg: v('commitment')};
  }
}

/* Bar chips (reminders/books bars + overflow rows) — softer fills than
   cards, composed from the same per-category base channels (saturation
   offsets from --cat-*-s, chip-specific lightness). */
function chipStyle(c) {
  const cat = _catKey(c);
  if (!cat) {
    return {
      color: 'hsl(var(--green-hsl) / 1)',
      bg: 'hsl(var(--green-hsl) / 0.12)',
      border: 'hsl(var(--green-hsl) / 0.12)',
    };
  }
  const f = (sOff, l) => `hsl(var(--cat-${cat}-h) calc(var(--cat-${cat}-s) + ${sOff}%) ${l}%)`;
  return {color: f(0, 72), bg: f(-20, 18), border: f(-25, 32)};
}

/* Calendar dot colour — the pure category hue at full opacity (same token the
   card title text uses), green for an uncategorized card. */
/* Two of the four category hues are adjacent warms -- Marigold 33 and Coral 8,
   both at L 68% -- which a card can carry (it has a title, a column, a size) but
   a dot cannot: a wisp is ~4px of pure hue under the phosphor wash, with nothing
   else to read it by. So the dot palette pulls Hobby off Coral and onto Ember
   and separates the pair by VALUE as well as hue: bright Marigold at full alpha
   against deep Ember (L 50%) at 0.8. Both pairs are already in the palette
   baseline, so this adds no colour to the system.

   Dots only -- the cards keep their Coral. */
const _DOT_COLOR = {
  interfacing: 'hsl(var(--orange-hsl) / 1)',
  hobby: 'hsl(var(--orange-glow-hsl) / 0.8)',
};
function dotColor(c) {
  const cat = _catKey(c);
  if (!cat) return 'hsl(var(--green-hsl) / 1)';
  return _DOT_COLOR[cat] || `var(--card-${cat}-text)`;
}

/* Calendar dot LENGTH, in circle-widths: the card's DURATION (estimated_time,
   total minutes), in four named steps (Wai, 2026-11-21: "just have 4 steps of
   sizes: task, process, project, titan"):
     task    under 15 min   1
     process 15 min - 1h    2
     project over 1h        3
     titan   over 5h        4
   No estimate counts as a task. A reminder stays one circle whatever its
   estimate: it is a note that a day exists, not work. Importance moved to the
   dot's brightness (dotImportance). */
function dotUnits(c) {
  if (c.is_reminder) return 1;
  const m = Number(c.estimated_time) || 0;
  if (m > 300) return 4;
  if (m > 60) return 3;
  if (m >= 15) return 2;
  return 1;
}

/* Calendar dot BRIGHTNESS: the card's importance (`size`), drawn as the pill's
   opacity in rd.css (.cal-dots i[data-imp]) -- the more important, the brighter.
   Unknown size -> idea (the schema default); a reminder is always wisp, the
   same override cardStyle applies. */
const _DOT_IMPORTANCE = ['wisp', 'idea', 'plan', 'commitment'];
function dotImportance(c) {
  if (c.is_reminder) return 'wisp';
  return _DOT_IMPORTANCE.includes(c.size) ? c.size : 'idea';
}

/* Book progress-bar colors — category hue at the standard track/fill alphas
   (green for an uncategorized book). */
function bookBarColors(c) {
  const cat = _catKey(c);
  const ch = cat
    ? `var(--cat-${cat}-h) var(--cat-${cat}-s) var(--cat-${cat}-l)`
    : 'var(--green-hsl)';
  return {track: `hsl(${ch} / 0.12)`, fill: `hsl(${ch} / 0.45)`};
}
