// noodle's TOP DATES: every slot at least one GUEST picked (the host's own
// offer alone is not a result), most voters first, soonest first on a tie,
// drawn above "make another noodle". One text row per slot --
// "<glyph> tue dd/mm/yyyy: " then the voters' dots -- and every row the same
// width, so the dots line up in columns like the calendar's: each voter owns
// one fixed column (vote order, in their seal ink), a gap where not free.
// The glyph is there only on a SPLIT poll: sun = midday, moon = night (Font
// Awesome U+F185 / U+F186 from noodle-seal.woff2, text glyphs, not emoji);
// they ink about two cells, so they sit in a fixed two-cell box (noodle.css).

var NDT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var NDT_GLYPH = { m: '', n: '' };

// '2026-09-28' -> 'mon 28/09/2026'
function ndtDate(iso) {
  var p = iso.split('-');
  var wd = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
  return NDT_DAYS[wd] + ' ' + p[2] + '/' + p[1] + '/' + p[0];
}

// cols as the calendar has them (noodle-vote.js ndvRefreshBinding): a stored
// vote's {slots}, or YOUR {self} column, which reads the live selection.
// cols[0] is always the HOST (vote order; on a fresh poll it is your own
// column, the host-to-be). -> [{slot, cols: [bool per column]}], best first.
function ndtRank(cols, sel, today, crop) {
  var count = new Map(), guests = new Set();
  cols.forEach(function (c, i) {
    (c.self ? sel : c.slots).forEach(function (s) {
      var d = s.slice(0, 10);
      if (d < today || (crop && (d < crop.from || d > crop.to))) return;
      count.set(s, (count.get(s) || 0) + 1);
      if (i > 0) guests.add(s);
    });
  });
  return Array.from(guests).sort(function (a, b) {
    return count.get(b) - count.get(a) || (a < b ? -1 : 1);   // a tie goes to the soonest
  }).map(function (s) {
    return { slot: s, cols: cols.map(function (c) { return (c.self ? sel : c.slots).has(s); }) };
  });
}

function ndtRender(cols, sel) {
  var el = document.getElementById('nd-top');
  if (!el) return;
  var P = window.NoodleCalParts, crop = window.ndhCrop ? window.ndhCrop() : null;
  var rows = ndtRank(cols || [], sel || new Set(), P.iso(new Date()), crop);
  el.parentNode.hidden = !rows.length;   // the box with its label
  el.innerHTML = rows.map(function (r) {
    var k = r.slot.slice(11), glyph = NDT_GLYPH[k];
    var dots = r.cols.map(function (on, i) {
      var ink = cols[i].ink;
      return '<i' + (on ? ' class="on"' + (ink ? ' style="--seal-hsl:' + ink + '"' : '') : '') + '></i>';
    }).join('');
    return '<li>' + (k === 'd' ? '' : '<span class="nd-top-glyph">' + glyph + '</span>') +
      '<span class="nd-top-date">' + ndtDate(r.slot.slice(0, 10)) + ': </span>' +
      '<span class="nd-top-dots">' + dots + '</span></li>';
  }).join('');
}

window.ndtRender = ndtRender;
