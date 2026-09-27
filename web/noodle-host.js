// Noodle host controls. The host is whoever acts FIRST on a fresh poll (a
// commit, or a crop); after that the same key alone can split the days, crop
// the calendar (noodle-crop.js) and remove guests. Each action is signed like
// a vote, over a canonical object that carries a `kind` field (noodle/sig.py
// canonical_action) so a vote can never be replayed as an action or back.
//
// The SPLIT is a checkbox under the calendar: ticking it re-renders the
// calendar at once (the picks converted the way the server converts them),
// marks the page unsaved, and is sent with Commit -- settings first, then the
// vote (ndvSubmit).

function ndh$(id) { return document.getElementById(id); }

// 'fresh' (nobody yet), 'host' (this key hosts), or 'guest'
function ndhRole(pub) {
  var p = NDV.poll;
  if (!p || !p.voters.length) return 'fresh';
  return pub && p.voters[0].pub === pub ? 'host' : 'guest';
}

// The split this page is showing: the host's unsaved choice, else the poll's.
function ndhHalves() {
  return NDV.pendingHalves != null ? NDV.pendingHalves : !!(NDV.poll && NDV.poll.halves);
}

function ndhSync(pub) {
  var role = ndhRole(pub), row = ndh$('nd-split-row');
  row.hidden = role === 'guest';
  ndh$('nd-split').checked = ndhHalves();
}

// Re-express picks when the split flips -- the same rule as noodle/slots.py
// convert(): a whole day becomes both halves; halves become a whole day only
// where BOTH were picked (free at midday alone is not free all day).
function ndhConvert(sel, halves) {
  var out = new Set();
  sel.forEach(function (s) {
    var day = s.slice(0, 10), k = s.slice(11);
    if (halves && k === 'd') { out.add(day + ':m'); out.add(day + ':n'); }
    if (!halves && k !== 'd' && sel.has(day + ':m') && sel.has(day + ':n')) out.add(day + ':d');
  });
  return out;
}

function ndhSplitChange() {
  var want = ndh$('nd-split').checked, was = ndhHalves();
  if (want === was) return;
  var sel = NDV.cal ? NDV.cal.getSel() : new Set();
  NDV.pendingHalves = want === !!NDV.poll.halves ? null : want;
  ndvEnsureCal();
  NDV.cal.setSel(ndhConvert(sel, want));
  ndvSaveDraft();
}

// Keys in sorted order: the same bytes json.dumps(sort_keys=True) builds.
function ndhCanon(o) {
  var out = {};
  Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; });
  return JSON.stringify(out);
}

async function ndhSend(path, fields, ts) {
  var name = ndv$('nd-name').value;
  ts = ts || Date.now() + NDV.skew;
  var sig = await NDV.kdf.sign(ndhCanon(Object.assign({ name: name, poll: NDV.slug, ts: ts }, fields)));
  var body = Object.assign({ name: name, pub: NDV.kdf.pub(), ts: ts, sig: sig }, fields);
  delete body.kind; // the server supplies it: a body cannot choose which action it signs
  return ndvPost(path, body);
}

// The pending split, sent as part of Commit. Keeps the crop as it is.
async function ndhCommitSplit(ts) {
  if (NDV.pendingHalves == null) return { ok: true };
  var c = NDV.poll && NDV.poll.crop;
  return ndhSend('/settings', { kind: 'settings', halves: NDV.pendingHalves,
    from: c ? c.from : null, to: c ? c.to : null }, ts);
}

async function ndhRemove(e) {
  var btn = e.target.closest('.nd-face-rm');
  if (!btn || !ndvReady()) return;
  if (window.NDR && NDR.active) { ndvStatus('commit your new passphrase first.'); return; }
  var who = btn.dataset.name;
  if (!window.confirm('remove ' + who + ' and their vote?')) return;
  var res = await ndhSend('/remove', { kind: 'remove', target: who });
  if (!res.ok) { ndvStatus(res.data.error || 'could not remove', 'err'); return; }
  await ndvLoadPoll(); // first: a reload rewrites the status line
  ndvStatus(who + ' was removed.');
}

(function () {
  if (!ndh$('nd-split')) return;
  ndh$('nd-split').addEventListener('change', ndhSplitChange);
  ndh$('nd-voters').addEventListener('click', ndhRemove);
  window.ndhSync = ndhSync;
  window.ndhRole = ndhRole;
  window.ndhHalves = ndhHalves;
})();
