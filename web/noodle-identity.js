// noodle's IDENTITY block: the name + passphrase fields (cleaned as typed),
// the key worker's callbacks (ndvOnStart / ndvOnDerived), the seal and its
// caption, the empty-passphrase warning, and the dotted teaching box. Same
// global scope as noodle-vote.js; loaded before it, called once it has run.

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
