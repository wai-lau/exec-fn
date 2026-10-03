// noodle voter page, the CORE: the page state (NDV), the banner, which voter
// the typed name and key are (ndvRefreshBinding), the calendar (ndvEnsureCal),
// loading the poll, and ndvInit -- which runs as this file loads, so every
// other noodle-*.js it calls is loaded BEFORE it (noodle-vote.html). The rest:
// noodle-identity.js (fields + key + seal), noodle-commit.js (Commit),
// noodle-roster.js (the voters row), noodle-storage.js (localStorage),
// noodle-ask.js, noodle-host.js, noodle-rekey.js, noodle-crop.js, noodle-top.js.
// The passphrase never leaves the browser: it goes to the key worker
// (noodle-kdf-worker.js) and nowhere else; the server receives the public key,
// the slots and a signature over them.

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

function ndvReady() { return !!NDV.kdf && NDV.kdf.ready(); }

// This voter's key as the server knows it (the old one mid passphrase change).
function ndvPub() {
  var p = ndvReady() ? NDV.kdf.pub() : null;
  return window.ndrAs ? window.ndrAs(p) : p;
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
  if (window.ndvPaintStep) window.ndvPaintStep();   // and only on the PICK step (noodle-identity.js)
  var locked = !!NDV.blocked, open = NDV.step === 'pick' && ndvReady() && !locked && !(NDV.held && !NDV.mine);
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
  NDV.saved = NDV.mine ? ndvPresent(mine.slots) : new Set();
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

// A stored vote as the page shows it: under an unsaved split change it is
// converted the way the server will convert it on Commit (a whole day counts
// as BOTH halves), so nobody's dots vanish when the box is ticked.
function ndvShown(slots) {
  var set = new Set(slots);
  return window.ndhHalves && window.ndhHalves() !== !!(NDV.poll && NDV.poll.halves)
    ? ndhConvert(set, window.ndhHalves()) : set;
}

// Slots from today on: a past day is unavailable (the calendar drops it too,
// NoodleCal setSel), so a stored pick on one is not an unsaved change.
function ndvPresent(slots) {
  var today = window.NoodleCalParts.iso(new Date());
  return new Set(slots.filter(function (s) { return s.slice(0, 10) >= today; }));
}

// The first and last day the host offers, or null before they offer any.
function ndvOfferSpan(p) {
  var days = p.voters.length ? p.voters[0].slots.map(function (s) { return s.slice(0, 10); }).sort() : [];
  return days.length ? { from: days[0], to: days[days.length - 1] } : null;
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
  if (slot && slot.parentNode !== ndv$('nd-pick')) ndv$('nd-cal').before(slot);
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
    ? { slug: NDV.slug, title: 'title', halves: false, crop: null, voters: [], host: null }
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
  ndvStepInit();
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
  ndvSyncSubmit();
  // a reload mid-fetch rejects it ('Load failed'); say so rather than throw
  ndvLoadPoll().catch(function (e) {
    // where, too: a bare message is all a report from someone else's phone carries
    var at = String(e.stack || '').split('\n').slice(1, 2).join('').trim();
    ndvStatus('could not load the poll (' + e.message + (at ? ' ' + at : '') + ')', 'err');
  });
  // a saved identity that unlocks goes straight to the pick (ndvPaintStep)
  if (ndvRestoreIdentity()) { NDV.autoStep = true; ndvOnIdentityInput(); }
}

window.ndvOnIdentityInput = ndvOnIdentityInput;
ndvInit();
