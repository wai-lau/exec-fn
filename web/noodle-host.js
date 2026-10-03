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
  ndhTitleMarks(role);
}

// The title's host-only marks: the dotted "you can edit me" line, and a red
// squiggle while it is still the placeholder.
function ndhTitleMarks(role) {
  var t = ndh$('nd-title'), n = ndh$('nd-note'), host = role === 'host' || role === 'fresh';
  ndh$('noodle').classList.toggle('nd-as-host', host);   // host-only / guest-only bits (noodle.css)
  t.classList.toggle('editable', host);
  // "title" is the placeholder; polls made before 2026-10-03 still say "untitled noodle"
  t.classList.toggle('untitled', host && ['title', 'untitled noodle'].indexOf(t.textContent.trim()) >= 0);
  // the NOTE under it wears the same "you can edit me" line
  n.classList.toggle('editable', host);
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

// Re-express picks when the split flips -- EXACTLY noodle/slots.py convert()
// (pinned by tests/test_noodle_convert.py): a whole day becomes both halves;
// halves become a whole day only where BOTH were picked (free at midday alone
// is not free all day). A slot already in the target form is kept as is.
function ndhConvert(sel, halves) {
  var out = new Set();
  sel.forEach(function (s) {
    var day = s.slice(0, 10), k = s.slice(11);
    if (halves) {
      if (k === 'd') { out.add(day + ':m'); out.add(day + ':n'); } else out.add(s);
    } else if (k === 'd' || (sel.has(day + ':m') && sel.has(day + ':n'))) {
      out.add(day + ':d');
    }
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
  // mid name/passphrase change the server still knows the OLD key, so an
  // action taken meanwhile (removing a guest) is signed with that one -- the
  // page keeps it alive for exactly this (noodle-rekey.js)
  var old = window.NDR && NDR.active, name = old ? NDR.oldName : ndv$('nd-name').value;
  if (old && (await NDR.keeperPub) !== NDR.oldPub) return { ok: false, data: { error: 'the old key did not re-derive' } };
  var signer = old ? NDR.keeper : NDV.kdf;
  ts = ts || Date.now() + NDV.skew;
  var sig = await signer.sign(ndhCanon(Object.assign({ name: name, poll: NDV.slug, ts: ts }, fields)));
  var body = Object.assign({ name: name, pub: old ? NDR.oldPub : NDV.kdf.pub(), ts: ts, sig: sig }, fields);
  delete body.kind; // the server supplies it: a body cannot choose which action it signs
  return ndvPost(path, body);
}

// The pending split and crop, sent together as part of Commit -- so neither
// needs the passphrase until then. -> {ok, sent}; sent = the next request
// needs a newer ts.
async function ndhCommitSettings(ts) {
  if (NDV.pendingHalves == null && NDV.pendingCrop === undefined && NDV.pendingTitle === undefined &&
      NDV.pendingNote === undefined) return { ok: true };
  var c = ndhCrop(), f = { kind: 'settings', halves: ndhHalves(), from: c ? c.from : null, to: c ? c.to : null };
  if (NDV.pendingTitle !== undefined) f.title = NDV.pendingTitle;
  if (NDV.pendingNote !== undefined) f.note = NDV.pendingNote;
  var res = await ndhSend('/settings', f, ts);
  if (res.ok) {
    NDV.pendingHalves = null; NDV.pendingCrop = undefined; NDV.pendingTitle = undefined; NDV.pendingNote = undefined;
    res.sent = true;
  }
  return res;
}

// The TITLE and the NOTE under it, one mechanism: the host taps one and types;
// Enter (or tapping away) ends the edit, and like the split and the crop it
// is sent with Commit. The title may not be emptied (it snaps back); the note
// may (that clears it).
var NDH_TEXT = {
  title: { el: 'nd-title', pending: 'pendingTitle', empty: false },
  note: { el: 'nd-note', pending: 'pendingNote', empty: true },
};

function ndhTextTap(k) {
  return function () {
    var el = ndh$(NDH_TEXT[k].el), role = ndhRole(ndvReady() ? ndvPub() : null);
    // on either step: naming the poll goes with naming yourself (Wai, 2026-10-03)
    if ((role !== 'host' && role !== 'fresh') || el.isContentEditable) return;
    el.contentEditable = 'plaintext-only';
    el.focus();
    // all of it selected: the placeholder "title" is typed over
    var r = document.createRange();
    r.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  };
}

function ndhTextEdit(k) {
  return function () {
    var t = ndh$(NDH_TEXT[k].el).textContent.split(/\s+/).filter(Boolean).join(' ');
    var saved = NDV.poll[k] || '';
    NDV[NDH_TEXT[k].pending] = (t || NDH_TEXT[k].empty) && t !== saved ? t : undefined;
    ndhTitleMarks(ndhRole(ndvReady() ? ndvPub() : null));
    ndvSaveDraft();   // marks it unsaved
  };
}

function ndhTextDone(k) {
  return function (e) {
    var el = ndh$(NDH_TEXT[k].el);
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    if (e.type === 'keydown') e.preventDefault();
    el.contentEditable = 'false';
    if (!el.textContent.trim()) {
      el.textContent = NDH_TEXT[k].empty ? '' : NDV.poll[k];
      ndhTextEdit(k)();
    }
    el.blur();
  };
}

async function ndhRemove(e) {
  var btn = e.target.closest('.nd-face-rm');
  if (!btn || !ndvReady()) return;
  var who = btn.dataset.name;
  if (!window.confirm('remove ' + who + ' and their vote?')) return;
  var res = await ndhSend('/remove', { kind: 'remove', target: who });
  if (!res.ok) { ndvStatus(res.data.error || 'could not remove', 'err'); return; }
  await ndvLoadPoll();
}

(function () {
  if (!ndh$('nd-split')) return;
  ndh$('nd-split').addEventListener('change', ndhSplitChange);
  ndh$('nd-voters').addEventListener('click', ndhRemove);
  Object.keys(NDH_TEXT).forEach(function (k) {
    var t = ndh$(NDH_TEXT[k].el);
    t.addEventListener('click', ndhTextTap(k));
    t.addEventListener('input', ndhTextEdit(k));
    t.addEventListener('keydown', ndhTextDone(k));
    t.addEventListener('blur', ndhTextDone(k));
  });
  window.ndhSync = ndhSync;
  window.addEventListener('resize', ndhPlaceSplit);
  window.ndhRole = ndhRole;
  window.ndhHalves = ndhHalves;
  window.ndhCrop = ndhCrop;
})();
