// noodle's IDENTITY block: the name + passphrase fields (cleaned as typed),
// the key worker's callbacks (ndvOnStart / ndvOnDerived), the seal and its
// caption, the empty-passphrase warning, and the you -> pick step. Same
// global scope as noodle-vote.js; loaded before it, called once it has run.

function ndvOnStart(info) {
  ndvSyncSubmit();
  var seal = ndv$('nd-seal');
  if (NDV.seal) NDV.lastSeal = NDV.seal;
  NDV.seal = null;
  if (!info) { NDV.salt = ''; window.NoodleSeal.paint(seal, null); return; }
  NDV.salt = info.salt;
  seal.classList.add('pending');
}

async function ndvOnDerived(d) {
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
  // the seal shows once there is a name to seal (the argon2id recipe box that
  // framed it went 2026-10-03: jargon beside the one thing to do, type a name)
  ndv$('nd-seal-row').hidden = !name;
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
  NDV.step = 'you';   // a different identity: back to the YOU step
  ndv$('nd-name').value = face.dataset.name;
  ndvOnIdentityInput();
  ndv$('nd-pass').focus();
}

// ONE section edits at a time (feedback 2026-10-03: the whole page open at
// once was overwhelming): YOU (name + passphrase), then the PICK (calendar,
// Ask, Commit, and the host's title + note). On the pick step YOU folds to
// one line, "you are <name> [edit]"; on the you step the pick stays in view,
// grey and read-only (ndvSyncLock), so the results can still be read. A
// returning voter whose saved identity unlocks skips straight to the pick.
// Why "next" cannot be pressed, or '' when it can -- shown above it, like
// Commit's reason (ndvWhyNot): a grey button with no reason reads as broken.
// A key still being made does NOT hold it: the pick unlocks when it lands.
function ndvNextWhy() {
  var raw = ndv$('nd-name').value;
  if (!raw.trim()) return 'enter your name first';
  if (!window.noodleNormName(raw)) return 'that name is too long, or has characters that cannot be used';
  if (NDV.blocked) return '"' + NDV.blocked + '" is already sealed with a different passphrase';
  if (NDV.taken) return '"' + NDV.taken + '" is already taken';
  if (NDV.keyError) return 'this browser could not make a key';
  return '';
}

function ndvCanNext() { return !ndvNextWhy(); }

function ndvStep(step) {
  NDV.step = step;
  NDV.autoStep = false;
  ndvSyncSubmit();   // runs ndvSyncLock, which paints the step
  if (window.ndhSync && NDV.poll) window.ndhSync(ndvReady() ? ndvPub() : null);   // the title's edit marks
}

// Called from ndvSyncLock on every state change: a name that turns out to be
// someone else's sends the voter back to YOU, where the fix is.
function ndvPaintStep() {
  var was = NDV.step;
  if (NDV.step === 'pick' && (NDV.blocked || NDV.keyError || !window.noodleNormName(ndv$('nd-name').value))) NDV.step = 'you';
  if (NDV.autoStep && NDV.poll && ndvReady() && !NDV.blocked && !(NDV.held && !NDV.mine)) {
    NDV.autoStep = false;
    NDV.step = 'pick';
  }
  var pick = NDV.step === 'pick', you = ndv$('nd-you-name');
  ndv$('noodle').classList.toggle('nd-step-pick', pick);
  ndv$('nd-next-why').textContent = ndvNextWhy();
  ndv$('nd-next').disabled = !ndvCanNext();
  ndv$('nd-next').textContent = window.ndxIsHost && window.ndxIsHost() ? 'next: offer times' : 'next: pick times';
  you.textContent = window.noodleNormName(ndv$('nd-name').value);
  if (NDV.seal) you.style.setProperty('--seal-hsl', NDV.seal.ink); else you.style.removeProperty('--seal-hsl');
  ndv$('nd-submit').inert = !pick;
  if (was !== NDV.step && window.ndhRole) ndhTitleMarks(ndhRole(ndvReady() ? ndvPub() : null));
}

// wired by ndvInit: this file loads before NDV exists (noodle-vote.js)
function ndvStepInit() {
  NDV.step = 'you';
  ndv$('nd-next').addEventListener('click', function () { if (ndvCanNext()) ndvStep('pick'); });
  ndv$('nd-you-edit').addEventListener('click', function () { ndvStep('you'); ndv$('nd-name').focus(); });
  // Enter in either field is "next"
  ['nd-name', 'nd-pass'].forEach(function (id) {
    ndv$(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && ndvCanNext()) { e.preventDefault(); ndv$(id).blur(); ndvStep('pick'); }
    });
  });
}
