// Noodle's calendar: ONE continuous grid of weeks, scrolling vertically.
//
// 8 columns: a sticky week-toggle column, then Sun..Sat (Sunday first, like
// /rd's month calendar). The weekday header is sticky at the top. Each day
// cell holds only its number and the other voters' dots; its BACKGROUND is
// split by a 30deg "/" through the centre -- top-left half is midday,
// bottom-right half is night -- and a tap is hit-tested against that same
// line (ndHalf), so the half you see is the half you get.
//
// The grid spans only the weeks the window touches -- no padding rows; the
// days of those weeks that fall outside the window are drawn greyed and inert. Month boundaries are a bright stepped line
// made of per-cell right/bottom rules (.mr/.mb), following the real edge.
//
// Dots: every voter -- you included -- owns ONE fixed column of dots, the same
// position in every cell (by vote order): top dot midday, bottom dot night,
// no dot where not free. So one person reads as one vertical line
// of dots all the way down the grid.

var ND_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var ND_TAN30 = Math.tan(Math.PI / 6);
var ND_DOT = 4, ND_DOT_GAP = 2; // px; mirrors .nd-dots in noodle-cal.css (4px, --space-0-5)

function ndIso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function ndDate(iso) {
  var p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12); // noon: DST-proof
}

// Which half of a cell a point lands in. The dividing line runs through the
// centre at 30deg to the horizontal, rising left-to-right: a point is in the
// top (midday) half when it is above that line.
function ndHalf(x, y, w, h) {
  var dx = x - w / 2, dy = y - h / 2;
  return dy < -dx * ND_TAN30 ? 'm' : 'n';
}

// The MINIMUM weeks: Sunday of the week holding the first day, through
// Saturday of the week holding the last. Days of those weeks outside the
// window are drawn greyed; no whole-month padding rows.
function ndWeeks(start, end) {
  var first = ndDate(start), last = ndDate(end);
  first.setDate(first.getDate() - first.getDay());
  last.setDate(last.getDate() + (6 - last.getDay()));
  var weeks = [], d = new Date(first);
  while (d <= last) {
    var wk = [];
    for (var i = 0; i < 7; i++) { wk.push(ndIso(d)); d.setDate(d.getDate() + 1); }
    weeks.push(wk);
  }
  return weeks;
}

function ndGridHtml(weeks, start, end) {
  var today = ndIso(new Date());
  var h = '<div class="nd-hd nd-corner"></div>';
  ND_DOW.forEach(function (n, c) {
    h += '<div class="nd-hd" data-col="' + c + '">' +
      '<span class="nd-hd-name">' + n + '</span><button type="button" class="nd-tg"></button></div>';
  });
  weeks.forEach(function (wk, r) {
    h += '<div class="nd-wk" data-row="' + r + '" data-month="' + wk[3].slice(5, 7) + '">' +
      '<button type="button" class="nd-tg"></button></div>';
    wk.forEach(function (iso, c) {
      var mo = iso.slice(5, 7), cls = ['nd-d'];
      if (iso < start || iso > end) cls.push('out');
      if (c === 0 || c === 6) cls.push('we');
      if (c === 6) cls.push('eow');
      if (iso === today) cls.push('today');
      if (weeks[r + 1] && weeks[r + 1][c].slice(5, 7) !== mo) cls.push('mb');
      if (c < 6 && wk[c + 1].slice(5, 7) !== mo) cls.push('mr');
      h += '<div class="' + cls.join(' ') + '" data-day="' + iso + '">' +
        '<span class="nd-n">' + iso.slice(8) + '</span><div class="nd-dots"></div></div>';
    });
  });
  return h;
}

// Slot groups for the toggles: in-window slots only.
function ndGroups(weeks, start, end) {
  var cols = [[], [], [], [], [], [], []], rows = [];
  weeks.forEach(function (wk) {
    var row = [];
    wk.forEach(function (iso, c) {
      if (iso < start || iso > end) return;
      [iso + ':m', iso + ':n'].forEach(function (s) { cols[c].push(s); row.push(s); });
    });
    rows.push(row);
  });
  return { cols: cols, rows: rows };
}

// How many dot columns fit a cell; one is given up to the overflow ring.
function ndDotsFit(cell, count) {
  var w = cell ? cell.clientWidth - 2 * ND_DOT_GAP : 0;
  var fit = Math.max(1, Math.floor((w + ND_DOT_GAP) / (ND_DOT + ND_DOT_GAP)));
  return count > fit ? { shown: fit - 1, more: true } : { shown: count, more: false };
}

// A dot in the voter's seal ink where they are free that half, a GAP where not
// -- the gap keeps the column's position, so a column reads as one person all
// the way down. A `self` column shows the live selection `sel` rather than a
// stored vote, so your own dots follow your taps.
function ndDotsHtml(iso, cols, fit, sel) {
  var h = '', shown = cols.slice(0, fit.shown);
  // when columns overflow, YOUR column is never the one cut: it takes the
  // last visible place, the rest stay in vote order
  var mine = cols.find(function (c) { return c.self; });
  if (fit.more && mine && shown.indexOf(mine) < 0 && shown.length) shown[shown.length - 1] = mine;
  for (var i = 0; i < shown.length; i++) {
    var c = shown[i], s = c.self ? sel : c.slots;
    var lit = ' class="on"' + (c.ink ? ' style="--seal-hsl:' + c.ink + '"' : '');
    h += '<i' + (s.has(iso + ':m') ? lit : '') + '></i>' +
      '<i' + (s.has(iso + ':n') ? lit : '') + '></i>';
  }
  return fit.more ? h + '<b class="nd-more"></b>' : h;
}

if (typeof window !== 'undefined') {
  window.NoodleCalParts = { iso: ndIso, date: ndDate, half: ndHalf, weeks: ndWeeks,
    gridHtml: ndGridHtml, groups: ndGroups,
    dotsFit: ndDotsFit, dotsHtml: ndDotsHtml };
}
