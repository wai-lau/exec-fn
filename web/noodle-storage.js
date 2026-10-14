// noodle's BROWSER STORAGE (localStorage, never a cookie): the last NAME you
// used (kept across polls), the calendar draft (picks + a host's unsaved
// title / note) and the Ask text -- and, through noodle-keystore.js, the
// signing KEY per poll and name. Never the passphrase. Same global scope as
// noodle-vote.js; loaded before it, called once it has run.

// The NAME is remembered in localStorage, not a cookie (a cookie rides along
// on every request). The PASSPHRASE is not remembered at all since 2026-10-14:
// what is kept is the key it made, once that key is proven to be you (it
// matches your seat, or a commit lands) -- NoodleKeys. A passphrase an older
// page left here in plain text (noodle.pass.<slug>.<name>) still fills the
// field once, for this poll only; when its key is proven it is converted to a
// kept key and the text is deleted (ndvRememberKey). The cross-poll fallback
// (noodle.lastpass.<name>) is gone, and so are its entries.
function ndvIdentityKey() { return 'noodle.identity'; }

function ndvPassKey(raw) {
  var name = window.noodleNormName(raw);
  return name ? 'noodle.pass.' + NDV.slug + '.' + name : null;
}

// A plain-text passphrase an older page kept for this name on THIS poll.
function ndvStoredPass(raw) {
  var k = ndvPassKey(raw);
  try { return k ? localStorage.getItem(k) : null; } catch (e) { return null; }
}

// The kept key for a name on this poll (noodle-keystore.js), or null.
function ndvKeptKey(raw) {
  var name = window.noodleNormName(raw);
  return name && NDV.keptKeys && NDV.keptKeys[name] ? NDV.keptKeys[name] : null;
}

// Keep the key now in use for the name in the field: it has just been proven
// to be this voter's (their seat matched it, or their commit landed). Its
// plain-text passphrase, if an older page left one, goes.
async function ndvRememberKey() {
  if (window.NDR && NDR.active) return;   // mid change: the new key is kept once committed
  var name = window.noodleNormName(ndv$('nd-name').value), pub = ndvReady() ? NDV.kdf.pub() : null;
  if (!name || !pub) return;
  var kept = ndvKeptKey(name);
  if (!kept || kept.pub !== pub) {
    var key = await NDV.kdf.key().catch(function () { return null; });
    if (!key) return;
    NDV.keptKeys[name] = { key: key, pub: pub };
    await window.NoodleKeys.save(NDV.slug, name, key, pub);
  }
  try { localStorage.removeItem(ndvPassKey(name)); } catch (e) { /* blocked */ }
}

function ndvForgetKey(raw) {
  var name = window.noodleNormName(raw);
  if (!name) return;
  delete NDV.keptKeys[name];
  window.NoodleKeys.drop(NDV.slug, name);
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
  if (window.NDR && NDR.active) return;   // the new name is kept only once committed
  try {
    localStorage.setItem(ndvIdentityKey(), JSON.stringify({ name: ndv$('nd-name').value }));   // a name, never a passphrase
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

// Typing a name an older page kept a plain-text passphrase for ON THIS POLL
// fills it back in (once, until it converts to a kept key) -- but only over an
// empty field or one this same rule filled, never over one typed by hand.
function ndvOfferPass() {
  var name = window.noodleNormName(ndv$('nd-name').value), pass = ndv$('nd-pass');
  if (name === NDV.lastName || (window.NDR && NDR.active) || pass.disabled) return;
  NDV.lastName = name;
  if (pass.value && pass.value !== NDV.autoPass) return;
  pass.value = ndvStoredPass(ndv$('nd-name').value) || '';
  NDV.autoPass = pass.value;
}

// noodle.polls kept every opened poll's link -- its key included -- for the
// owner's poll list on /noodle, which went 2026-10-13; noodle.lastpass.<name>
// kept a passphrase for EVERY poll a name was used on. Nothing reads either
// now, so a browser that still holds them drops them.
try {
  localStorage.removeItem('noodle.polls');
  Object.keys(localStorage).filter(function (k) { return k.indexOf('noodle.lastpass.') === 0; })
    .forEach(function (k) { localStorage.removeItem(k); });
} catch (e) { /* storage blocked */ }
