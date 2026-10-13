// noodle's CREATOR CLAIM (api/noodle/drafts.py, e2e.py _claim). An end-to-end
// poll's key is made HERE, in the creator's browser on /noodle, before the
// poll exists -- and an Ed25519 key derived from it (HKDF, its own label)
// signs the poll's first vote. Only the claim's PUBLIC half goes to the
// server, bound into the draft token, so nobody who sees only what the server
// sees (the slug, the token, that public key) can cast the first vote and
// take the host's seat. Loaded by /noodle (noodleNewPollKey + the public key)
// and the vote page (the signature, noodle-e2e.js ndeSendVote).

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410) -- the same prefix
// noodle-kdf-worker.js uses: WebCrypto imports a seed only inside it.
var NDC_PKCS8 = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function ndcB64u(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function ndcFromB64u(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); });
}

// A fresh poll key, as it rides in the link's fragment (#k=...).
function noodleNewPollKey() {
  return ndcB64u(crypto.getRandomValues(new Uint8Array(32)));
}

// The claim key of a poll key -> {pub: url-safe base64, sign(text) -> base64}.
async function noodleClaimKey(keyStr) {
  var enc = new TextEncoder();
  var base = await crypto.subtle.importKey('raw', ndcFromB64u(keyStr), 'HKDF', false, ['deriveBits']);
  var seed = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
    salt: new Uint8Array(32), info: enc.encode('noodle e2e claim v1') }, base, 256));
  var pk8 = new Uint8Array(NDC_PKCS8.length + seed.length);
  pk8.set(NDC_PKCS8);
  pk8.set(seed, NDC_PKCS8.length);
  var key = await crypto.subtle.importKey('pkcs8', pk8, { name: 'Ed25519' }, true, ['sign']);
  var pub = (await crypto.subtle.exportKey('jwk', key)).x;
  seed.fill(0);
  pk8.fill(0);
  return {
    pub: pub,
    sign: async function (text) {
      var s = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(text)));
      return btoa(String.fromCharCode.apply(null, s));
    },
  };
}

window.noodleNewPollKey = noodleNewPollKey;
window.noodleClaimKey = noodleClaimKey;
