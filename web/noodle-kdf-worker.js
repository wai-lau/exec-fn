// Noodle's key worker. Runs Argon2id (hash-wasm, vendored -- web/vendor/,
// MIT) off the main thread so typing never stutters, and holds the resulting
// Ed25519 private key as a NON-EXTRACTABLE CryptoKey. The passphrase and the
// private key never leave this worker; only the public key and signatures do.
//
// Messages in:  {op:'derive', gen, pass, salt, m, t, p, len}
//               {op:'sign', id, text}
// Messages out: {op:'derived', gen, pub, ms} | {op:'signed', id, sig}
//               {op:'error', gen|id, detail}

importScripts('/vendor/hash-wasm-argon2-4.12.0.min.js');

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410): WebCrypto has no
// "import raw private seed", but a seed inside this fixed prefix is exactly
// what 'pkcs8' import takes.
var PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
var key = null;

function b64(buf) {
  var bytes = new Uint8Array(buf), s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function derive(m) {
  var t0 = performance.now();
  var seed = await self.hashwasm.argon2id({
    // hash-wasm refuses an empty password, and an empty passphrase is allowed
    // (the page warns it can be impersonated): it becomes one NUL byte, which
    // no text input can produce, so it collides with no typed passphrase and
    // every non-empty one derives exactly as before.
    password: m.pass === '' ? new Uint8Array([0]) : m.pass,
    salt: m.salt, parallelism: m.p, iterations: m.t,
    memorySize: m.m, hashLength: m.len, outputType: 'binary',
  });
  var pk8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
  pk8.set(PKCS8_PREFIX); pk8.set(seed, PKCS8_PREFIX.length);
  // An extractable copy exists only long enough to read the public half out
  // of its JWK; the key actually kept for signing cannot be exported.
  var tmp = await crypto.subtle.importKey('pkcs8', pk8, { name: 'Ed25519' }, true, ['sign']);
  var jwk = await crypto.subtle.exportKey('jwk', tmp);
  key = await crypto.subtle.importKey('pkcs8', pk8, { name: 'Ed25519' }, false, ['sign']);
  seed.fill(0); pk8.fill(0);
  self.postMessage({ op: 'derived', gen: m.gen, pub: jwk.x, ms: Math.round(performance.now() - t0) });
}

async function sign(m) {
  if (!key) throw new Error('no key yet');
  var sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(m.text));
  self.postMessage({ op: 'signed', id: m.id, sig: b64(sig) });
}

self.onmessage = function (e) {
  var m = e.data;
  var job = m.op === 'derive' ? derive(m) : m.op === 'sign' ? sign(m) : null;
  if (job) {
    job.catch(function (err) {
      self.postMessage({ op: 'error', gen: m.gen, id: m.id, detail: String(err && err.message || err) });
    });
  }
};
