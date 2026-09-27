// Noodle voter page: identity -> key -> seal, the calendar, and the signed
// submit (Ask Noodle lives in noodle-ask.js). The passphrase never leaves the
// browser: it goes to the key worker (noodle-kdf-worker.js) and nowhere else;
// the server receives the public key, the slots and a signature over them.

var NDV = { poll: null, cal: null, calKey: null, kdf: null, skew: 0, blocked: '', keyError: false, salt: '', seals: {},
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
  if (!NDV.cal) return;
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
    NDV.draftRestored = true;   // the host default must not overwrite a draft someone left
  } catch (e) { /* unreadable: start clean */ }
}

function ndvClearDraft() {
  try { localStorage.removeItem(ndvDraftKey()); } catch (e) { /* ignore */ }
  NDV.hasDraft = false;
}

function ndv$(id) { return document.getElementById(id); }

// Errors go to the banner at the top of the page (ndvBanner); everything
// else to the status line above the calendar. A new message of either kind
// replaces an old error; clearing the status line ('') does not, since the
// page clears it on every reload of the poll.
function ndvStatus(msg, kind) {
  if (kind === 'err') { ndvBanner(msg); msg = ''; } else if (msg) ndvBanner('');
  ndv$('nd-status').textContent = msg || '';
}

function ndvBanner(msg) {
  var el = ndv$('nd-banner');
  el.textContent = msg || '';
  el.hidden = !msg;
}

var NDV_SIGN_WAIT = 'commit() ──> stamp(availabilities, seal)';
var NDV_SIGN_DONE = 'commit() ──> stamp(availabilities, seal) ──> sealed';

// The recipe, not the values: the salt ties the key to the name and the
// poll, so one passphrase gives a different key to every name in every poll.
// The argon2id line's arrow STRETCHES to two spaces short of the seal beside
// the box (.nd-arrow), so it points at the face the passphrase produced.
function ndvTeach(tail, signLine) {
  var el = ndv$('nd-teach');
  el.innerHTML = '<div>salt = sha256(poll, name)</div>' +
    '<div class="nd-arrow-line"><span>seal = argon2id(passphrase, salt)' + (tail ? ' ' + tail : '') + '</span>' +
    '<span class="nd-arrow" aria-hidden="true"><span class="nd-arrow-shaft"></span>&gt;</span></div>' +
    '<div class="nd-sign"></div>';
  el.querySelector('.nd-sign').textContent = signLine;
}

function ndvReady() { return !!NDV.kdf && NDV.kdf.ready(); }

// This voter's key as the server knows it (the old one mid passphrase change).
function ndvPub() {
  var p = ndvReady() ? NDV.kdf.pub() : null;
  return window.ndrAs ? window.ndrAs(p) : p;
}

// Why submit cannot be pressed right now, or '' when it can. A disabled
// button with no reason reads as broken.
function ndvWhyNot() {
  var raw = ndv$('nd-name').value;
  if (!raw.trim()) return 'enter your name first.';
  if (!window.noodleNormName(raw)) return 'that name is too long, or has characters that cannot be used.';
  if (NDV.blocked) return '"' + NDV.blocked + '" is already sealed with a different passphrase.';
  if (NDV.taken) return '"' + NDV.taken + '" is already taken.';
  if (NDV.keyError) return 'this browser could not make a key.';
  if (!ndvReady()) return 'making your key...';
  return '';
}

// Unsaved = the calendar differs from what the server holds for THIS key
// (nothing, for someone who has not committed yet).
function ndvDirty() {
  if (!NDV.cal) return false;
  if (NDV.pendingHalves != null) return true;   // an unsaved split
  if (NDV.pendingCrop !== undefined) return true;   // an unsaved crop
  if (NDV.pendingTitle !== undefined) return true;  // an unsaved title
  if (window.NDR && NDR.active) return true;    // an unsaved new name or passphrase
  var sel = NDV.cal.getSel(), saved = NDV.saved;
  if (sel.size !== saved.size) return true;
  for (var s of sel) if (!saved.has(s)) return true;
  return false;
}

function ndvSyncSubmit(busy) {
  var why = busy ? 'committing...' : ndvWhyNot(), dirty = ndvDirty();
  var btn = ndv$('nd-submit');
  btn.disabled = !!why;
  btn.textContent = dirty ? 'Commit*' : 'Commit';
  ndv$('nd-dirty').hidden = !dirty;
  ndv$('nd-why').textContent = why;
  ndvSyncLock();
  if (window.ndrSync) window.ndrSync();
}

