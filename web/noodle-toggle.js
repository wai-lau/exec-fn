// Noodle header/row toggle rules -- pure, no DOM, unit-tested through node
// (tests/test_noodle_toggle.py).
//
// A group is every IN-WINDOW slot (both halves of each day) under one weekday
// column or one week row. Out-of-window days never count: a partly-outside
// week is "all on" when every day it can hold is on.
//
// Click rule: all on -> all off; anything else (partial or empty) -> all on.
// Labels describe the ACTION the click will take:
//   all on  -> "Not available Wednesdays"
//   all off -> "Available Wednesdays"
//   mixed   -> "Available Wednesdays (except)", plus explicit on/off buttons.

var ND_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var ND_WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays',
  'Thursdays', 'Fridays', 'Saturdays'];

// 'on' | 'off' | 'mixed' | 'none' (a group with no in-window slots is inert)
function ndGroupState(slots, sel) {
  if (!slots.length) return 'none';
  var on = 0;
  for (var i = 0; i < slots.length; i++) if (sel.has(slots[i])) on++;
  if (on === slots.length) return 'on';
  return on === 0 ? 'off' : 'mixed';
}

// What a plain click does from this state.
function ndClickAction(state) {
  return state === 'on' ? 'off' : 'on';
}

// Returns a NEW Set with every slot of the group switched on or off.
function ndApply(slots, sel, action) {
  var next = new Set(sel);
  for (var i = 0; i < slots.length; i++) {
    if (action === 'on') next.add(slots[i]); else next.delete(slots[i]);
  }
  return next;
}

function ndLabel(subject, state) {
  if (state === 'none') return '';
  var base = (state === 'on' ? 'Not available ' : 'Available ') + subject;
  return state === 'mixed' ? base + ' (except)' : base;
}

function ndColSubject(dow) {
  return ND_WEEKDAYS[dow];
}

// iso = the week row's first day (its Sunday), even if outside the window
function ndRowSubject(iso) {
  var p = iso.split('-');
  return 'week of ' + ND_MONTHS[Number(p[1]) - 1] + ' ' + Number(p[2]);
}

var NoodleToggle = {
  groupState: ndGroupState, clickAction: ndClickAction, apply: ndApply,
  label: ndLabel, colSubject: ndColSubject, rowSubject: ndRowSubject,
  MONTHS: ND_MONTHS,
};
if (typeof window !== 'undefined') window.NoodleToggle = NoodleToggle;
