// Noodle voter page: identity -> key -> seal, the calendar, and the signed
// submit (Ask Noodle lives in noodle-ask.js). The passphrase never leaves the
// browser: it goes to the key worker (noodle-kdf-worker.js) and nowhere else;
// the server receives the public key, the slots and a signature over them.

var NDV = { poll: null, cal: null, kdf: null, skew: 0, blocked: '', keyError: false, salt: '', seals: {},
  saved: new Set() };

// Name + passphrase are remembered in localStorage, NOT a cookie: a cookie
// rides along on every request, which would send the passphrase to the server
// -- the one thing this page promises never happens. Per browser, all polls.
var NDV_STORE = 'noodle.identity';

// The rest of the form -- calendar picks not yet submitted, and the Ask box --
// is a DRAFT kept per poll (key + slug). A draft outranks the submitted vote
// when the page reopens, since it is the newer of the two; a successful
// submit clears it, because the server copy is then the current one.
function ndvDraftKey() { return 'noodle.draft.' + NDV.slug; }

function ndvSaveDraft() {
  try {
    localStorage.setItem(ndvDraftKey(), JSON.stringify({
      slots: Array.from(NDV.cal.getSel()).sort(), ask: ndv$('nd-ask').value,
    }));
    NDV.hasDraft = true;
  } catch (e) { /* storage blocked: nothing is remembered */ }
  ndvSyncSubmit();
}

function ndvRestoreDraft() {
  try {
    var d = JSON.parse(localStorage.getItem(ndvDraftKey()) || 'null');
    if (!d) return;
    if (Array.isArray(d.slots)) NDV.cal.setSel(new Set(d.slots));
    if (typeof d.ask === 'string') ndv$('nd-ask').value = d.ask;
    NDV.hasDraft = true;
  } catch (e) { /* unreadable: start clean */ }
}

function ndvClearDraft() {
  try { localStorage.removeItem(ndvDraftKey()); } catch (e) { /* ignore */ }
  NDV.hasDraft = false;
}

function ndv$(id) { return document.getElementById(id); }

function ndvStatus(msg, kind) {
  var el = ndv$('nd-status');
  el.textContent = msg || '';
  el.dataset.kind = kind || '';
}

var NDV_SIGN_WAIT = 'sign(your availability, key) ──> (on reserve)';
var NDV_SIGN_DONE = 'sign(your availability, key) ──> sealed';

function ndvDeriveLine(salt, tail) {
  var k = NDV.kdfCfg, pass = ndv$('nd-pass').value;
  return 'argon2id("' + pass + '", ' + salt.slice(0, 12) + '.., m=' +
    (k.m / 1024) + 'MiB, t=' + k.t + ', p=' + k.p + ') \u2500\u2500> ' + tail;
}

function ndvTeach(tail, signLine) {
  ndv$('nd-teach').textContent = ndvDeriveLine(NDV.salt || '<salt>', tail) + '\n' + signLine;
}

function ndvReady() { return !!NDV.kdf && NDV.kdf.ready(); }

// Why submit cannot be pressed right now, or '' when it can. A disabled
// button with no reason reads as broken.
function ndvWhyNot() {
  var raw = ndv$('nd-name').value;
  if (!raw.trim()) return 'enter your name first.';
  if (!window.noodleNormName(raw)) return 'that name is too long, or has characters that cannot be used.';
  if (NDV.blocked) return '"' + NDV.blocked + '" is already sealed with a different passphrase.';
  if (NDV.keyError) return 'this browser could not make a key.';
  if (!ndvReady()) return 'making your key...';
  return '';
}

// Unsaved = the calendar differs from what the server holds for THIS key
// (nothing, for someone who has not reserved yet).
function ndvDirty() {
  var sel = NDV.cal.getSel(), saved = NDV.saved;
  if (sel.size !== saved.size) return true;
  for (var s of sel) if (!saved.has(s)) return true;
  return false;
}

function ndvSyncSubmit(busy) {
  var why = busy ? 'reserving...' : ndvWhyNot(), dirty = ndvDirty();
  var btn = ndv$('nd-submit');
  btn.disabled = !!why;
  btn.textContent = dirty ? 'Reserve*' : 'Reserve';
  ndv$('nd-dirty').hidden = !dirty;
  ndv$('nd-why').textContent = why;
  ndvSyncLock();
}

// A name sealed by ANOTHER key locks everything but the identity fields (and
// the faces, which are a way to pick a different name): the calendar, its
// toggles, Ask and Reserve go grey and inert. Editing the name to one nobody
// holds re-derives the key and unlocks it -- NDV.blocked is recomputed then.
function ndvSyncLock() {
  var locked = !!NDV.blocked;
  ndv$('noodle').classList.toggle('nd-locked', locked);
  ndv$('nd-cal').inert = locked;
  ndv$('nd-ask').closest('.nd-ask').inert = locked;
  ndvSealCaption();
}