// A name sealed by ANOTHER key locks everything but the identity fields (and
// the faces, which are a way to pick a different name): the calendar, its
// toggles, Ask and Commit go grey and inert. Editing the name to one nobody
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
  if (window.ndrAs) pub = window.ndrAs(pub);   // mid change: still the old key
  var typed = window.noodleNormName(ndv$('nd-name').value), mine = null, cols = [];
  var changing = !!(window.NDR && NDR.active);
  // mid change the page is still the OLD name; the typed one is the new name
  var norm = changing ? window.noodleNormName(NDR.oldName) : typed;
  NDV.taken = '';
  var self = { self: true, ink: NDV.seal ? NDV.seal.ink : null };
  (NDV.poll ? NDV.poll.voters : []).forEach(function (v) {
    if (norm && window.noodleNormName(v.name) === norm) mine = v;
    else if (changing && typed && window.noodleNormName(v.name) === typed) NDV.taken = typed;
    // your own committed column shows your LIVE picks instead of the stored vote
    if (pub && v.pub === pub) cols.push(self);
    else cols.push({ slots: ndvShown(v.slots), ink: NDV.seals[v.pub] ? NDV.seals[v.pub].ink : null });
  });
  if (cols.indexOf(self) < 0) cols.push(self); // not committed yet: last column
  // The host sets the dates; everyone else picks only from the host's slots.
  // The host (by KEY) gets the whole window.
  var host = NDV.poll && NDV.poll.voters.length ? NDV.poll.voters[0] : null;
  var iHost = !!(host && pub && host.pub === pub);
  if (NDV.cal) {
    NDV.cal.setOthers(cols);
    NDV.cal.setAllowed(host && !iHost ? host.slots : null, !!pub);
  }
  if (window.ndhSync) window.ndhSync(pub);
  // becoming (or ceasing to be) the host changes the calendar: endless with
  // crop handles, or just the crop. ndvEnsureCal returns at once if not.
  if (!NDV.inEnsure) { NDV.inEnsure = true; ndvEnsureCal(); NDV.inEnsure = false; }
  // the blocking name, for the reason under submit (ndvWhyNot)
  NDV.blocked = mine && mine.pub && pub && mine.pub !== pub ? mine.name : '';
  NDV.mine = !!(mine && pub && mine.pub === pub);
  NDV.saved = NDV.mine ? new Set(mine.slots) : new Set();
  ndvRenderRoster(pub, iHost, typed);
  ndvHostDefault();
  if (NDV.blocked) {
    ndvStatus('');
  } else if (mine && pub && mine.pub === pub) {
    if (NDV.hasDraft) {
      ndvStatus('welcome back, ' + mine.name + '. your unsaved changes are kept -- commit to seal them.');
    } else if (NDV.cal) {
      NDV.cal.setSel(new Set(mine.slots));
      ndvStatus('welcome back, ' + mine.name + '. your picks are loaded.');
    }
  } else {
    ndvStatus('');
  }
  ndvSyncSubmit();
}

// A HOST starts with every day inside the crop AVAILABLE, and unpicks what
// is not: offering most of a range is the common case, and it is what every
// guest picks from. Only for a host with nothing committed and no draft --
// once, never over their own choices.
function ndvHostDefault() {
  if (NDV.defaulted || !NDV.cal || NDV.draftRestored || NDV.mine || !window.ndxIsHost || !window.ndxIsHost()) return;
  var rows = NDV.cal.rows();
  if (!rows.length || !window.NDX) return;
  NDV.defaulted = true;
  NDV.cal.setSel(NDV.cal.openSlots(NDV.cal.weekOf(NDX.a)[0], NDV.cal.weekOf(Math.min(NDX.b, rows.length - 1))[6]));
}

// Does the typed name belong to a voter already? (Then it is not a new seat.)
function ndvNameTaken(typed) {
  return !!typed && (NDV.poll ? NDV.poll.voters : []).some(function (v) {
    return window.noodleNormName(v.name) === typed;
  });
}

// The "could be you" seat's seal: random, made ONCE per browser and kept, so
// the placeholder face is the same every visit instead of reshuffling.
var NDV_BLANK = '__could_be_you__';
function ndvBlankSeal() {
  var k = 'noodle.blankSeal', id = null;
  try { id = localStorage.getItem(k); } catch (e) { /* blocked: a fresh one each load */ }
  // a seed is 32 bytes (64 hex); a shorter one (an early version stored 16)
  // reads past its end in the seal and throws, so it is replaced
  if (!/^[0-9a-f]{64}$/.test(id || '')) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    try { localStorage.setItem(k, id); } catch (e) { /* not kept */ }
  }
  // the seal is drawn from 32 fingerprint bytes; these simply ARE them
  return window.NoodleSeal.fromFp(new Uint8Array(id.match(/../g).map(function (h) { return parseInt(h, 16); })));
}

