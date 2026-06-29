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
  if (c.size === 'wisp') {
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

/* Book progress-bar colors — category hue at the standard track/fill alphas
   (green for an uncategorized book). */
function bookBarColors(c) {
  const cat = _catKey(c);
  const ch = cat
    ? `var(--cat-${cat}-h) var(--cat-${cat}-s) var(--cat-${cat}-l)`
    : 'var(--green-hsl)';
  return {track: `hsl(${ch} / 0.12)`, fill: `hsl(${ch} / 0.45)`};
}
