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

  var caret = document.createElement('span');
  caret.className = 'cv-caret';

  // Caret lives right after the text node currently being typed.
  function placeCaret(node) {
    var p = node.parentNode;
    if (p) p.insertBefore(caret, node.nextSibling);
  }

  // Blurb text nodes in order (skip whitespace-only). Collapse each node's
  // whitespace the way HTML renders it, so the caret never stalls on an
  // invisible source newline; trim the leading/trailing edges.
  var walker = document.createTreeWalker(blurb, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  // A node whose parent carries data-decoy types that decoy first, then
  // backspaces it and types the real text — a little "actually..." fake-out.
  var nodes = [];
  var n;
  while ((n = walker.nextNode())) {
    var par = n.parentNode;
    var decoy = (par && par.getAttribute) ? par.getAttribute('data-decoy') : null;
    nodes.push({ node: n, text: n.nodeValue.replace(/\s+/g, ' '), decoy: decoy });
  }
  if (!nodes.length) return;
  nodes[0].text = nodes[0].text.replace(/^\s+/, '');
  nodes[nodes.length - 1].text = nodes[nodes.length - 1].text.replace(/\s+$/, '');

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;  // full text already shown; no typing, no caret

  nodes.forEach(function (e) { e.node.nodeValue = ''; });

  // tarot reader pacing — reading-paced, with pauses on punctuation, nudged
  // 1.25x quicker than the tarot reader (1.25 * 1.25)
  var SPEED = 1.5625;
  var BASE_MS = 65;
  var BACK_MS = 30 / SPEED;  // backspacing the decoy — quick, even pace
  function nextDelayAfter(ch) {
    var d;
    switch (ch) {
      case '.': case '!': case '?': d = 850; break;
      case ',': case ';': case ':': d = 420; break;
      case '—': case '-':      d = 480; break;
      case '\n':                    d = 1100; break;
      case ' ':                     d = 110; break;
      default:                      d = BASE_MS;
    }
    return d / SPEED;
  }

  // Type `text` into `node` one char at a time, then call done().
  function typeInto(node, text, done) {
    var k = 0;
    (function tick() {
      if (k >= text.length) { done(); return; }
      k += 1;
      node.nodeValue = text.slice(0, k);
      placeCaret(node);
      setTimeout(tick, nextDelayAfter(text[k - 1]));
    })();
  }

  // Delete node's current text one char at a time, then call done().
  function backspace(node, done) {
    (function tick() {
      var v = node.nodeValue;
      if (!v.length) { done(); return; }
      node.nodeValue = v.slice(0, -1);
      placeCaret(node);
      setTimeout(tick, BACK_MS);
    })();
  }

  var idx = 0;
  function runNode() {
    if (idx >= nodes.length) { caret.remove(); return; }  // done — caret gone
    var e = nodes[idx];
    idx += 1;
    placeCaret(e.node);
    if (e.decoy) {
      typeInto(e.node, e.decoy, function () {
        setTimeout(function () {
          backspace(e.node, function () { typeInto(e.node, e.text, runNode); });
        }, 650 / SPEED);  // hold a beat on the decoy before correcting it
      });
    } else {
      typeInto(e.node, e.text, runNode);
    }
  }
  runNode();
})();