// A stored vote as the page shows it: under an unsaved split change it is
// converted the way the server will convert it on Commit (a whole day counts
// as BOTH halves), so nobody's dots vanish when the box is ticked.
function ndvShown(slots) {
  var set = new Set(slots);
  return window.ndhHalves && window.ndhHalves() !== !!(NDV.poll && NDV.poll.halves)
    ? ndhConvert(set, window.ndhHalves()) : set;
}

// The voters, plus -- for a key that has not committed under this name yet --
// YOUR face as it would join them, redrawn whenever the seal changes. Mid
// change (noodle-rekey.js) your own face already wears the NEW seal and name.
function ndvRenderRoster(pub, iHost, typed) {
  var voters = NDV.poll ? NDV.poll.voters : [], seals = NDV.seals;
  if (NDV.mine && window.NDR && NDR.active) {
    // mid change: your own face, with the name being typed and the newest seal
    // (the last one while the next derives) -- never the empty seat
    seals = Object.assign({}, seals);
    if (NDV.seal || NDV.lastSeal) seals[pub] = NDV.seal || NDV.lastSeal;
    voters = voters.map(function (v) { return v.pub === pub && typed ? Object.assign({}, v, { name: typed }) : v; });
  } else if (pub && typed && NDV.seal && !NDV.mine && !NDV.blocked) {
    seals = Object.assign({}, seals);
    seals[pub] = NDV.seal;
    voters = voters.concat([{ name: typed, pub: pub, slots: [], order: voters.length, pending: true }]);
  } else if (!(pub && NDV.seal) && !ndvNameTaken(typed) && NDV.blankSeal) {
    // an unmatched name with no seal yet (none typed, or the key still
    // deriving): a seat saying so, wearing this browser's placeholder seal
    seals = Object.assign({}, seals);
    seals[NDV_BLANK] = NDV.blankSeal;
    voters = voters.concat([{ name: 'could be you', pub: NDV_BLANK, slots: [], order: voters.length,
      pending: true, blank: true }]);
  }
  window.NoodleRoster.render(ndv$('nd-voters'), voters, seals, pub, iHost);
}

function ndvOnStart(info) {
  ndvSyncSubmit();
  var seal = ndv$('nd-seal');
  if (NDV.seal) NDV.lastSeal = NDV.seal;
  NDV.seal = null;
  if (!info) { NDV.salt = ''; window.NoodleSeal.paint(seal, null); ndvTeach('', NDV_SIGN_WAIT); return; }
  NDV.salt = info.salt;
  seal.classList.add('pending');
  ndvTeach('', NDV_SIGN_WAIT);
}

async function ndvOnDerived(d) {
  ndvTeach('', NDV_SIGN_WAIT);
  var seal = ndv$('nd-seal');
  seal.classList.remove('pending');
  NDV.seal = await window.NoodleSeal.seal(d.pub);
  window.NoodleSeal.stamp(seal, NDV.seal);
  ndvRefreshBinding(d.pub);
}

