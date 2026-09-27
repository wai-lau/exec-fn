// Noodle host controls. The host is whoever FIRST saves the dates on a fresh
// poll; after that the same key alone can change the dates / the split and
// remove guests. Each action is signed like a vote, over a canonical object
// that carries a `kind` field (noodle/sig.py canonical_action) so a vote can
// never be replayed as an action or the other way round.

var NDH = { touched: false };

function ndh$(id) { return document.getElementById(id); }

// 'fresh' (no dates, nobody yet), 'host' (this key hosts), or 'guest'
function ndhRole(pub) {
  var p = NDV.poll;
  if (!p || !p.voters.length) return 'fresh';
  return pub && p.voters[0].pub === pub ? 'host' : 'guest';
}

function ndhStatus(msg, kind) {
  var el = ndh$('nd-h-status');
  el.textContent = msg || '';
  el.dataset.kind = kind || '';
}

// Show the panel to the host (or anyone, on a fresh poll) and fill it from
// the poll -- unless the host is mid-edit, which a poll reload must not undo.
function ndhSync(pub) {
  var role = ndhRole(pub), panel = ndh$('nd-hostpanel'), p = NDV.poll;
  panel.hidden = role === 'guest';
  if (panel.hidden || !p) return;
  ndh$('nd-host-h').textContent = role === 'host' ? "you're hosting"
    : 'nobody has picked the dates yet -- pick them and you host this poll';
  if (!NDH.touched) {
    ndh$('nd-h-start').value = p.start || '';
    ndh$('nd-h-end').value = p.end || '';
    ndh$('nd-h-split').checked = !!p.halves && !!p.start;
  }
}

// Keys in sorted order: the same bytes json.dumps(sort_keys=True) builds.
function ndhCanon(o) {
  var out = {};
  Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; });
  return JSON.stringify(out);
}

async function ndhSend(path, fields) {
  var name = ndv$('nd-name').value, ts = Date.now() + NDV.skew;
  var sig = await NDV.kdf.sign(ndhCanon(Object.assign({ name: name, poll: NDV.slug, ts: ts }, fields)));
  var body = Object.assign({ name: name, pub: NDV.kdf.pub(), ts: ts, sig: sig }, fields);
  delete body.kind; // the server supplies it: a body cannot choose which action it signs
  return ndvPost(path, body);
}

async function ndhSave() {
  if (!ndvReady()) { ndhStatus('enter your name first -- the host is whoever saves this.'); return; }
  var start = ndh$('nd-h-start').value, end = ndh$('nd-h-end').value;
  var halves = ndh$('nd-h-split').checked;
  if (!start || !end) { ndhStatus('pick both dates.'); return; }
  var p = NDV.poll;
  if (p && p.voters.length > 1 && (halves !== p.halves || start > p.start || end < p.end) &&
      !window.confirm('this changes the calendar for everyone who has voted. go ahead?')) return;
  ndhStatus('saving...');
  var res = await ndhSend('/settings', { kind: 'settings', start: start, end: end, halves: halves });
  if (!res.ok) { ndhStatus(res.data.error || 'could not save', 'err'); return; }
  NDH.touched = false;
  ndhStatus('saved.');
  await ndvLoadPoll();
}

async function ndhRemove(e) {
  var btn = e.target.closest('.nd-face-rm');
  if (!btn || !ndvReady()) return;
  var who = btn.dataset.name;
  if (!window.confirm('remove ' + who + ' and their vote?')) return;
  var res = await ndhSend('/remove', { kind: 'remove', target: who });
  if (!res.ok) { ndvStatus(res.data.error || 'could not remove', 'err'); return; }
  await ndvLoadPoll(); // first: a reload rewrites the status line
  ndvStatus(who + ' was removed.');
}

(function () {
  if (!ndh$('nd-hostpanel')) return;
  ['nd-h-start', 'nd-h-end', 'nd-h-split'].forEach(function (id) {
    ndh$(id).addEventListener('input', function () { NDH.touched = true; });
  });
  ndh$('nd-h-save').addEventListener('click', ndhSave);
  ndh$('nd-voters').addEventListener('click', ndhRemove);
  window.ndhSync = ndhSync;
  window.ndhRole = ndhRole;
})();
