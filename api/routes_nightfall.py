import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from helpers import DATA_DIR

_NIGHTFALL_SAVE_SCRIPT = """
<script>
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
</script>
"""

_NIGHTFALL_HEAD = """
<script>
(function () {
  // Monkey-patch AudioContext so we can resume all instances on first touch
  // and after returning from background (iOS suspends on backgrounding).
  var _AC = window.AudioContext || window.webkitAudioContext;
  if (!_AC) return;
  window._waiOrigAC = _AC;
  window._waiAudioContexts = [];
  function PatchedAC() {
    var ctx = new _AC();
    window._waiAudioContexts.push(ctx);
    return ctx;
  }
  PatchedAC.prototype = _AC.prototype;
  window.AudioContext = window.webkitAudioContext = PatchedAC;

  function unlockAll() {
    window._waiAudioContexts.forEach(function(ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(function(){});
    });
  }
  document.addEventListener('touchstart', unlockAll, {once: true, passive: true});
  document.addEventListener('touchend',   unlockAll, {once: true, passive: true});
  document.addEventListener('click',      unlockAll, {once: true});
})();
</script>
"""

_NIGHTFALL_BODY = """
<style>
#wai-fs-btn {
  position: fixed; top: 12px; right: 12px; z-index: 99999;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
  color: rgba(255,255,255,0.8); font-size: 17px; width: 36px; height: 36px;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
body.wai-fs { overflow: hidden; }
</style>
<button id="wai-fs-btn" onclick="waiFsToggle()" title="Fullscreen">⛶</button>
<script>
// Prevent pinch-zoom and double-tap zoom
(function() {
  var vp = document.querySelector('meta[name=viewport]');
  if (vp) vp.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no');
  var _lastTap = 0;
  document.addEventListener('touchend', function(e) {
    var now = Date.now();
    if (now - _lastTap < 300) e.preventDefault();
    _lastTap = now;
  }, { passive: false });
  document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
})();

// Re-unlock AudioContext when app is foregrounded (iOS suspends on background)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    var AC = window._waiOrigAC || window.AudioContext || window.webkitAudioContext;
    if (window._waiAudioContexts) {
      window._waiAudioContexts.forEach(function(ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(function(){});
      });
    }
  }
});

var _waiFs = false;

var _FS_PORTRAIT_VARS = [
  '--h-pct:calc((100vh - env(safe-area-inset-top,2em)*2)/100)',
  '--v-pct:calc((100vw - env(safe-area-inset-left,2em)*2)/100*1.5)'
].join(';');

var _isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

function _applyFsLayout() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  if (_isMobile && vh > vw) {
    document.documentElement.style.cssText = 'width:100vw;height:100vh;overflow:hidden;';
    document.body.style.cssText = 'margin:0;position:absolute;width:' + vh + 'px;height:' + vw + 'px;transform-origin:0 0;transform:rotate(90deg) translate(0,-' + vw + 'px);overflow:hidden;background:#222;';
    var s = document.getElementById('wai-fs-vars');
    if (!s) { s = document.createElement('style'); s.id = 'wai-fs-vars'; document.head.appendChild(s); }
    s.textContent = '.container{' + _FS_PORTRAIT_VARS + '!important}';
  } else {
    document.documentElement.style.cssText = 'overflow:hidden;';
    document.body.style.cssText = 'margin:0;width:100%;height:100%;overflow:hidden;';
    var root = document.getElementById('root');
    if (root) root.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;';
    var s = document.getElementById('wai-fs-vars');
    if (!s) { s = document.createElement('style'); s.id = 'wai-fs-vars'; document.head.appendChild(s); }
    s.textContent = '.container{--pct:var(--pct-raw)!important}';
  }
}

function _clearFsLayout() {
  document.documentElement.style.cssText = '';
  document.body.style.cssText = '';
  var root = document.getElementById('root');
  if (root) root.style.cssText = '';
  var s = document.getElementById('wai-fs-vars');
  if (s) s.remove();
}

function waiFsToggle() {
  _waiFs = !_waiFs;
  document.body.classList.toggle('wai-fs', _waiFs);
  document.getElementById('wai-fs-btn').textContent = _waiFs ? '✕' : '⛶';
  if (_waiFs) {
    try { var el = document.documentElement;
      if (el.requestFullscreen)            el.requestFullscreen().catch(function(){});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch(e) {}
    try {
      if (screen.orientation && screen.orientation.lock)
        screen.orientation.lock('landscape').catch(function(){});
    } catch(e) {}
    _applyFsLayout();
  } else {
    try {
      if (document.exitFullscreen)            document.exitFullscreen().catch(function(){});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch(e) {}
    _clearFsLayout();
  }
}

window.addEventListener('resize', function() { if (_waiFs) _applyFsLayout(); });
</script>
"""

_VALID_SAVE_SLOTS = {"save1", "save2", "save3"}

public_router = APIRouter()
protected_router = APIRouter()


@public_router.get("/nightfall")
async def nightfall():
    from fastapi.responses import HTMLResponse
    html = Path("/app/nightfall/index.html").read_text()
    chunk_srcs = re.findall(r'<script src="(\./static/js/[^"]+\.js)"></script>', html)
    for src in chunk_srcs:
        html = html.replace(f'<script src="{src}"></script>', '', 1)
    abs_srcs = [s.replace('./', '/nightfall-game/', 1) for s in chunk_srcs]
    save_script = _NIGHTFALL_SAVE_SCRIPT.replace('__SCRIPTS__', json.dumps(abs_srcs))
    html = html.replace("<head>", '<head><base href="/nightfall-game/"><link rel="icon" href="/nightfall-game/hack.png">' + _NIGHTFALL_HEAD, 1)
    html = html.replace("</body>", _NIGHTFALL_BODY + save_script + "</body>", 1)
    return HTMLResponse(html)


@protected_router.get("/api/gamesave")
def api_gamesave_all():
    result = {}
    for slot in ["save1", "save2", "save3"]:
        p = DATA_DIR / f"gamesave_{slot}.json"
        result[slot] = p.read_text() if p.exists() else None
    return result


@protected_router.get("/api/gamesave/{slot}")
def api_gamesave_get(slot: str):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    p = DATA_DIR / f"gamesave_{slot}.json"
    return {"save": p.read_text() if p.exists() else None}


@protected_router.post("/api/gamesave/{slot}")
async def api_gamesave_post(slot: str, request: Request):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    body = await request.json()
    save_str = body.get("save")
    if not isinstance(save_str, str):
        raise HTTPException(status_code=400, detail="save must be a string")
    try:
        json.loads(save_str)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="save is not valid JSON")
    (DATA_DIR / f"gamesave_{slot}.json").write_text(save_str)
    return {"ok": True}


@protected_router.delete("/api/gamesave/{slot}")
def api_gamesave_delete(slot: str):
    if slot not in _VALID_SAVE_SLOTS:
        raise HTTPException(status_code=400, detail="invalid slot")
    p = DATA_DIR / f"gamesave_{slot}.json"
    if p.exists():
        p.unlink()
    return {"ok": True}
