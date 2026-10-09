// noodle's BROWSER STORAGE (localStorage, never a cookie): the last NAME you
// used (kept across polls); per poll AND per name the passphrase (with the
// name's last-used one as the fallback), the calendar draft (picks + a host's
// unsaved title / note) and the Ask text. Same global scope as
// noodle-vote.js; loaded before it, called once it has run.

// Name + passphrase are remembered in localStorage, NOT a cookie: a cookie
// rides along on every request, which would send the passphrase to the server
// -- the one thing this page promises never happens. The last NAME is kept
// across polls; the PASSPHRASE is kept per poll and per name
// (noodle.pass.<slug>.<name>), with the name's last-used one as the fallback
// on a poll where that name has none yet.
function ndvIdentityKey() { return 'noodle.identity'; }

function ndvPassKey(raw) {
  var name = window.noodleNormName(raw);
  return name ? 'noodle.pass.' + NDV.slug + '.' + name : null;
}

// This poll's passphrase for the name; failing that, the LAST one that name
// used on any poll (noodle.lastpass.<name>) -- so a new poll opens ready.
function ndvStoredPass(raw) {
  var k = ndvPassKey(raw), name = window.noodleNormName(raw);
  try {
    var here = k ? localStorage.getItem(k) : null;
    return here !== null ? here : (name ? localStorage.getItem('noodle.lastpass.' + name) : null);
  } catch (e) { return null; }
}

// The rest of the form -- calendar picks not yet submitted, and the Ask box --
// is a DRAFT kept per poll AND per NAME (not the passphrase): keyed by the
// poll's slug and the normalized name, so one person's unsaved picks never
// appear under another's name, nor on another poll. No name, no draft.
// A draft outranks the submitted vote when the page reopens, since it is the
// newer of the two; a successful submit clears it.
function ndvDraftKey() {
  // mid name change the draft stays with the name it was made under
  var raw = window.NDR && NDR.active ? NDR.oldName : ndv$('nd-name').value;
  var name = window.noodleNormName(raw);
  return name ? 'noodle.draft.' + NDV.slug + '.' + name : null;
}

function ndvSaveDraft() {
  var k = ndvDraftKey();
  if (NDV.cal && window.ndtRender) window.ndtRender(NDV.cols, NDV.cal.getSel());   // your taps move the top dates
  if (!NDV.cal || !k) { ndvSyncSubmit(); return; }
  try {
    localStorage.setItem(k, JSON.stringify({ slots: Array.from(NDV.cal.getSel()).sort(),
      title: NDV.pendingTitle, note: NDV.pendingNote }));   // a host's unsaved title / note (noodle-host.js)
    NDV.hasDraft = true;
  } catch (e) { /* storage blocked: nothing is remembered */ }
  ndvSyncSubmit();
}

function ndvRestoreDraft() {
  var k = ndvDraftKey();
  if (!k) return;
  try {
    var d = JSON.parse(localStorage.getItem(k) || 'null');
    if (!d) return;
    // an unsaved title comes back on its own (only a host ever has one)
    var host = window.ndxIsHost && window.ndxIsHost();
    if (typeof d.title === 'string' && d.title && host) {
      NDV.pendingTitle = d.title;
      ndv$('nd-title').textContent = d.title;
    }
    if (typeof d.note === 'string' && host) {
      NDV.pendingNote = d.note;
      ndv$('nd-note').textContent = d.note;
    }
    // an EMPTY list is not a draft, and would hide the voter's stored vote
    if (!(Array.isArray(d.slots) && d.slots.length)) return;
    NDV.cal.setSel(new Set(d.slots));
    NDV.hasDraft = true;
  } catch (e) { /* unreadable: start clean */ }
}

// After a Commit the server copy IS the current one, so EVERY draft this poll
// holds goes -- any identity's, not just the key in use now: a stale draft
// left under another key (an earlier name, a pre-change passphrase) would
// otherwise beat the saved picks the next time that seal matched.
// The Ask box's text is kept on its OWN key, per poll and name, and a Commit
// leaves it alone: it is the question, not a pick, and worth keeping to ask
// again or tweak.
function ndvAskKey() {
  var k = ndvDraftKey();
  return k ? k.replace('noodle.draft.', 'noodle.ask.') : null;
}

function ndvSaveAsk() {
  var k = ndvAskKey();
  try { if (k) localStorage.setItem(k, ndv$('nd-ask').value); } catch (e) { /* not kept */ }
}

function ndvRestoreAsk() {
  var k = ndvAskKey(), v = null;
  try { v = k ? localStorage.getItem(k) : null; } catch (e) { /* blocked */ }
  ndv$('nd-ask').value = v || '';
}

function ndvClearDraft() {
  var prefix = 'noodle.draft.' + NDV.slug + '.';
  try {
    Object.keys(localStorage).filter(function (k) { return k.indexOf(prefix) === 0; })
      .forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) { /* storage blocked: nothing was kept */ }
  NDV.hasDraft = false;
}

function ndvSaveIdentity() {
  if (window.NDR && NDR.active) return;   // the new passphrase is kept only once committed
  var name = ndv$('nd-name').value, k = ndvPassKey(name);
  try {
    localStorage.setItem(ndvIdentityKey(), JSON.stringify({ name: name }));   // no passphrase here any more
    if (k) {
      localStorage.setItem(k, ndv$('nd-pass').value);
      localStorage.setItem('noodle.lastpass.' + window.noodleNormName(name), ndv$('nd-pass').value);
    }
  } catch (e) { /* storage blocked: the form just is not remembered */ }
}

function ndvRestoreIdentity() {
  try {
    var id = JSON.parse(localStorage.getItem(ndvIdentityKey()) || 'null');
    if (id && typeof id.name === 'string') {
      ndv$('nd-name').value = id.name;
      ndv$('nd-pass').value = ndvStoredPass(id.name) || '';
      NDV.autoPass = ndv$('nd-pass').value;
      NDV.lastName = window.noodleNormName(id.name);
      return true;
    }
  } catch (e) { /* unreadable or blocked: start empty */ }
  return false;
}

// Typing a name used before ON THIS POLL fills its passphrase back in --
// but only over an empty field or one this same rule filled, never over a
// passphrase the voter typed themselves.
function ndvOfferPass() {
  var name = window.noodleNormName(ndv$('nd-name').value), pass = ndv$('nd-pass');
  if (name === NDV.lastName || (window.NDR && NDR.active) || pass.disabled) return;
  NDV.lastName = name;
  if (pass.value && pass.value !== NDV.autoPass) return;
  pass.value = ndvStoredPass(ndv$('nd-name').value) || '';
  NDV.autoPass = pass.value;
}

// Every poll this browser opens, as noodle.polls = {slug: {title, url, seen}}.
// The server keeps no links (each one is its poll's encryption key,
// api/noodle/store.py), so this is the ONLY list of links there is: the
// owner's /noodle page reads it to put titles + links beside the bare ids the
// server lists (web/noodle-admin.js). It never leaves the browser.
function ndvRemember(poll, draft) {
  try {
    var all = JSON.parse(localStorage.getItem('noodle.polls') || '{}');
    all[poll.slug] = { title: poll.title || '', seen: Date.now(),
      url: '/noodle/' + poll.slug + (draft ? '?t=' + encodeURIComponent(draft) : '') };
    localStorage.setItem('noodle.polls', JSON.stringify(all));
  } catch (e) { /* storage blocked: the poll is still open, just not listed */ }
}
