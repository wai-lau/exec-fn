// Noodle voter page: identity -> key -> seal, the calendar, and the signed
// submit (Ask Noodle lives in noodle-ask.js). The passphrase never leaves the
// browser: it goes to the key worker (noodle-kdf-worker.js) and nowhere else;
// the server receives the public key, the slots and a signature over them.

var NDV = { poll: null, cal: null, kdf: null, skew: 0, blocked: false, salt: '' };

function ndv$(id) { return document.getElementById(id); }

function ndvStatus(msg, kind) {
  var el = ndv$('nd-status');
  el.textContent = msg || '';
  el.dataset.kind = kind || '';
}

var NDV_SIGN_WAIT = 'sign(your availability, key) ──> (on submit)';
var NDV_SIGN_DONE = 'sign(your availability, key) ──> sealed';

function ndvDeriveLine(salt, tail) {
  var k = NDV.kdfCfg, pass = ndv$('nd-pass').value;
  return 'argon2id("' + (pass || '<passphrase>') + '", ' + salt.slice(0, 12) + '.., m=' +
    (k.m / 1024) + 'MiB, t=' + k.t + ', p=' + k.p + ') \u2500\u2500> ' + tail;
}

function ndvTeach(tail, signLine) {
  ndv$('nd-teach').textContent = ndvDeriveLine(NDV.salt || '<salt>', tail) + '\n' + signLine;
}

function ndvReady() { return !!NDV.kdf && NDV.kdf.ready(); }

function ndvSyncSubmit() {
  ndv$('nd-submit').disabled = NDV.blocked || !ndvReady();
}

// Which voter (if any) the typed name already belongs to, and everyone else
// as dot columns. A name sealed by a different key blocks submit.
function ndvRefreshBinding(pub) {
  var norm = window.noodleNormName(ndv$('nd-name').value), mine = null, others = [];
  (NDV.poll ? NDV.poll.voters : []).forEach(function (v) {
    if (norm && window.noodleNormName(v.name) === norm) mine = v;
    else others.push({ slots: new Set(v.slots) });
  });
  NDV.cal.setOthers(others);
  NDV.blocked = !!(mine && mine.pub && pub && mine.pub !== pub);
  if (NDV.blocked) {
    ndvStatus('"' + mine.name + '" is already sealed with a different passphrase.', 'err');
  } else if (mine && pub && mine.pub === pub) {
    NDV.cal.setSel(new Set(mine.slots));
    ndvStatus('welcome back, ' + mine.name + '. your picks are loaded.');
  } else {
    ndvStatus('');
  }
  ndvSyncSubmit();
}

function ndvOnStart(info) {
  ndvSyncSubmit();
  var seal = ndv$('nd-seal');
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

function ndvOnIdentityInput() {
  NDV.blocked = false;
  NDV.kdf.input(ndv$('nd-name').value, ndv$('nd-pass').value);
  if (NDV.poll) ndvRefreshBinding(null);
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
  if (!ndvReady() || NDV.blocked) return;
  ndv$('nd-submit').disabled = true;
  var name = ndv$('nd-name').value, slots = Array.from(NDV.cal.getSel()).sort();
  var ts = Date.now() + NDV.skew;
  // keys written in sorted order: the same bytes noodle/sig.py canonical() builds
  var text = JSON.stringify({ name: name, poll: NDV.slug, slots: slots, ts: ts });
  try {
    var sig = await NDV.kdf.sign(text);
    var res = await ndvPost('/vote', { name: name, pub: NDV.kdf.pub(), slots: slots, ts: ts, sig: sig });
    if (!res.ok) { ndvStatus(res.data.error || 'submit failed', 'err'); return; }
    ndvTeach('key', NDV_SIGN_DONE);
    ndvApproved(NDV.seal);
    await ndvLoadPoll();
    ndvStatus('sealed. come back with the same name and passphrase to change it.');
  } catch (e) {
    ndvStatus('submit failed: ' + e.message, 'err');
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
  ndvRefreshBinding(ndvReady() ? NDV.kdf.pub() : null);
}

function ndvInit() {
  var root = ndv$('noodle');
  if (!root || !root.dataset.slug) return;
  NDV.slug = root.dataset.slug;
  NDV.kdfCfg = JSON.parse(root.dataset.kdf);
  NDV.cal = window.NoodleCal(ndv$('nd-cal'), {
    start: root.dataset.start, end: root.dataset.end, caption: ndv$('nd-caption'),
  });
  NDV.kdf = window.NoodleKdf({
    slug: NDV.slug, kdf: NDV.kdfCfg, workerUrl: root.dataset.worker,
    onStart: ndvOnStart, onDerived: ndvOnDerived,
    onError: function (msg) {
      ndvStatus('could not make a key in this browser (' + msg + '). a current Safari, Chrome or Firefox is needed.', 'err');
    },
  });
  ndv$('nd-name').addEventListener('input', ndvOnIdentityInput);
  ndv$('nd-pass').addEventListener('input', ndvOnIdentityInput);
  ndv$('nd-submit').addEventListener('click', ndvSubmit);
  ndvTeach('key', NDV_SIGN_WAIT);
  ndvSyncSubmit();
  ndvLoadPoll();
}

ndvInit();
