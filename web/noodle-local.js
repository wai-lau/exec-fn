// noodle's BROWSER STORAGE: who you are (name + passphrase, the one thing
// kept across polls), and per poll AND per name: the calendar draft (picks +
// a host's unsaved title) and the Ask text. Split from noodle-vote.js at the 500-line cap -- same global scope,
// loaded before it and only called once it has run.

// Name + passphrase are remembered in localStorage, NOT a cookie: a cookie
// rides along on every request, which would send the passphrase to the server
// -- the one thing this page promises never happens. The ONE thing kept across
// polls (who you are travels with you); everything else is per poll.
function ndvIdentityKey() { return 'noodle.identity'; }

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
  try {
    localStorage.setItem(ndvIdentityKey(), JSON.stringify({ name: ndv$('nd-name').value, pass: ndv$('nd-pass').value }));
  } catch (e) { /* storage blocked: the form just is not remembered */ }
}

function ndvRestoreIdentity() {
  try {
    var id = JSON.parse(localStorage.getItem(ndvIdentityKey()) || 'null');
    if (id && typeof id.name === 'string') {
      ndv$('nd-name').value = id.name;
      ndv$('nd-pass').value = typeof id.pass === 'string' ? id.pass : '';
      return true;
    }
  } catch (e) { /* unreadable or blocked: start empty */ }
  return false;
}
