// /recruiter: the dark-mode toggle, plus the dark theme's type-out of the
// summary blurb. The LIGHT page is the plain professional résumé and never
// animates; the type-out (tarot-paced, with a decoy fake-out) belongs to the
// terminal look alone, so it starts when dark is applied and is torn down —
// final text left in place — when the page goes back to light.
(function () {
  'use strict';

  var de = document.documentElement;
  var btn = document.getElementById('cv-theme');
  var fxEls = [];
  var fxZoomLoaded = false;
  var typer = null;  // the live type-out while dark, else null

  // The full site CRT stack, in the load-bearing DOM/paint order
  // (bg -> lines -> blur -> crt -> scan) — the glass caches only while the
  // one animated layer (.cyber-scan) is painted ABOVE it. Mirrors _CRT_FX in
  // pages.py so dark mode matches every other page, not a 3-layer subset.
  function setFx(on) {
    if (on && !fxEls.length) {
      ['cyber-bg', 'cyber-lines', 'cyber-blur', 'cyber-crt', 'cyber-scan'].forEach(function (cls) {
        var d = document.createElement('div');
        d.className = cls;
        document.body.appendChild(d);
        fxEls.push(d);
      });
      if (!fxZoomLoaded) {  // zoom-lock: keeps scanline size constant across browser zoom
        var s = document.createElement('script');
        s.src = '/crt-zoom.js?v=2';
        document.body.appendChild(s);
        fxZoomLoaded = true;
      }
    } else if (!on && fxEls.length) {
      fxEls.forEach(function (d) { d.remove(); });
      fxEls = [];
    }
  }

  // ── blurb type-out (dark only) ────────────────────────────────────────────
  // tarot reader pacing — reading-paced, with pauses on punctuation, nudged
  // quicker than the tarot reader (1.25^3 × 1.2)
  var SPEED = 2.34375;
  var BASE_MS = 65;
  var BACK_MS = 30 / SPEED;  // backspacing the decoy — quick, even pace

  function nextDelayAfter(ch) {
    if (ch === '.') return 1000;  // each dot (incl. the decoy ellipsis) holds 1s
    var d;
    switch (ch) {
      case '!': case '?':           d = 850; break;
      case ',': case ';': case ':': d = 420; break;
      case '—': case '-':           d = 480; break;
      case '\n':                    d = 1100; break;
      case ' ':                     d = 110; break;
      default:                      d = BASE_MS;
    }
    return d / SPEED;
  }

  // Overlay text nodes in order (skip whitespace-only). Collapse each node's
  // whitespace the way HTML renders it, so the caret never stalls on an
  // invisible source newline; trim the leading/trailing edges. A node whose
  // parent carries data-decoy types that decoy first, then backspaces it and
  // types the real text — a little "actually..." fake-out.
  function collectNodes(overlay) {
    var walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) {
      var par = n.parentNode;
      var decoy = (par && par.getAttribute) ? par.getAttribute('data-decoy') : null;
      nodes.push({ node: n, text: n.nodeValue.replace(/\s+/g, ' '), decoy: decoy });
    }
    if (nodes.length) {
      nodes[0].text = nodes[0].text.replace(/^\s+/, '');
      nodes[nodes.length - 1].text = nodes[nodes.length - 1].text.replace(/\s+$/, '');
    }
    return nodes;
  }

  // Caret lives right after the text node currently being typed.
  function placeCaret(t, node) {
    var p = node.parentNode;
    if (p) p.insertBefore(t.caret, node.nextSibling);
  }

  // Type `text` into `node` one char at a time, then call done().
  function typeInto(t, node, text, done) {
    var k = 0;
    (function tick() {
      if (t.finished) return;
      if (k >= text.length) { done(); return; }
      k += 1;
      node.nodeValue = text.slice(0, k);
      placeCaret(t, node);
      t.timer = setTimeout(tick, nextDelayAfter(text[k - 1]));
    })();
  }

  // Delete node's current text one char at a time, then call done().
  function backspace(t, node, done) {
    (function tick() {
      if (t.finished) return;
      var v = node.nodeValue;
      if (!v.length) { done(); return; }
      node.nodeValue = v.slice(0, -1);
      placeCaret(t, node);
      t.timer = setTimeout(tick, BACK_MS);
    })();
  }

  function runNode(t) {
    if (t.finished) return;
    if (t.idx >= t.nodes.length) { finish(t); return; }
    var e = t.nodes[t.idx];
    t.idx += 1;
    placeCaret(t, e.node);
    var next = function () { runNode(t); };
    if (e.decoy) {
      typeInto(t, e.node, e.decoy, function () {
        if (t.finished) return;
        t.timer = setTimeout(function () {
          backspace(t, e.node, function () { typeInto(t, e.node, e.text, next); });
        }, 650 / SPEED);  // hold a beat on the decoy before correcting it
      });
    } else {
      typeInto(t, e.node, e.text, next);
    }
  }

  // Click the overlay / ⏩ (or reaching the end) jumps to the final text and
  // reveals the ⟳ replay control.
  function finish(t) {
    if (t.finished) return;
    t.finished = true;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; }
    t.nodes.forEach(function (e) { e.node.nodeValue = e.text; });
    t.caret.remove();
    t.overlay.style.cursor = '';
    t.skipBtn.remove();
    t.overlay.appendChild(t.loopBtn);  // ⟳ replay sits inline at the end of the blurb
  }

  // (Re)start the type-out from a blank overlay.
  function restart(t) {
    t.finished = false;
    t.idx = 0;
    if (t.loopBtn.parentNode) t.loopBtn.remove();
    t.nodes.forEach(function (e) { e.node.nodeValue = ''; });
    t.overlay.insertBefore(t.skipBtn, t.overlay.firstChild);
    t.overlay.style.cursor = 'pointer';
    runNode(t);
  }

  function inlineBtn(cls, glyph, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    return b;
  }

  // Keep the real blurb in normal flow but hidden (.cv-typing) so it reserves
  // the FINAL height — the rest of the résumé never bounces as the text grows.
  // The animation runs in an absolutely-positioned overlay clone painted on top.
  function startTyping() {
    var blurb = document.querySelector('.cv-summary');
    if (!blurb) return null;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return null;  // leave the final text in place; no typing, no caret
    }
    var overlay = document.createElement('div');
    overlay.className = 'cv-type-overlay';
    overlay.innerHTML = blurb.innerHTML;
    var nodes = collectNodes(overlay);
    if (!nodes.length) return null;
    blurb.style.position = 'relative';
    blurb.appendChild(overlay);
    blurb.classList.add('cv-typing');

    var caret = document.createElement('span');
    caret.className = 'cv-caret';
    var t = {
      blurb: blurb, overlay: overlay, nodes: nodes, caret: caret,
      idx: 0, timer: null, finished: false,
      // ⏩ skip sits inline before the blurb's first word (only while typing);
      // ⟳ replay sits after the blurb and reruns the type-out.
      skipBtn: inlineBtn('cv-skip', '⏩', 'Skip the intro animation'),
      loopBtn: inlineBtn('cv-loop', '⟳', 'Replay the intro animation')
    };
    t.skipBtn.addEventListener('click', function () { finish(t); });
    overlay.addEventListener('click', function () { finish(t); });
    // loopBtn lives inside the overlay, whose click also runs finish() — stop the
    // bubble so the replay's restart() isn't immediately undone.
    t.loopBtn.addEventListener('click', function (e) { e.stopPropagation(); restart(t); });
    restart(t);
    return t;
  }

  // Back to light: stop mid-type and hand the blurb back to the static markup.
  function stopTyping(t) {
    t.finished = true;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; }
    t.overlay.remove();
    t.blurb.classList.remove('cv-typing');
    t.blurb.style.position = '';
  }

  // ── dark-mode toggle ──────────────────────────────────────────────────────
  // Flips html.cv-dark (token overrides in recruiter.css), adds the shared
  // CRT stack while dark, and runs the type-out only in dark. Persisted.
  function applyTheme(dark) {
    de.classList.toggle('cv-dark', dark);
    setFx(dark);
    if (dark && !typer) typer = startTyping();
    else if (!dark && typer) { stopTyping(typer); typer = null; }
    if (btn) {
      btn.textContent = dark ? 'Light mode' : 'Dark mode';
    }
  }

  var saved = null;
  try { saved = localStorage.getItem('cv-theme'); } catch (_) {}
  applyTheme(saved === 'dark');
  if (btn) {
    btn.addEventListener('click', function () {
      var dark = !de.classList.contains('cv-dark');
      applyTheme(dark);
      try { localStorage.setItem('cv-theme', dark ? 'dark' : 'light'); } catch (_) {}
    });
  }
})();
