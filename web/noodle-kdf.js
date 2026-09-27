// Main-thread side of Noodle's key derivation.
//
// Passphrase -> Argon2id (in noodle-kdf-worker.js) -> Ed25519 seed. The salt
// is SHA-256(poll slug + NUL + normalized name), so the same name and
// passphrase give the same key on any device, and the same passphrase gives a
// different key in every poll.
//
// Debounced: a derive starts KDF_DEBOUNCE ms after typing stops. Never more
// than one runs -- a change mid-derive TERMINATES the worker (Argon2 cannot be
// interrupted from outside) and a generation counter drops anything stale.

// Must match noodle/slots.py normalize_name() exactly (it salts the KDF).
function noodleNormName(raw) {
  var s = String(raw || '').normalize('NFKC');
  if (/[\p{Cc}\p{Cf}]/u.test(s)) return null;
  s = s.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  if (!s || Array.from(s).length > 40) return null;
  return s;
}

function ndHex(bytes) {
  return Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function noodleSalt(slug, norm) {
  var d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(slug + '\u0000' + norm));
  return new Uint8Array(d).slice(0, 16);
}

// opts: {slug, kdf:{m,t,p,len,debounce}, workerUrl, onStart(info), onDerived(info), onError(msg)}
function NoodleKdf(opts) {
  var worker = null, timer = null, gen = 0, busy = false, signId = 0;
  var pendingSigns = {};
  var current = null; // {norm, pub} of the key the worker holds now

  function spawn() {
    worker = new Worker(opts.workerUrl);
    worker.onmessage = onMessage;
    worker.onerror = function () { busy = false; opts.onError('key worker failed to start'); };
  }

  function onMessage(e) {
    var m = e.data;
    if (m.op === 'derived' && m.gen === gen) {
      busy = false;
      current = { norm: current && current.pendingNorm, pub: m.pub };
      opts.onDerived({ pub: m.pub, ms: m.ms });
    } else if (m.op === 'signed' && pendingSigns[m.id]) {
      pendingSigns[m.id].resolve(m.sig); delete pendingSigns[m.id];
    } else if (m.op === 'error') {
      if (m.id && pendingSigns[m.id]) { pendingSigns[m.id].reject(new Error(m.detail)); delete pendingSigns[m.id]; }
      if (m.gen === gen) { busy = false; opts.onError(m.detail); }
    }
  }

  async function run(name, pass, myGen) {
    var norm = noodleNormName(name);
    var salt = await noodleSalt(opts.slug, norm);
    if (myGen !== gen) return;
    if (busy) { worker.terminate(); spawn(); } // cancel the in-flight derive
    busy = true;
    current = { pendingNorm: norm, pub: null };
    opts.onStart({ salt: ndHex(salt), norm: norm });
    worker.postMessage({ op: 'derive', gen: myGen, pass: pass, salt: salt,
      m: opts.kdf.m, t: opts.kdf.t, p: opts.kdf.p, len: opts.kdf.len });
  }

  // Call on every keystroke in either field.
  function input(name, pass) {
    gen++;
    current = null;
    clearTimeout(timer);
    if (!noodleNormName(name) || !pass) { opts.onStart(null); return; }
    var myGen = gen;
    timer = setTimeout(function () { run(name, pass, myGen); }, opts.kdf.debounce);
  }

  function sign(text) {
    var id = ++signId;
    return new Promise(function (resolve, reject) {
      pendingSigns[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ op: 'sign', id: id, text: text });
    });
  }

  spawn();
  return {
    input: input, sign: sign,
    ready: function () { return !!(current && current.pub) && !busy; },
    pub: function () { return current && current.pub; },
  };
}

if (typeof window !== 'undefined') {
  window.NoodleKdf = NoodleKdf;
  window.noodleNormName = noodleNormName;
  window.noodleSalt = noodleSalt;
}
