/* Shared card color lookup — used by kanban, prophecies, card-dialog.
   The colors themselves live in chrome.css :root (--cat-*-h/-s/-l base
   channels, --card-* size variants, computed once by the browser); this
   file only fetches the right token for a card. */
const CARD_CATS = ['Self', 'Social', 'Interfacing', 'Hobby'];

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
    return {bg: `background:${v('mission')};`, border: `border-color:${v('border-bright')};`, dark: false, solidBg: v('mission')};
  }
}

/* Bar chips (reminders/books bars + overflow rows) — softer fills than
   cards, composed from the same per-category base channels (saturation
   offsets from --cat-*-s, chip-specific lightness). */
// eslint-disable-next-line no-unused-vars
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
// eslint-disable-next-line no-unused-vars
function bookBarColors(c) {
  const cat = _catKey(c);
  const ch = cat
    ? `var(--cat-${cat}-h) var(--cat-${cat}-s) var(--cat-${cat}-l)`
    : 'var(--green-hsl)';
  return {track: `hsl(${ch} / 0.12)`, fill: `hsl(${ch} / 0.45)`};
}
