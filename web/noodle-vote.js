// noodle voter page: identity -> key -> seal, the calendar, and the signed
// submit (Ask noodle lives in noodle-ask.js). The passphrase never leaves the
// browser: it goes to the key worker (noodle-kdf-worker.js) and nowhere else;
// the server receives the public key, the slots and a signature over them.

var NDV = { poll: null, cal: null, calKey: null, kdf: null, skew: 0, blocked: '', keyError: false, salt: '', seals: {},
  saved: new Set() };

function ndv$(id) { return document.getElementById(id); }

// Errors go to the banner at the top of the page (ndvBanner). Anything else
// only clears an old error: the chatty status line above the calendar (welcome
// back, committed, ...) said nothing the page did not already show, and went.
function ndvStatus(msg, kind) {
  if (kind === 'err') ndvBanner(msg); else if (msg) ndvBanner('');
}

function ndvBanner(msg) {
  var el = ndv$('nd-banner');
  el.textContent = msg || '';
  el.hidden = !msg;
}

var NDV_SIGN_WAIT = 'commit ──> stamp(data, seal)';
var NDV_SIGN_DONE = 'commit ──> stamp(data, seal) ──> sealed';

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
  if (!raw.trim()) return 'enter your name first';
  if (!window.noodleNormName(raw)) return 'that name is too long, or has characters that cannot be used';
  if (NDV.blocked) return '"' + NDV.blocked + '" is already sealed with a different passphrase';
  if (NDV.taken) return '"' + NDV.taken + '" is already taken';
  if (NDV.keyError) return 'this browser could not make a key';
  if (!ndvReady()) return 'making your key...';
  // the host's picks ARE the offer: committing none would leave guests nothing
  if (window.ndxIsHost && window.ndxIsHost() && NDV.cal && !NDV.cal.getSel().size) {
    return 'pick at least one available time, guests can only pick from yours';
  }
  return '';
}

// Unsaved = the calendar differs from what the server holds for THIS key
// (nothing, for someone who has not committed yet).
function ndvDirty() {
  if (!NDV.cal) return false;
  if (NDV.pendingHalves != null) return true;   // an unsaved split
  if (NDV.pendingCrop !== undefined) return true;   // an unsaved crop
  if (NDV.pendingTitle !== undefined) return true;  // an unsaved title
  if (NDV.pendingNote !== undefined) return true;   // an unsaved note
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
  // unsaved -> "* unsaved changes"; nothing unsaved on a committed vote ->
  // "all changes saved"; nothing committed yet -> no line at all
  var el = ndv$('nd-dirty');
  el.hidden = !dirty && !NDV.mine;
  el.textContent = dirty ? '* unsaved changes' : 'all changes saved';
  el.classList.toggle('saved', !dirty);
  ndv$('nd-why').textContent = why;
  ndvSyncLock();
  if (window.ndrSync) window.ndrSync();
}

// A name sealed by ANOTHER key locks everything but the identity fields (and
// the faces, which are a way to pick a different name): the calendar, its
// toggles, Ask and Commit go grey and inert. Editing the name to one nobody
// holds re-derives the key and unlocks it -- NDV.blocked is recomputed then.
// And whether the calendar and Ask take input at all: only once the key is
// made AND, for a name already on the poll, it is that name's key. Before
// that the calendar is read-only -- it still SCROLLS (so no `inert`), but taps
// and crop drags do nothing (.nd-readonly, checked by noodle-cal-view.js and
// noodle-crop.js). Typing a voter's name used to flash the grid editable for
// the second the key took to derive.
function ndvSyncLock() {
  var locked = !!NDV.blocked, open = ndvReady() && !locked && !(NDV.held && !NDV.mine);
  ndv$('noodle').classList.toggle('nd-locked', locked);
  ndv$('noodle').classList.toggle('nd-off', !open);
  ndv$('nd-cal').classList.toggle('nd-readonly', !open);
  ndv$('nd-ask').closest('.nd-ask').inert = !open;
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
    NDV.cols = cols;
    if (window.ndtRender) window.ndtRender(cols, NDV.cal.getSel());   // the top dates (noodle-top.js)
    NDV.cal.setAllowed(host && !iHost ? host.slots : null, !!pub);
  }
  if (window.ndhSync) window.ndhSync(pub);
  // the link is worth sharing only once the host has offered something
  ndv$('nd-share').hidden = !(host && host.slots.length);
  // becoming (or ceasing to be) the host changes the calendar: endless with
  // crop handles, or just the crop. ndvEnsureCal returns at once if not.
  if (!NDV.inEnsure) { NDV.inEnsure = true; ndvEnsureCal(); NDV.inEnsure = false; }
  // the blocking name, for the reason under submit (ndvWhyNot)
  NDV.blocked = mine && mine.pub && pub && mine.pub !== pub ? mine.name : '';
  NDV.mine = !!(mine && pub && mine.pub === pub);
  NDV.held = !!(mine && mine.pub);   // the typed name belongs to someone
  NDV.saved = NDV.mine ? new Set(mine.slots) : new Set();
  // a NEW name: its own draft if it left one, else a clean calendar -- never
  // the picks the previous name had on screen
  var dk = ndvDraftKey();
  if (dk && dk !== NDV.draftFor && NDV.cal) {
    NDV.draftFor = dk;
    NDV.hasDraft = false;
    if (!NDV.mine) NDV.cal.setSel(new Set());
    ndvRestoreAsk();   // the Ask text is per name too
    ndvRestoreDraft();
  }
  ndvRenderRoster(pub, iHost, typed);
  // your seal matches: your SAVED picks fill the calendar (unless this identity
  // left unsaved changes) -- and the first time it matches, they are pulled
  // fresh from the server, since the copy loaded with the page may be older
  // than a vote made since from another device
  if (NDV.mine && !NDV.hasDraft && NDV.cal) NDV.cal.setSel(new Set(mine.slots));
  if (NDV.mine && dk && NDV.pulledFor !== dk) {
    NDV.pulledFor = dk;
    ndvLoadPoll();
  }
  ndvSyncSubmit();
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

