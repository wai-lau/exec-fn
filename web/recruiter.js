// Types the summary blurb out on load, at the tarot reader's reading pace
// (per-character delays, longer pauses on punctuation). Only the blurb types;
// the rest of the résumé renders normally. The page is static HTML, so we
// snapshot the blurb's text nodes, blank them, then write the characters back
// behind a blinking caret that disappears once the blurb is fully typed.
(function () {
  'use strict';
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
  var nodes = [];
  var n;
  while ((n = walker.nextNode())) nodes.push({ node: n, text: n.nodeValue.replace(/\s+/g, ' ') });
  if (!nodes.length) return;
  nodes[0].text = nodes[0].text.replace(/^\s+/, '');
  nodes[nodes.length - 1].text = nodes[nodes.length - 1].text.replace(/\s+$/, '');

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;  // full text already shown; no typing, no caret

  nodes.forEach(function (e) { e.node.nodeValue = ''; });

  // tarot reader pacing — slow, reading-paced, with pauses on punctuation
  var SPEED = 1.25;
  var BASE_MS = 65;
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

  var i = 0;  // node index
  var c = 0;  // char index within the current node
  function step() {
    if (i >= nodes.length) { caret.remove(); return; }  // done — caret gone
    var e = nodes[i];
    if (c < e.text.length) {
      c += 1;
      e.node.nodeValue = e.text.slice(0, c);
      placeCaret(e.node);
      setTimeout(step, nextDelayAfter(e.text[c - 1]));
    } else {
      placeCaret(e.node);
      i += 1;
      c = 0;
      step();  // next node, no extra pause
    }
  }
  step();
})();