// Which voter (if any) the typed name already belongs to, and everyone else
// as dot columns. A name sealed by a different key blocks submit.
function ndvRefreshBinding(pub) {
  var norm = window.noodleNormName(ndv$('nd-name').value), mine = null, cols = [];
  var self = { self: true, ink: NDV.seal ? NDV.seal.ink : null };
  (NDV.poll ? NDV.poll.voters : []).forEach(function (v) {
    if (norm && window.noodleNormName(v.name) === norm) mine = v;
    // your own reserved column shows your LIVE picks instead of the stored vote
    if (pub && v.pub === pub) cols.push(self);
    else cols.push({ slots: new Set(v.slots), ink: NDV.seals[v.pub] ? NDV.seals[v.pub].ink : null });
  });
  if (cols.indexOf(self) < 0) cols.push(self); // not reserved yet: last column
  NDV.cal.setOthers(cols);
  window.NoodleRoster.render(ndv$('nd-voters'), NDV.poll ? NDV.poll.voters : [], NDV.seals, pub);
  // the blocking name, for the reason under submit (ndvWhyNot)
  NDV.blocked = mine && mine.pub && pub && mine.pub !== pub ? mine.name : '';
  NDV.saved = mine && pub && mine.pub === pub ? new Set(mine.slots) : new Set();
  if (NDV.blocked) {
    ndvStatus('');
  } else if (mine && pub && mine.pub === pub) {
    if (NDV.hasDraft) {
      ndvStatus('welcome back, ' + mine.name + '. your unsaved changes are kept -- reserve to seal them.');
    } else {
      NDV.cal.setSel(new Set(mine.slots));
      ndvStatus('welcome back, ' + mine.name + '. your picks are loaded.');
    }
  } else {
    ndvStatus('');
  }
  ndvSyncSubmit();
}

function ndvOnStart(info) {
  ndvSyncSubmit();
  var seal = ndv$('nd-seal');
  NDV.seal = null;
  if (!info) { NDV.salt = ''; window.NoodleSeal.paint(seal, null); ndvTeach('key', NDV_SIGN_WAIT); return; }
  NDV.salt = info.salt;
  seal.classList.add('pending');
  ndvTeach('...', NDV_SIGN_WAIT);
}

async function ndvOnDerived(d) {
  ndvTeach('key  (' + d.ms + ' ms)', NDV_SIGN_WAIT);
  var seal = ndv$('nd-seal');
  seal.classList.remove('pending');
  NDV.seal = await window.NoodleSeal.seal(d.pub);
  window.NoodleSeal.stamp(seal, NDV.seal);
  ndvRefreshBinding(d.pub);
  if (window.ndaLoadBudget) window.ndaLoadBudget(d.pub);
}

function ndvSaveIdentity() {
  try {
    localStorage.setItem(NDV_STORE, JSON.stringify({ name: ndv$('nd-name').value, pass: ndv$('nd-pass').value }));
  } catch (e) { /* storage blocked: the form just is not remembered */ }
}

function ndvRestoreIdentity() {
  try {
    var id = JSON.parse(localStorage.getItem(NDV_STORE) || 'null');
    if (id && typeof id.name === 'string') {
      ndv$('nd-name').value = id.name;
      ndv$('nd-pass').value = typeof id.pass === 'string' ? id.pass : '';
      return true;
    }
  } catch (e) { /* unreadable or blocked: start empty */ }
  return false;
}

// "<name>'s seal of approval", following the name field as it is typed.
function ndvSealCaption() {
  var name = ndv$('nd-name').value.trim().split(/\s+/).join(' ');
  var who = name ? name + "'s" : 'your';
  ndv$('nd-seal-cap').textContent = (NDV.blocked ? 'NOT ' : '') + who + ' seal of approval';
}

// No passphrase = the name alone decides the key, so say so plainly.
function ndvWarnEmpty() {
  var open = !!window.noodleNormName(ndv$('nd-name').value) && !ndv$('nd-pass').value;
  ndv$('nd-warn').hidden = !open;
}

// Names are lowercase as they are typed. Identity was ALREADY case-blind (the
// key is salted with, and the server binds by, the normalized name), so this
// changes no key and merges no one -- it just stops "Wai" and "wai" looking
// like two different people.
function ndvLowercaseName() {
  var el = ndv$('nd-name'), low = el.value.toLowerCase();
  if (low === el.value) return;
  var a = el.selectionStart, b = el.selectionEnd;
  el.value = low;
  if (a != null && low.length === el.value.length) el.setSelectionRange(a, b);
}