function ndvSaveIdentity() {
  if (window.NDR && NDR.active) return;   // the new passphrase is kept only once committed
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
function ndvCleanFields() {
  ndvKeepOnly(ndv$('nd-name'), true);
  ndvKeepOnly(ndv$('nd-pass'), false);
}

// Name and passphrase take ASCII letters, digits and spaces only (the server
// refuses any other name); anything else is dropped as it is typed, keeping
// the caret where it was.
function ndvKeepOnly(el, lower) {
  var v = el.value.replace(/[^A-Za-z0-9 ]/g, '');
  if (lower) v = v.toLowerCase();
  if (v === el.value) return;
  var cut = el.value.length - v.length, a = el.selectionStart;
  el.value = v;
  if (a != null) el.setSelectionRange(Math.max(0, a - cut), Math.max(0, a - cut));
}

function ndvOnIdentityInput() {
  ndvCleanFields();
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
  if (!face || !face.dataset.name || (window.NDR && NDR.active)) return;   // 'could be you' fills nothing
  ndv$('nd-name').value = face.dataset.name;
  ndvOnIdentityInput();
  ndv$('nd-pass').focus();
}

function ndvApproved(seal, name) {
  var ov = ndv$('nd-approved');
  ov.querySelector('.nd-approved-by').textContent = 'approved by ' + name;
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
  try {
    // a new name/passphrase first (the rest is signed by it), then a pending
    // split/crop (it converts every stored vote); each request is signed
    // strictly newer, as the server's replay check demands
    var rk = await ndrCommit(ts);
    if (!rk.ok) { ndvStatus(rk.data.error || 'could not make the change', 'err'); return; }
    if (rk.did) ts += 1;
    var set = await ndhCommitSettings(ts);
    if (!set.ok) { ndvStatus(set.data.error || 'could not save the split, crop or title', 'err'); return; }
    if (set.sent) ts += 1;
    // keys written in sorted order: the same bytes noodle/sig.py canonical() builds
    var text = JSON.stringify({ name: name, poll: NDV.slug, slots: slots, ts: ts });
    var sig = await NDV.kdf.sign(text);
    var res = await ndvPost('/vote', { name: name, pub: NDV.kdf.pub(), slots: slots, ts: ts, sig: sig });
    if (!res.ok) { ndvStatus(res.data.error || 'could not commit', 'err'); return; }
    ndvClearDraft();
    ndvTeach('', NDV_SIGN_DONE);
    ndvApproved(NDV.seal, window.noodleNormName(name));
    await ndvLoadPoll();
    ndvStatus('committed. come back with the same name and passphrase to change it.');
  } catch (e) {
    ndvStatus('could not commit: ' + e.message, 'err');
  } finally {
    ndvSyncSubmit();
  }
}

// The calendar is endless; what shapes it is the poll's SPLIT (whole days or
// midday + night) and the HOST's crop: a guest's calendar is just the crop,
// the host's stays endless with the crop handles on it (noodle-crop.js) and
// the days outside greyed. Rebuilt only when one of those changes (or when
// forced), keeping picks and the scroll position.
function ndvEnsureCal(force) {
  var p = NDV.poll;
  if (!p) return;
  var host = window.ndxIsHost ? window.ndxIsHost() : false, c = window.ndhCrop ? window.ndhCrop() : p.crop;
  var halves = window.ndhHalves ? window.ndhHalves() : p.halves;
  var key = halves + '|' + host + '|' + (c ? c.from + '..' + c.to : '');
  if (key === NDV.calKey && !force) return;
  var keep = NDV.cal ? NDV.cal.getSel() : null;
  var scroll = NDV.cal ? NDV.cal.scroller.scrollTop : 0;
  // days the crop now leaves out are deselected, as the server drops them
  if (keep && c) keep = new Set(Array.from(keep).filter(function (s) { return c.from <= s.slice(0, 10) && s.slice(0, 10) <= c.to; }));
  NDV.calKey = key;
  NDV.cal = window.NoodleCal(ndv$('nd-cal'), { halves: halves, crop: c, endless: host,
    onChange: ndvSaveDraft, onRows: function () { if (window.ndxSync) window.ndxSync(); } });
  if (keep) { NDV.cal.setSel(keep); ndvSaveDraft(); } else ndvRestoreDraft();
  // grow back to where the reader was (a rebuild starts with a few weeks)
  for (var i = 0; i < 20 && NDV.cal.scroller.scrollHeight < scroll + NDV.cal.scroller.clientHeight; i++) NDV.cal.more();
  NDV.cal.scroller.scrollTop = scroll;
  if (window.ndxSync) window.ndxSync();
  if (NDV.poll) ndvRefreshBinding(ndvPub());
}

async function ndvLoadPoll() {
  var r = await fetch('/api/noodle/' + NDV.slug, { cache: 'no-store' });
  // The server's clock, from the Date header: a phone whose clock is minutes
  // off would otherwise have every signature refused as stale.
  var served = Date.parse(r.headers.get('date') || '');
  if (!isNaN(served)) NDV.skew = served - Date.now();
  NDV.poll = await r.json();
  NDV.seals = await window.NoodleRoster.seals(NDV.poll.voters);
  if (!NDV.blankSeal) NDV.blankSeal = ndvBlankSeal();
  ndvEnsureCal();
  ndvRefreshBinding(ndvPub());
}

function ndvInit() {
  var root = ndv$('noodle');
  if (!root || !root.dataset.slug) return;
  NDV.slug = root.dataset.slug;
  NDV.kdfCfg = JSON.parse(root.dataset.kdf);
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
  // any promise nobody caught (a request cut off by a reload is WebKit's
  // 'Load failed') is an error like any other: to the banner, not the console
  window.addEventListener('unhandledrejection', function (e) {
    ndvStatus('something failed: ' + ((e.reason && e.reason.message) || e.reason), 'err');
    e.preventDefault();
  });
  ndvTeach('', NDV_SIGN_WAIT);
  ndvSyncSubmit();
  // a reload mid-fetch rejects it ('Load failed'); say so rather than throw
  ndvLoadPoll().catch(function (e) {
    // where, too: a bare message is all a report from someone else's phone carries
    var at = String(e.stack || '').split('\n').slice(1, 2).join('').trim();
    ndvStatus('could not load the poll (' + e.message + (at ? ' ' + at : '') + ')', 'err');
  });
  if (ndvRestoreIdentity()) ndvOnIdentityInput();
}

window.ndvOnIdentityInput = ndvOnIdentityInput;
ndvInit();
