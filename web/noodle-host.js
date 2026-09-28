// noodle host controls. The host is whoever acts FIRST on a fresh poll (a
// commit, or a crop); after that the same key alone can split the days, crop
// the calendar (noodle-crop.js) and remove guests. Each action is signed like
// a vote, over a canonical object that carries a `kind` field (noodle/sig.py
// canonical_action) so a vote can never be replayed as an action or back.
//
// The SPLIT (a checkbox under the calendar) and the CROP (noodle-crop.js) are
// both local until Commit: changing either re-renders the calendar at once,
// marks the page unsaved, and is sent with Commit -- settings first, then the
// vote (ndvSubmit). Only Commit needs the right passphrase.

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

// The crop this page is showing: the host's unsaved drag, else the poll's.
// undefined = nothing pending (null would mean "pending: no crop").
function ndhCrop() {
  return NDV.pendingCrop !== undefined ? NDV.pendingCrop : (NDV.poll && NDV.poll.crop) || null;
}

function ndhSync(pub) {
  var role = ndhRole(pub), row = ndh$('nd-split-row');
  row.hidden = role === 'guest';
  ndh$('nd-split').checked = ndhHalves();
  ndhPlaceSplit();
}

// The split box sits on the calendar's FIRST row -- the past week drawn above
// today, which nobody can pick, so it is free space -- centred, and inside the
// grid so it scrolls with it. The slot spans the row but takes no taps; only
// the box and its words do.
function ndhPlaceSplit() {
  var slot = ndh$('nd-split-slot'), grid = document.querySelector('#nd-cal .nd-grid');
  var rows = NDV.cal ? NDV.cal.rows() : [];
  if (!grid || !rows.length) return;
  if (slot.parentNode !== grid) grid.appendChild(slot);
  slot.style.top = rows[0].offsetTop + 'px';
  slot.style.height = rows[0].offsetHeight + 'px';
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

// The pending split and crop, sent together as part of Commit -- so neither
// needs the passphrase until then. -> {ok, sent}; sent = the next request
// needs a newer ts.
async function ndhCommitSettings(ts) {
  if (NDV.pendingHalves == null && NDV.pendingCrop === undefined && NDV.pendingTitle === undefined) return { ok: true };
  var c = ndhCrop(), f = { kind: 'settings', halves: ndhHalves(), from: c ? c.from : null, to: c ? c.to : null };
  if (NDV.pendingTitle !== undefined) f.title = NDV.pendingTitle;
  var res = await ndhSend('/settings', f, ts);
  if (res.ok) { NDV.pendingHalves = null; NDV.pendingCrop = undefined; NDV.pendingTitle = undefined; res.sent = true; }
  return res;
}

// The TITLE: the host taps it and types; Enter (or tapping away) ends the
// edit, and like the split and the crop it is sent with Commit.
function ndhTitleTap() {
  var el = ndh$('nd-title'), pub = ndvReady() ? ndvPub() : null, role = ndhRole(pub);
  if ((role !== 'host' && role !== 'fresh') || el.isContentEditable) return;
  el.contentEditable = 'plaintext-only';
  el.focus();
  // the whole title selected: a placeholder like "click me to name me" is typed over
  var r = document.createRange();
  r.selectNodeContents(el);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
}

function ndhTitleEdit() {
  var t = ndh$('nd-title').textContent.split(/\s+/).filter(Boolean).join(' ');
  NDV.pendingTitle = t && t !== NDV.poll.title ? t : undefined;
  ndvSaveDraft();   // marks it unsaved
}

function ndhTitleDone(e) {
  var el = ndh$('nd-title');
  if (e.type === 'keydown' && e.key !== 'Enter') return;
  if (e.type === 'keydown') e.preventDefault();
  el.contentEditable = 'false';
  if (!el.textContent.trim()) { el.textContent = NDV.poll.title; ndhTitleEdit(); }
  el.blur();
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
  var t = ndh$('nd-title');
  t.addEventListener('click', ndhTitleTap);
  t.addEventListener('input', ndhTitleEdit);
  t.addEventListener('keydown', ndhTitleDone);
  t.addEventListener('blur', ndhTitleDone);
  window.ndhSync = ndhSync;
  window.addEventListener('resize', ndhPlaceSplit);
  window.ndhRole = ndhRole;
  window.ndhHalves = ndhHalves;
  window.ndhCrop = ndhCrop;
})();
