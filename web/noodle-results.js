// Noodle results: the same calendar, read-only. Each half's fill is its heat
// (share of voters free then), every voter is one fixed column of dots, and
// tapping a day lists who is free midday / night with their seals.

var NDR = { poll: null, seals: {} };

function ndrEsc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function ndrVoterHtml(v) {
  return '<li class="nd-voter"><pre class="nd-seal sm">' + ndrEsc(NDR.seals[v.pub] || '') +
    '</pre><span class="nd-vname">' + ndrEsc(v.name) + '</span>' +
    '<span class="nd-vcount">' + v.slots.length + ' slots</span></li>';
}

function ndrDay(iso) {
  var el = document.getElementById('nd-day');
  var mid = [], nit = [];
  NDR.poll.voters.forEach(function (v) {
    if (v.slots.indexOf(iso + ':m') >= 0) mid.push(v);
    if (v.slots.indexOf(iso + ':n') >= 0) nit.push(v);
  });
  function list(title, vs) {
    return '<h3 class="doc-h2">' + title + ' (' + vs.length + ')</h3><ul class="nd-voters">' +
      (vs.length ? vs.map(ndrVoterHtml).join('') : '<li class="nd-none">nobody</li>') + '</ul>';
  }
  el.innerHTML = '<h2 class="nd-dayh">' + iso + '</h2>' + list('midday', mid) + list('night', nit);
}

async function ndrInit() {
  var root = document.getElementById('noodle-results');
  if (!root) return;
  var r = await fetch('/api/noodle/' + root.dataset.slug, { cache: 'no-store' });
  NDR.poll = await r.json();
  var counts = new Map();
  NDR.poll.voters.forEach(function (v) {
    v.slots.forEach(function (s) { counts.set(s, (counts.get(s) || 0) + 1); });
  });
  await Promise.all(NDR.poll.voters.map(async function (v) {
    NDR.seals[v.pub] = v.pub ? await window.NoodleSeal.seal(v.pub) : '';
  }));
  var cal = window.NoodleCal(document.getElementById('nd-cal'), {
    start: NDR.poll.start, end: NDR.poll.end, readonly: true, onDay: ndrDay,
  });
  cal.setHeat(counts, NDR.poll.voters.length);
  cal.setOthers(NDR.poll.voters.map(function (v) { return { slots: new Set(v.slots) }; }));
  document.getElementById('nd-count').textContent =
    NDR.poll.voters.length + (NDR.poll.voters.length === 1 ? ' voter' : ' voters');
  document.getElementById('nd-all').innerHTML = NDR.poll.voters.map(ndrVoterHtml).join('');
}

ndrInit();