// "<name>'s seal of approval", following the name field as it is typed.
// It claims the seal only once the seal is MADE and is that name's: while
// the key computes, or for a voter's name not yet unlocked, it says so.
function ndvSealCaption() {
  var name = ndv$('nd-name').value.trim().split(/\s+/).join(' '), cap = ndv$('nd-seal-cap');
  if (NDV.blocked) cap.textContent = 'NOT ' + name + "'s seal of approval";
  else if (!name) cap.textContent = 'your seal of approval';
  else if (!ndvReady() || (NDV.held && !NDV.mine)) cap.textContent = 'checking the seal...';
  else cap.textContent = name + "'s seal of approval";
  // the passphrase is a choice for a new name, and the key to an existing one
  ndv$('nd-pass-label').textContent = 'passphrase (' + (NDV.held ? 'required' : 'optional') + ')';
  ndvWarnEmpty();   // who you are decides what the empty-passphrase warning says
}

// No passphrase = the name alone decides the key, so say so plainly.
// For the HOST it is worse: the host's key runs the whole poll.
function ndvWarnEmpty() {
  var open = !!window.noodleNormName(ndv$('nd-name').value) && !ndv$('nd-pass').value, el = ndv$('nd-warn');
  el.hidden = !open;
  el.textContent = window.ndxIsHost && window.ndxIsHost()
    ? 'no passphrase: anyone can change the entire poll, what a chaotic host'
    : 'no passphrase: anyone can change your vote';
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
  ndvOfferPass();
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
  if (!face || !face.dataset.name || (window.NDR && NDR.active)) return;   // the blank 'you' seat fills nothing
  ndv$('nd-name').value = face.dataset.name;
  ndvOnIdentityInput();
  ndv$('nd-pass').focus();
}

function ndvApproved(seal, name, copied) {
  var ov = ndv$('nd-approved');
  ov.querySelector('.nd-approved-by').textContent = 'approved by ' + name;
  ov.querySelector('.nd-approved-note').hidden = !copied;
  window.NoodleSeal.paint(ov.querySelector('.nd-seal'), seal);
  ov.hidden = false;
  ov.classList.remove('show');
  void ov.offsetWidth;
  ov.classList.add('show');
  setTimeout(function () { ov.hidden = true; ov.classList.remove('show'); }, 2200);
}

