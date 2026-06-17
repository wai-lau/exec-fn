// Types the résumé out on load, like the tarot reader's char-by-char reveal.
// The page is static HTML (no stream), so we snapshot every text node, blank
// them, then write the characters back in document order with a caret that
// travels along and finally rests after the name.
(function () {
  'use strict';
  var root = document.querySelector('.cv');
  if (!root) return;

  var caret = document.createElement('span');
  caret.className = 'cv-caret';

  // Park the caret after the name as the resting signature.
  function rest() {
    var h1 = root.querySelector('h1');
    if (h1) h1.appendChild(caret);
  }

  // Caret lives right after the text node currently being typed.
  function placeCaret(node) {
    var p = node.parentNode;
    if (p) p.insertBefore(caret, node.nextSibling);
  }

  // Collect text nodes in document order, skipping whitespace-only ones.
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      return /\S/.test(n.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });
  var nodes = [];
  var n;
  while ((n = walker.nextNode())) nodes.push({ node: n, text: n.nodeValue });

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !nodes.length) { rest(); return; }

  var total = nodes.reduce(function (a, e) { return a + e.text.length; }, 0);
  nodes.forEach(function (e) { e.node.nodeValue = ''; });

  // RATE = characters per millisecond. ~0.9 types a full résumé in ~2s — a
  // brisk typing pace, not a reading one. Bump to go faster.
  var RATE = 0.9;
  var i = 0;        // node index
  var c = 0;        // char index within the current node
  var written = 0;  // chars revealed so far (for time-based pacing)
  var start = null;

  function tick(ts) {
    if (start === null) start = ts;
    var target = Math.min(total, Math.ceil((ts - start) * RATE));
    while (written < target && i < nodes.length) {
      var e = nodes[i];
      if (c < e.text.length) {
        c += 1;
        written += 1;
        e.node.nodeValue = e.text.slice(0, c);
      } else {
        placeCaret(e.node);
        i += 1;
        c = 0;
      }
    }
    if (i < nodes.length) {
      placeCaret(nodes[i].node);
      requestAnimationFrame(tick);
    } else {
      rest();
    }
  }
  requestAnimationFrame(tick);
})();
