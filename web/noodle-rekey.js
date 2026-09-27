// Changing your passphrase. The name is bound to the key its first commit was
// signed with, and the key IS the passphrase -- so a new passphrase means the
// OLD key signing the NEW public key over to the name (noodle/rekey.py).
//
// The button sits right of the passphrase field, only once the passphrase is
// right (the name is committed under this very key). Tapping it keeps the old
// passphrase in memory, clears the field and asks for the new one; a second
// worker re-derives the old key meanwhile so it can still sign. Until Commit
// nothing is sent and nothing is remembered: the page still answers as the old
// key (ndrAs), the identity is not saved, and a reload brings the old
// passphrase back. Commit sends the rekey FIRST, then the split and the vote
// under the new key (ndvSubmit).

var NDR = { active: false, oldPass: '', oldPub: null, keeper: null, keeperPub: null };
window.NDR = NDR;

function ndr$(id) { return document.getElementById(id); }

// The key the SERVER knows this voter by: the old one until the change commits.
function ndrAs(pub) { return NDR.active && pub ? NDR.oldPub : pub; }

// Shown while changing, or when the typed passphrase is the right one.
function ndrSync() {
  var btn = ndr$('nd-rekey');
  if (!btn) return;
  var ok = ndr$('nd-rekey-ok');
  btn.hidden = !NDR.active && !NDV.mine;
  // mid-change: a cross (cancel) and a check (commit, the same as Commit)
  btn.textContent = NDR.active ? '\u2717' : 'change';
  btn.classList.toggle('glyph', NDR.active);
  btn.setAttribute('aria-label', NDR.active ? 'cancel the passphrase change' : 'change passphrase');
  btn.title = NDR.active ? 'cancel' : '';
  ok.hidden = !NDR.active;
  ok.disabled = ndv$('nd-submit').disabled;
}

function ndrLabel(on) {
  var pass = ndr$('nd-pass');
  pass.placeholder = on ? 'new passphrase' : 'no passphrase';
  ndr$('nd-name').disabled = on;   // a new name is a different identity, not a change
}

function ndrStop() {
  if (NDR.keeper) NDR.keeper.stop();
  NDR.keeper = null;
  NDR.keeperPub = null;
  NDR.active = false;
  ndrLabel(false);
}

function ndrStart() {
  var root = ndr$('noodle'), cfg = Object.assign({}, NDV.kdfCfg, { debounce: 0 });
  NDR.active = true;
  NDR.oldPass = ndr$('nd-pass').value;
  NDR.oldPub = NDV.kdf.pub();
  NDR.keeperPub = new Promise(function (resolve, reject) {
    NDR.keeper = window.NoodleKdf({ slug: NDV.slug, kdf: cfg, workerUrl: root.dataset.worker,
      onStart: function () {}, onDerived: function (d) { resolve(d.pub); }, onError: reject });
  });
  NDR.keeperPub.catch(function () {});   // surfaced at Commit, not as an unhandled rejection
  NDR.keeper.input(ndr$('nd-name').value, NDR.oldPass);
  ndrLabel(true);
  ndr$('nd-pass').value = '';
  window.ndvOnIdentityInput();
  ndr$('nd-pass').focus();
}

function ndrCancel() {
  var pass = NDR.oldPass;
  ndrStop();
  ndr$('nd-pass').value = pass;
  window.ndvOnIdentityInput();
}

function ndrClick() {
  if (NDR.active) ndrCancel(); else ndrStart();
}

// Part of Commit: hand the name to the new key, signed by the old one.
// -> {ok, did} ; did = a rekey was sent, so the next request needs a newer ts.
async function ndrCommit(ts) {
  if (!NDR.active) return { ok: true };
  var newpub = NDV.kdf.pub(), name = ndr$('nd-name').value;
  if (newpub === NDR.oldPub) { ndrStop(); return { ok: true }; }   // same passphrase typed again
  try {
    if ((await NDR.keeperPub) !== NDR.oldPub) throw new Error('the old key did not re-derive');
    var sig = await NDR.keeper.sign(ndhCanon({ kind: 'rekey', name: name, newpub: newpub, poll: NDV.slug, ts: ts }));
    var res = await ndvPost('/rekey', { name: name, pub: NDR.oldPub, ts: ts, sig: sig, newpub: newpub });
    if (!res.ok) return res;
  } catch (e) {
    return { ok: false, data: { error: 'could not change the passphrase: ' + e.message } };
  }
  ndrStop();
  ndvSaveIdentity();   // only now does the new passphrase become the remembered one
  return { ok: true, did: true };
}

(function () {
  if (!ndr$('nd-rekey')) return;
  ndr$('nd-rekey').addEventListener('click', ndrClick);
  ndr$('nd-rekey-ok').addEventListener('click', function () { ndvSubmit(); });
  window.ndrAs = ndrAs;
  window.ndrSync = ndrSync;
  window.ndrCommit = ndrCommit;
})();
