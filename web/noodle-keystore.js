// noodle's KEY STORE: what this browser remembers to sign as you on a poll --
// the voter's Ed25519 signing KEY, never the passphrase. The key is the
// worker's NON-EXTRACTABLE CryptoKey (noodle-kdf-worker.js), kept in IndexedDB
// per poll and per name: a script that ever ran on this origin could USE it
// here, but could never read it out, and could never learn the passphrase
// that made it (which people reuse). Until 2026-10-14 the passphrase itself
// sat in localStorage in plain text (security audit). Same global scope as
// noodle-vote.js; loaded before noodle-storage.js.

var NDK_DB = 'noodle', NDK_STORE = 'keys';

function ndkOpen() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(NDK_DB, 1);
    req.onupgradeneeded = function () { req.result.createObjectStore(NDK_STORE); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

// One transaction on the store; `fn` queues the requests and returns what
// to resolve with once it commits.
function ndkTx(mode, fn) {
  return ndkOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(NDK_STORE, mode), out = fn(tx.objectStore(NDK_STORE));
      tx.oncomplete = function () { db.close(); resolve(out); };
      tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
    });
  });
}

function ndkId(slug, norm) { return slug + '\u0000' + norm; }

// -> {normName: {key, pub}} for this poll; {} when storage is blocked
function ndkLoad(slug) {
  var range = IDBKeyRange.bound(slug + '\u0000', slug + '\u0001', false, true);
  return ndkTx('readonly', function (store) {
    var out = {}, req = store.openCursor(range);
    req.onsuccess = function () {
      var c = req.result;
      if (!c) return;
      out[String(c.key).slice(slug.length + 1)] = c.value;
      c.continue();
    };
    return out;
  }).catch(function () { return {}; });
}

function ndkSave(slug, norm, key, pub) {
  return ndkTx('readwrite', function (store) { store.put({ key: key, pub: pub }, ndkId(slug, norm)); })
    .catch(function () { /* storage blocked: the passphrase is asked for next time */ });
}

function ndkDrop(slug, norm) {
  return ndkTx('readwrite', function (store) { store.delete(ndkId(slug, norm)); })
    .catch(function () { /* nothing to drop */ });
}

window.NoodleKeys = { load: ndkLoad, save: ndkSave, drop: ndkDrop };
