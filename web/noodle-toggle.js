// Noodle header/row toggle rules -- pure, no DOM, unit-tested through node
// (tests/test_noodle_toggle.py).
//
// A group is every IN-WINDOW slot (both halves of each day) under one weekday
// column or one week row. Out-of-window days never count: a partly-outside
// week is "all on" when every day it can hold is on.
//
// ONE button per group. Click rule: all off -> all on (the button shows a
// check); all on OR mixed -> all off (the button shows a cross).
// Labels describe the ACTION the click will take:
//   all off       -> "Available Wednesdays"
//   on or mixed   -> "Not available Wednesdays"

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

// What the one button does from this state.
function ndClickAction(state) {
  return state === 'off' ? 'on' : 'off';
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
  return (ndClickAction(state) === 'on' ? 'Available ' : 'Not available ') + subject;
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
