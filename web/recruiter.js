// Types the summary blurb out on load, at the tarot reader's reading pace
// (per-character delays, longer pauses on punctuation). Only the blurb types;
// the rest of the résumé renders normally. The page is static HTML, so we
// snapshot the blurb's text nodes, blank them, then write the characters back
// behind a blinking caret that disappears once the blurb is fully typed.
(function () {
  'use strict';

  // ── dark-mode toggle ──────────────────────────────────────────────────────
  // Flips html.cv-dark (token overrides in recruiter.css) and adds the tarot
  // CRT overlay (.cyber-bg/.cyber-scan from chrome.css) while dark. Persisted.
  var de = document.documentElement;
  var btn = document.getElementById('cv-theme');
  var fxEls = [];
  function setFx(on) {
    if (on && !fxEls.length) {
      ['cyber-bg', 'cyber-scan'].forEach(function (cls) {
        var d = document.createElement('div');
        d.className = cls;
        document.body.appendChild(d);
        fxEls.push(d);
      });
    } else if (!on && fxEls.length) {
      fxEls.forEach(function (d) { d.remove(); });
      fxEls = [];
    }
  }
  function applyTheme(dark) {
    de.classList.toggle('cv-dark', dark);
    setFx(dark);
    if (btn) {
      btn.innerHTML = '⋆₊<span class="cv-glyph">' + (dark ? '☼' : '⏾') + '</span>⁺₊⋆';
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

  // ── blurb type-out ────────────────────────────────────────────────────────
  var blurb = document.querySelector('.cv-summary');
  if (!blurb) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;  // leave the final text in place; no typing, no caret

  // Keep the real blurb in normal flow but hidden (.cv-typing) so it reserves
  // the FINAL height — the rest of the résumé never bounces as the text grows.
  // The animation runs in an absolutely-positioned overlay clone painted on top.
  blurb.style.position = 'relative';
  var overlay = document.createElement('div');
  overlay.className = 'cv-type-overlay';
  overlay.innerHTML = blurb.innerHTML;
  blurb.appendChild(overlay);
  blurb.classList.add('cv-typing');

  var caret = document.createElement('span');
  caret.className = 'cv-caret';

  // Caret lives right after the text node currently being typed.
  function placeCaret(node) {
    var p = node.parentNode;
    if (p) p.insertBefore(caret, node.nextSibling);
  }

  // Overlay text nodes in order (skip whitespace-only). Collapse each node's
  // whitespace the way HTML renders it, so the caret never stalls on an
  // invisible source newline; trim the leading/trailing edges. A node whose
  // parent carries data-decoy types that decoy first, then backspaces it and
  // types the real text — a little "actually..." fake-out.
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
  if (!nodes.length) { overlay.remove(); blurb.classList.remove('cv-typing'); return; }
  nodes[0].text = nodes[0].text.replace(/^\s+/, '');
  nodes[nodes.length - 1].text = nodes[nodes.length - 1].text.replace(/\s+$/, '');

  // tarot reader pacing — reading-paced, with pauses on punctuation, nudged
  // quicker than the tarot reader (1.25^3); start() blanks the nodes
  var SPEED = 1.953125;
  var BASE_MS = 65;
  var BACK_MS = 30 / SPEED;  // backspacing the decoy — quick, even pace
  var timer = null;
  var finished = false;
  var idx = 0;
  function nextDelayAfter(ch) {
    if (ch === '.') return 1000;  // each dot (incl. the decoy ellipsis) holds 1s
    var d;
    switch (ch) {
      case '!': case '?':           d = 850; break;
      case ',': case ';': case ':': d = 420; break;
      case '—': case '-':      d = 480; break;
      case '\n':                    d = 1100; break;
      case ' ':                     d = 110; break;
      default:                      d = BASE_MS;
    }
    return d / SPEED;
  }

  // ⏩ skip sits inline before the blurb's first word (only while typing);
  // ⟳ replay sits after the blurb and reruns the type-out. Both injected.
  var skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'cv-skip';
  skipBtn.textContent = '⏩';
  skipBtn.setAttribute('aria-label', 'Skip the intro animation');

  var loopBtn = document.createElement('button');
  loopBtn.type = 'button';
  loopBtn.className = 'cv-loop';  // same inline button style as ⏩ (.cv-skip)
  loopBtn.textContent = '⟳';
  loopBtn.setAttribute('aria-label', 'Replay the intro animation');

  // Type `text` into `node` one char at a time, then call done().
  function typeInto(node, text, done) {
    var k = 0;
    (function tick() {
      if (finished) return;
      if (k >= text.length) { done(); return; }
      k += 1;
      node.nodeValue = text.slice(0, k);
      placeCaret(node);
      timer = setTimeout(tick, nextDelayAfter(text[k - 1]));
    })();
  }

  // Delete node's current text one char at a time, then call done().
  function backspace(node, done) {
    (function tick() {
      if (finished) return;
      var v = node.nodeValue;
      if (!v.length) { done(); return; }
      node.nodeValue = v.slice(0, -1);
      placeCaret(node);
      timer = setTimeout(tick, BACK_MS);
    })();
  }

  function runNode() {
    if (finished) return;
    if (idx >= nodes.length) { finish(); return; }
    var e = nodes[idx];
    idx += 1;
    placeCaret(e.node);
    if (e.decoy) {
      typeInto(e.node, e.decoy, function () {
        if (finished) return;
        timer = setTimeout(function () {
          backspace(e.node, function () { typeInto(e.node, e.text, runNode); });
        }, 650 / SPEED);  // hold a beat on the decoy before correcting it
      });
    } else {
      typeInto(e.node, e.text, runNode);
    }
  }

  // Click the overlay / ⏩ (or reaching the end) jumps to the final text and
  // reveals the ⟳ replay control.
  function finish() {
    if (finished) return;
    finished = true;
    if (timer) { clearTimeout(timer); timer = null; }
    nodes.forEach(function (e) { e.node.nodeValue = e.text; });
    caret.remove();
    overlay.style.cursor = '';
    skipBtn.remove();
    overlay.appendChild(loopBtn);  // ⟳ replay sits inline at the end of the blurb
  }

  // (Re)start the type-out from a blank overlay.
  function start() {
    finished = false;
    idx = 0;
    if (loopBtn.parentNode) loopBtn.remove();
    nodes.forEach(function (e) { e.node.nodeValue = ''; });
    overlay.insertBefore(skipBtn, overlay.firstChild);
    overlay.style.cursor = 'pointer';
    runNode();
  }

  skipBtn.addEventListener('click', finish);
  overlay.addEventListener('click', finish);
  // loopBtn lives inside the overlay, whose click also runs finish() — stop the
  // bubble so the replay's start() isn't immediately undone.
  loopBtn.addEventListener('click', function (e) { e.stopPropagation(); start(); });
  start();
})();
