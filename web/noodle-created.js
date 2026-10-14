// noodle's OWNER chart on /noodle: polls created per day, one bar a day from
// the first counted day to today (api/noodle/stats.py). Guests never see it:
// the counts are owner-only, so for anyone else the fetch 401s and the
// section stays hidden. Hover, focus or tap a bar for its day and count; the
// table under it holds every number without the bars.

var NDC_MAX_DAYS = 90;   // older days than this are summed into one line, not drawn
var NDC_DAY_MS = 86400000;

function ndcIso(t) { return new Date(t).toISOString().slice(0, 10); }

function ndcLocalToday() {
  var d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function ndcLabel(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toLowerCase();
}

function ndcPolls(n) { return n + (n === 1 ? ' poll' : ' polls'); }

// {day: n} -> [{day, n}] for every day first..today, the zeros included;
// days before the 90-day window come back as `older`
function ndcSeries(days) {
  var keys = Object.keys(days).sort(), today = ndcLocalToday();
  if (!keys.length) return { bars: [], older: 0 };
  var start = Math.max(Date.parse(keys[0] + 'T00:00:00Z'), today - (NDC_MAX_DAYS - 1) * NDC_DAY_MS);
  var bars = [], older = 0;
  keys.forEach(function (k) { if (Date.parse(k + 'T00:00:00Z') < start) older += days[k]; });
  for (var t = start; t <= today; t += NDC_DAY_MS) bars.push({ day: ndcIso(t), n: days[ndcIso(t)] || 0 });
  return { bars: bars, older: older };
}

function ndcTip(bar, d) {
  var tip = document.getElementById('nd-chart-tip');
  if (!bar) { tip.hidden = true; return; }
  tip.textContent = '';
  var strong = document.createElement('strong');
  strong.textContent = ndcPolls(d.n);
  tip.append(strong, document.createTextNode(' ' + ndcLabel(d.day)));
  tip.hidden = false;
  // centred over the bar, kept inside the plot
  var plot = bar.parentNode, x = bar.offsetLeft + bar.offsetWidth / 2;
  tip.style.left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), plot.offsetWidth - tip.offsetWidth) + 'px';
}

function ndcBars(bars) {
  var plot = document.getElementById('nd-bars'), max = Math.max.apply(null, bars.map(function (b) { return b.n; }));
  var peak = bars.findIndex(function (b) { return b.n === max; });
  plot.textContent = '';
  bars.forEach(function (d, i) {
    var bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'nd-bar';
    bar.setAttribute('aria-label', ndcPolls(d.n) + ' on ' + ndcLabel(d.day));
    bar.style.setProperty('--h', max ? d.n / max : 0);
    var fill = document.createElement('span');
    fill.className = 'nd-bar-fill';
    if (i === peak && max) {   // the one direct label: the peak's count on its cap
      var cap = document.createElement('span');
      cap.className = 'nd-bar-cap';
      cap.textContent = d.n;
      fill.append(cap);
    }
    bar.append(fill);
    ['pointerenter', 'focus', 'click'].forEach(function (ev) { bar.addEventListener(ev, function () { ndcTip(bar, d); }); });
    plot.append(bar);
  });
  plot.addEventListener('pointerleave', function () { if (!plot.contains(document.activeElement)) ndcTip(null); });
  plot.addEventListener('focusout', function (e) { if (!plot.contains(e.relatedTarget)) ndcTip(null); });
}

function ndcTable(bars, older) {
  var body = document.getElementById('nd-chart-rows');
  body.textContent = '';
  bars.filter(function (b) { return b.n; }).reverse().forEach(function (b) {
    var tr = document.createElement('tr'), day = document.createElement('td'), n = document.createElement('td');
    day.textContent = ndcLabel(b.day);
    n.textContent = b.n;
    tr.append(day, n);
    body.append(tr);
  });
  if (older) {
    var tr = document.createElement('tr'), day = document.createElement('td'), n = document.createElement('td');
    day.textContent = 'earlier';
    n.textContent = older;
    tr.append(day, n);
    body.append(tr);
  }
}

async function ndcInit() {
  var box = document.getElementById('nd-owner');
  if (!box) return;
  var r = await fetch('/api/noodle-polls/created', { cache: 'no-store' }).catch(function () { return null; });
  if (!r || !r.ok) return;   // not the owner: the chart stays hidden (owner-only server-side too)
  var s = ndcSeries((await r.json()).days || {});
  var total = s.bars.reduce(function (a, b) { return a + b.n; }, s.older);
  box.hidden = false;
  if (!s.bars.length) { document.getElementById('nd-chart-sub').textContent = 'no polls yet'; return; }
  document.getElementById('nd-chart-sub').textContent = ndcPolls(total) + ' since ' + ndcLabel(s.bars[0].day) +
    (s.older ? ' (' + s.older + ' earlier)' : '');
  document.getElementById('nd-chart-from').textContent = ndcLabel(s.bars[0].day);
  ndcBars(s.bars);
  ndcTable(s.bars, s.older);
}

ndcInit();
