(async function () {
  var STORE = 'nightfall-save';
  var SLOTS = ['save1', 'save2', 'save3'];

  function openDB() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('nightfall');
      req.onupgradeneeded = function (e) {
        if (!e.target.result.objectStoreNames.contains(STORE)) {
          e.target.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = function (e) { res(e.target.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function dbGet(db, key) {
    return new Promise(function (res) {
      try {
        var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = function () { res(r.result != null ? r.result : null); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function dbSet(db, key, val) {
    return new Promise(function (res) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = res; tx.onerror = res;
      } catch (e) { res(); }
    });
  }
  function loadScript(src) {
    return new Promise(function (res) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    });
  }

  // Intercept IDB writes → upload to server on every save
  var _origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (val, key) {
    if (this.name === STORE && typeof key === 'string') {
      fetch('/api/gamesave/' + key, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: val })
      }).catch(function () {});
    }
    return _origPut.apply(this, arguments);
  };

  // Upload existing slots on page load (catches saves from previous sessions)
  (async function () {
    try {
      var udb = await openDB();
      for (var ui = 0; ui < SLOTS.length; ui++) {
        var uslot = SLOTS[ui];
        var uval = await dbGet(udb, uslot);
        if (!uval) continue;
        fetch('/api/gamesave/' + uslot, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save: uval })
        }).catch(function () {});
      }
      udb.close();
    } catch (e) {}
  })();

  // Restore: always overwrite IDB with server save (server is source of truth)
  try {
    var resp = await fetch('/api/gamesave', { credentials: 'include' });
    console.log('[nf-sync] gamesave fetch status:', resp.status);
    if (resp.ok) {
      var server = await resp.json();
      console.log('[nf-sync] server save1 len:', server.save1 ? server.save1.length : 'null');
      var db = await openDB();
      for (var i = 0; i < SLOTS.length; i++) {
        var slot = SLOTS[i];
        if (!server[slot]) continue;
        await dbSet(db, slot, server[slot]);
        console.log('[nf-sync] wrote', slot);
      }
      db.close();
    }
  } catch (e) { console.log('[nf-sync] restore error:', e); }

  // Load React app (deferred until restore is done)
  var SCRIPTS = __SCRIPTS__;
  for (var j = 0; j < SCRIPTS.length; j++) await loadScript(SCRIPTS[j]);
})();