async function ndvPost(path, body) {
  // a draft's token rides along (never signed): the first commit creates the poll
  if (NDV.draft) body = Object.assign({ draft: NDV.draft }, body);
  var r = await fetch('/api/noodle/' + NDV.slug + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  var d;
  try { d = await r.json(); } catch (e) { d = { error: 'request failed (' + r.status + ')' }; }
  return { ok: r.ok, data: d };
}

async function ndvSubmit() {
  if (ndvWhyNot()) return;
  // the HOST's commit copies the poll's link for sending. Started HERE, in the
  // tap itself: Safari refuses a clipboard write that comes after the awaits
  // below (the tap's permission has lapsed by then)
  var copying = window.ndxIsHost && window.ndxIsHost() && navigator.clipboard
    ? navigator.clipboard.writeText(location.origin + '/noodle/' + NDV.slug).then(function () { return true; },
      function () { return false; })
    : Promise.resolve(false);
  ndvSyncSubmit(true);
  var name = ndv$('nd-name').value, slots = Array.from(NDV.cal.getSel()).sort();
  var ts = Date.now() + NDV.skew;
  try {
    // a new name/passphrase first (the rest is signed by it), then a pending
    // split/crop (it converts every stored vote); each request is signed
    // strictly newer, as the server's replay check demands
    var rk = await ndrCommit(ts);
    if (!rk.ok) { ndvStatus(rk.data.error || 'could not make the change', 'err'); await ndvLoadPoll(); return; }
    if (rk.did) ts += 1;
    var set = await ndhCommitSettings(ts);
    if (!set.ok) { ndvStatus(set.data.error || 'could not save the split, crop or title', 'err'); await ndvLoadPoll(); return; }
    if (set.sent) ts += 1;
    // keys written in sorted order: the same bytes noodle/sig.py canonical() builds
    var text = JSON.stringify({ name: name, poll: NDV.slug, slots: slots, ts: ts });
    // (every failure above reloads the poll: a refusal usually means someone
    // else changed it -- took the host role, moved the crop -- and the page
    // must show that rather than let the same Commit fail again)
    var sig = await NDV.kdf.sign(text);
    var res = await ndvPost('/vote', { name: name, pub: NDV.kdf.pub(), slots: slots, ts: ts, sig: sig });
    if (!res.ok) { ndvStatus(res.data.error || 'could not commit', 'err'); await ndvLoadPoll(); return; }
    ndvClearDraft();
    if (NDV.draft) {   // the poll exists now: its plain link is the one to keep
      NDV.draft = '';
      history.replaceState(null, '', '/noodle/' + NDV.slug);
    }
    ndvTeach('', NDV_SIGN_DONE);
    // never let the clipboard hold a commit up: some browsers leave the write
    // pending forever (no focus, no permission) -- 800ms, then carry on
    var copied = await Promise.race([copying, new Promise(function (r) { setTimeout(r, 800, false); })]);
    ndvApproved(NDV.seal, window.noodleNormName(name), copied);
    await ndvLoadPoll();
    ndvStatus('committed.');   // (clears a stale error)
    NDV.committed = (NDV.committed || 0) + 1;   // tests wait on this
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
  // a GUEST's calendar is only the weeks the host offered: never endless
  if (!host) c = ndvOfferSpan(p) || c;
  var halves = window.ndhHalves ? window.ndhHalves() : p.halves;
  var key = halves + '|' + host + '|' + (c ? c.from + '..' + c.to : '');
  if (key === NDV.calKey && !force) return;
  var keep = NDV.cal ? NDV.cal.getSel() : null;
  var scroll = NDV.cal ? NDV.cal.scroller.scrollTop : 0;
  // days the crop now leaves out are deselected, as the server drops them
  if (keep && c) keep = new Set(Array.from(keep).filter(function (s) { return c.from <= s.slice(0, 10) && s.slice(0, 10) <= c.to; }));
  NDV.calKey = key;
  // the split box lives INSIDE the grid (noodle-host.js ndhPlaceSplit); take it
  // out first, or rebuilding the grid would destroy it with the old rows
  var slot = ndv$('nd-split-slot');
  if (slot && slot.parentNode !== ndv$('noodle')) ndv$('nd-cal').before(slot);
  if (NDV.cal) NDV.cal.destroy();   // its observers, or they outlive the old grid
  NDV.cal = window.NoodleCal(ndv$('nd-cal'), { halves: halves, crop: c, endless: host,
    onChange: ndvSaveDraft, onRows: function () { if (window.ndxSync) window.ndxSync(); } });
  // a rebuild carries the picks over; it is not an edit, so it saves no draft
  // (an empty one saved here used to beat the voter's stored vote on return)
  if (keep) NDV.cal.setSel(keep); else ndvRestoreDraft();
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
  // a DRAFT (no poll stored yet, drafts.py): an empty poll stands in until the
  // host's first commit creates the real one
  NDV.poll = r.status === 404 && NDV.draft
    ? { slug: NDV.slug, title: 'untitled noodle', halves: false, crop: null, voters: [], host: null }
    : await r.json();
  NDV.seals = await window.NoodleRoster.seals(NDV.poll.voters);
  if (!NDV.blankSeal) NDV.blankSeal = ndvBlankSeal();
  ndvEnsureCal();
  ndvRefreshBinding(ndvPub());
}

function ndvInit() {
  var root = ndv$('noodle');
  if (!root || !root.dataset.slug) return;
  NDV.slug = root.dataset.slug;
  NDV.draft = root.dataset.draft || '';
  NDV.kdfCfg = JSON.parse(root.dataset.kdf);
  ndv$('nd-ask').addEventListener('input', ndvSaveAsk);
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
