// Noodle header/row toggle rules -- pure, no DOM, unit-tested through node
// (tests/test_noodle_toggle.py).
//
// A group is every IN-WINDOW slot under one weekday column or one week row
// (out-of-window days never count).
//
// The buttons are a MODE, not a reading of the cells: every row/column button
// shows the same tool -- a PENCIL (fill the group in) or an ERASER (clear it)
// -- and the calendar's top-left corner flips all of them between the two.
// What a button does never depends on what its cells currently hold.

var ND_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var ND_WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays',
  'Thursdays', 'Fridays', 'Saturdays'];
var ND_MODES = ['fill', 'clear'];

// What a group button does in this mode.
function ndModeAction(mode) {
  return mode === 'clear' ? 'off' : 'on';
}

function ndFlipMode(mode) {
  return mode === 'clear' ? 'fill' : 'clear';
}

// Returns a NEW Set with every slot of the group switched on or off.
function ndApply(slots, sel, action) {
  var next = new Set(sel);
  for (var i = 0; i < slots.length; i++) {
    if (action === 'on') next.add(slots[i]); else next.delete(slots[i]);
  }
  return next;
}

function ndLabel(subject, mode) {
  return (ndModeAction(mode) === 'on' ? 'Available ' : 'Not available ') + subject;
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
  modeAction: ndModeAction, flipMode: ndFlipMode, apply: ndApply,
  label: ndLabel, colSubject: ndColSubject, rowSubject: ndRowSubject,
  MONTHS: ND_MONTHS, MODES: ND_MODES,
};
if (typeof window !== 'undefined') window.NoodleToggle = NoodleToggle;