function ndvOnIdentityInput() {
  ndvLowercaseName();
  ndvSaveIdentity();
  ndvWarnEmpty();
  ndvSealCaption();
  NDV.blocked = '';
  NDV.keyError = false;
  NDV.kdf.input(ndv$('nd-name').value, ndv$('nd-pass').value);
  if (NDV.poll) ndvRefreshBinding(null);
}

// Tapping a face fills the name field with that voter's name, then moves on to
// the passphrase -- the one thing only they know.
function ndvPickFace(e) {
  var face = e.target.closest('.nd-face');
  if (!face) return;
  ndv$('nd-name').value = face.dataset.name;
  ndvOnIdentityInput();
  ndv$('nd-pass').focus();
}

function ndvApproved(seal) {
  var ov = ndv$('nd-approved');
  window.NoodleSeal.paint(ov.querySelector('.nd-seal'), seal);
  ov.hidden = false;
  ov.classList.remove('show');
  void ov.offsetWidth;
  ov.classList.add('show');
  setTimeout(function () { ov.hidden = true; ov.classList.remove('show'); }, 2200);
}

async function ndvPost(path, body) {
  var r = await fetch('/api/noodle/' + NDV.slug + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  var d;
  try { d = await r.json(); } catch (e) { d = { error: 'request failed (' + r.status + ')' }; }
  return { ok: r.ok, data: d };
}

async function ndvSubmit() {
  if (ndvWhyNot()) return;
  ndvSyncSubmit(true);
  var name = ndv$('nd-name').value, slots = Array.from(NDV.cal.getSel()).sort();
  var ts = Date.now() + NDV.skew;
  // keys written in sorted order: the same bytes noodle/sig.py canonical() builds
  var text = JSON.stringify({ name: name, poll: NDV.slug, slots: slots, ts: ts });
  try {
    var sig = await NDV.kdf.sign(text);
    var res = await ndvPost('/vote', { name: name, pub: NDV.kdf.pub(), slots: slots, ts: ts, sig: sig });
    if (!res.ok) { ndvStatus(res.data.error || 'could not reserve', 'err'); return; }
    ndvClearDraft();
    ndvTeach('key', NDV_SIGN_DONE);
    ndvApproved(NDV.seal);
    await ndvLoadPoll();
    ndvStatus('reserved. come back with the same name and passphrase to change it.');
  } catch (e) {
    ndvStatus('could not reserve: ' + e.message, 'err');
  } finally {
    ndvSyncSubmit();
  }
}

async function ndvLoadPoll() {
  var r = await fetch('/api/noodle/' + NDV.slug, { cache: 'no-store' });
  // The server's clock, from the Date header: a phone whose clock is minutes
  // off would otherwise have every signature refused as stale.
  var served = Date.parse(r.headers.get('date') || '');
  if (!isNaN(served)) NDV.skew = served - Date.now();
  NDV.poll = await r.json();
  NDV.seals = await window.NoodleRoster.seals(NDV.poll.voters);
  ndvRefreshBinding(ndvReady() ? NDV.kdf.pub() : null);
}

function ndvInit() {
  var root = ndv$('noodle');
  if (!root || !root.dataset.slug) return;
  NDV.slug = root.dataset.slug;
  NDV.kdfCfg = JSON.parse(root.dataset.kdf);
  NDV.cal = window.NoodleCal(ndv$('nd-cal'), {
    start: root.dataset.start, end: root.dataset.end, caption: ndv$('nd-caption'),
    onChange: ndvSaveDraft,
  });
  ndvRestoreDraft();
  ndv$('nd-ask').addEventListener('input', ndvSaveDraft);
  NDV.kdf = window.NoodleKdf({
    slug: NDV.slug, kdf: NDV.kdfCfg, workerUrl: root.dataset.worker,
    onStart: ndvOnStart, onDerived: ndvOnDerived,
    onError: function (msg) {
      NDV.keyError = true;
      ndvSyncSubmit();
      ndvStatus('could not make a key in this browser (' + msg + '). a current Safari, Chrome or Firefox is needed.', 'err');
    },
  });
  ndv$('nd-name').addEventListener('input', ndvOnIdentityInput);
  ndv$('nd-voters').addEventListener('click', ndvPickFace);
  ndv$('nd-pass').addEventListener('input', ndvOnIdentityInput);
  ndv$('nd-submit').addEventListener('click', ndvSubmit);
  ndvTeach('key', NDV_SIGN_WAIT);
  ndvSyncSubmit();
  ndvLoadPoll();
  if (ndvRestoreIdentity()) ndvOnIdentityInput();
}

ndvInit();
