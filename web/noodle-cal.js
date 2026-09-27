// Noodle's calendar: ONE continuous grid of weeks, scrolling vertically.
//
// 8 columns: a sticky week-toggle column, then Sun..Sat (Sunday first, like
// /rd's month calendar). The weekday header is sticky at the top. Each day
// cell holds only its number and the other voters' dots; its BACKGROUND is
// split by a 30deg "/" through the centre -- top-left half is midday,
// bottom-right half is night -- and a tap is hit-tested against that same
// line (ndHalf), so the half you see is the half you get.
//
// The grid is endless (weeks load as it scrolls) unless the voter has CROPPED
// it to a span; past days and days outside the crop are greyed and inert.
// Month boundaries are one stepped SVG path each (noodle-cal-view.js).
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

// The calendar is ENDLESS: weeks are generated from a starting Sunday and more
// are appended as the grid scrolls (noodle-cal-view.js). A row knows its own
// month edges without its neighbour being rendered -- the day below is just
// seven days on -- so an appended row needs no fix-up of the one above it.
function ndAddDays(iso, n) {
  var d = ndDate(iso);
  d.setDate(d.getDate() + n);
  return ndIso(d);
}

function ndSunday(iso) {
  return ndAddDays(iso, -ndDate(iso).getDay());
}

function ndWeeksFrom(sunday, n) {
  var weeks = [];
  for (var w = 0; w < n; w++) {
    var wk = [];
    for (var i = 0; i < 7; i++) wk.push(ndAddDays(sunday, w * 7 + i));
    weeks.push(wk);
  }
  return weeks;
}

// A day is usable when it is not in the past and inside the voter's crop.
function ndOpen(iso, bound) {
  return iso >= bound.from && (!bound.to || iso <= bound.to);
}

function ndHeadHtml() {
  // the corner flips every row/column button between pencil and eraser
  var h = '<div class="nd-hd nd-corner"><button type="button" class="nd-mode"></button></div>';
  ND_DOW.forEach(function (n, c) {
    h += '<div class="nd-hd" data-col="' + c + '">' +
      '<span class="nd-hd-name">' + n + '</span><button type="button" class="nd-tg"></button></div>';
  });
  return h;
}

function ndRowHtml(wk, r, bound, today) {
  var h = '<div class="nd-wk" data-row="' + r + '" data-month="' + wk[3].slice(5, 7) +
    '" data-year="' + wk[3].slice(0, 4) + '"><button type="button" class="nd-tg"></button></div>';
  wk.forEach(function (iso, c) {
    var cls = ['nd-d'];
    if (!ndOpen(iso, bound)) cls.push('out');
    if (c === 0 || c === 6) cls.push('we');
    if (c === 6) cls.push('eow');
    if (iso === today) cls.push('today');
    // (month boundaries are drawn over the grid as ONE path each --
    // noodle-cal-view.js ndcPaintMonths -- not per cell)
    h += '<div class="' + cls.join(' ') + '" data-day="' + iso + '">' +
      '<span class="nd-n">' + iso.slice(8) + '</span><div class="nd-dots"></div></div>';
  });
  return h;
}

// The slot codes a day has: midday + night in a SPLIT poll, one whole-day
// slot otherwise (the default for new polls; the host can split them).
function ndCodes(halves) { return halves ? ['m', 'n'] : ['d']; }

// Add one week's usable slots to the toggle groups (a column's group grows as
// rows are appended: "every Wednesday" means every Wednesday LOADED).
function ndGroupAdd(groups, wk, bound, halves) {
  var row = [], codes = ndCodes(halves);
  wk.forEach(function (iso, c) {
    if (!ndOpen(iso, bound)) return;
    codes.forEach(function (k) { groups.cols[c].push(iso + ':' + k); row.push(iso + ':' + k); });
  });
  groups.rows.push(row);
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
function ndDotsHtml(iso, cols, fit, sel, halves) {
  var h = '', shown = cols.slice(0, fit.shown);
  // when columns overflow, YOUR column is never the one cut: it takes the
  // last visible place, the rest stay in vote order
  var mine = cols.find(function (c) { return c.self; });
  if (fit.more && mine && shown.indexOf(mine) < 0 && shown.length) shown[shown.length - 1] = mine;
  for (var i = 0; i < shown.length; i++) {
    var c = shown[i], s = c.self ? sel : c.slots;
    var lit = ' class="on"' + (c.ink ? ' style="--seal-hsl:' + c.ink + '"' : '');
    if (halves) {
      h += '<i' + (s.has(iso + ':m') ? lit : '') + '></i>' +
        '<i' + (s.has(iso + ':n') ? lit : '') + '></i>';
    } else {
      h += '<i' + (s.has(iso + ':d') ? lit : '') + '></i>'; // one dot a day
    }
  }
  return fit.more ? h + '<b class="nd-more"></b>' : h;
}

if (typeof window !== 'undefined') {
  window.NoodleCalParts = { iso: ndIso, date: ndDate, half: ndHalf, addDays: ndAddDays,
    sunday: ndSunday, weeksFrom: ndWeeksFrom, open: ndOpen, headHtml: ndHeadHtml,
    rowHtml: ndRowHtml, groupAdd: ndGroupAdd, codes: ndCodes,
    dotsFit: ndDotsFit, dotsHtml: ndDotsHtml };
}
