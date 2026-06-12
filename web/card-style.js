/* Shared card color lookup — used by kanban, prophecies, card-dialog.
   The colors themselves live in chrome.css :root (--cat-* hue knobs,
   --card-* size variants, computed once by the browser); this file only
   fetches the right token for a card. */
const CARD_CATS = ['Self', 'Social', 'Interfacing', 'Hobby'];

function _catKey(c) {
  return CARD_CATS.includes(c.category) ? c.category.toLowerCase() : null;
}

function cardStyle(c) {
  const cat = _catKey(c);
  if (!cat) return {bg: '', border: '', dark: false, solidBg: ''};
  const v = name => `var(--card-${cat}-${name})`;
  const text = `color:${v('text')};`;
  if (c.size === 'chore') {
    return {bg: `background:${v('chore')};${text}`, border: 'border-color:transparent;', dark: true, solidBg: v('chore-solid')};
  } else if (c.size === 'task') {
    return {bg: `background:${v('task')};${text}`, border: `border-color:${v('border')};`, dark: true, solidBg: v('task-solid')};
  } else if (c.size === 'book') {
    return {bg: `background:hsl(0 0% 10%);${text}`, border: `border-color:${v('border')};`, dark: true, solidBg: 'hsl(0 0% 10%)'};
  } else if (c.size === 'project') {
    return {bg: `background:${v('project')};`, border: 'border-color:transparent;', dark: false, solidBg: v('project')};
  } else {
    return {bg: `background:${v('titan')};`, border: `border-color:${v('border-bright')};`, dark: false, solidBg: v('titan')};
  }
}

/* Bar chips (reminders/books bars + overflow rows) — softer fills than
   cards, composed from the same per-category hue knobs. */
// eslint-disable-next-line no-unused-vars
function chipStyle(c) {
  const cat = _catKey(c);
  if (!cat) {
    return {
      color: 'hsl(var(--green-hsl) / 1)',
      bg: 'hsl(var(--green-hsl) / 0.06)',
      border: 'hsl(var(--green-hsl) / 0.25)',
    };
  }
  const f = (s, l) => `hsl(var(--cat-${cat}-h) calc(${s}% + var(--cat-${cat}-ds)) ${l}%)`;
  return {color: f(75, 72), bg: f(55, 18), border: f(50, 32)};
}
