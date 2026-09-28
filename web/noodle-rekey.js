// Changing your name or passphrase. A name is bound to the key its first
// commit was signed with, and the key is derived from the name AND the
// passphrase -- so either change means the OLD key signing a NEW public key
// (and the new name) over to the record (noodle/rekey.py).
//
// While the passphrase is the right one it is greyed and locked, and each
// field has a "change" button. Tapping one keeps the old name + passphrase in
// memory and unlocks that field (the passphrase is cleared, "new passphrase");
// the button becomes UNDO, which puts the old value back. A second worker
// re-derives the old key meanwhile so it can still sign. Commit carries the
// change -- there is no separate confirm. Until then nothing is sent and
// nothing is remembered: the page still answers as the old key (ndrAs), the
// identity is not saved, and a reload brings the old one back. Commit sends
// the rekey FIRST, then the split and the vote under the new key (ndvSubmit).

var NDR = { active: false, name: false, pass: false, oldName: '', oldPass: '', oldPub: null,
  keeper: null, keeperPub: null };
window.NDR = NDR;

var NDR_FIELDS = {
  // both hints depend on who is typing -- the host or a guest (see ndrHint)
  name: { input: 'nd-name', btn: 'nd-rename', newHint: 'new name' },
  pass: { input: 'nd-pass', btn: 'nd-rekey', newHint: 'new passphrase' },
};

function ndr$(id) { return document.getElementById(id); }

// The key the SERVER knows this voter by: the old one until the change commits.
// (Even while the new key is still deriving: the page never stops being you.)
function ndrAs(pub) { return NDR.active ? NDR.oldPub : pub; }

// "change" once the passphrase is right; "undo" while that field is changing.
// The passphrase itself is locked while right and not being changed.
function ndrSync() {
  if (!ndr$('nd-rekey')) return;
  Object.keys(NDR_FIELDS).forEach(function (k) {
    var f = NDR_FIELDS[k], btn = ndr$(f.btn), on = NDR[k];
    btn.hidden = !on && !NDV.mine;
    btn.textContent = on ? 'undo' : 'change';
    btn.setAttribute('aria-label', (on ? 'cancel the ' : 'change your ') + (k === 'name' ? 'name' : 'passphrase'));
    ndr$(f.input).placeholder = on ? f.newHint : ndrHint(k);
  });
  ndr$('nd-pass').disabled = !!NDV.mine && !NDR.pass;
}

// The resting hint for a field. A name already on the poll is being UNLOCKED;
// otherwise it is being made -- and the host is told what is at stake for them.
function ndrHint(k) {
  var host = window.ndxIsHost && window.ndxIsHost();
  if (k === 'name') return host ? 'how shall the guests address you, host?' : 'please help the host know who you are';
  if (NDV.held) return 'please enter your passphrase';
  return host ? "you'll NEED to remember this to control the poll" : "you'll need this to change your vote";
}

function ndrStop() {
  if (NDR.keeper) NDR.keeper.stop();
  NDR.keeper = null;
  NDR.keeperPub = null;
  NDR.active = NDR.name = NDR.pass = false;
}

// The first change of either field remembers who you were and starts
// re-deriving that key; a second field joins the same change.
function ndrBegin() {
  if (NDR.active) return;
  var root = ndr$('noodle'), cfg = Object.assign({}, NDV.kdfCfg, { debounce: 0 });
  NDR.active = true;
  NDR.oldName = ndr$('nd-name').value;
  NDR.oldPass = ndr$('nd-pass').value;
  NDR.oldPub = NDV.kdf.pub();
  NDR.keeperPub = new Promise(function (resolve, reject) {
    NDR.keeper = window.NoodleKdf({ slug: NDV.slug, kdf: cfg, workerUrl: root.dataset.worker,
      onStart: function () {}, onDerived: function (d) { resolve(d.pub); }, onError: reject });
  });
  NDR.keeperPub.catch(function () {});   // surfaced at Commit, not as an unhandled rejection
  NDR.keeper.input(NDR.oldName, NDR.oldPass);
}

function ndrStart(k) {
  ndrBegin();
  NDR[k] = true;
  var el = ndr$(NDR_FIELDS[k].input);
  el.disabled = false;
  if (k === 'pass') el.value = '';
  window.ndvOnIdentityInput();
  el.focus();
  if (k === 'name') el.select();
}

function ndrCancel(k) {
  var old = k === 'name' ? NDR.oldName : NDR.oldPass;
  NDR[k] = false;
  if (!NDR.name && !NDR.pass) ndrStop();
  ndr$(NDR_FIELDS[k].input).value = old;
  window.ndvOnIdentityInput();
}

function ndrClick(k) {
  return function () { if (NDR[k]) ndrCancel(k); else ndrStart(k); };
}

// Part of Commit: hand the record to the new key (and name), signed by the
// old key. -> {ok, did} ; did = a rekey was sent, so the next request needs a
// newer ts.
async function ndrCommit(ts) {
  if (!NDR.active) return { ok: true };
  var newpub = NDV.kdf.pub(), newname = ndr$('nd-name').value, name = NDR.oldName;
  if (newpub === NDR.oldPub) { ndrStop(); return { ok: true }; }   // the same name and passphrase again
  try {
    if ((await NDR.keeperPub) !== NDR.oldPub) throw new Error('the old key did not re-derive');
    var sig = await NDR.keeper.sign(ndhCanon({ kind: 'rekey', name: name, newname: newname,
      newpub: newpub, poll: NDV.slug, ts: ts }));
    var res = await ndvPost('/rekey', { name: name, pub: NDR.oldPub, ts: ts, sig: sig,
      newpub: newpub, newname: newname });
    if (!res.ok) return res;
  } catch (e) {
    return { ok: false, data: { error: 'could not make the change: ' + e.message } };
  }
  ndrStop();
  ndvSaveIdentity();   // only now does the new name/passphrase become the remembered one
  return { ok: true, did: true };
}

(function () {
  if (!ndr$('nd-rekey')) return;
  ndr$('nd-rekey').addEventListener('click', ndrClick('pass'));
  ndr$('nd-rename').addEventListener('click', ndrClick('name'));
  window.ndrAs = ndrAs;
  window.ndrSync = ndrSync;
  window.ndrCommit = ndrCommit;
})();
