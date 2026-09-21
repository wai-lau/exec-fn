/* The DOM pieces every chat surface builds the same way.
 *
 * Four transcripts (/cc, /mtg, /tarot, the Exec panel) each had their own copy
 * of these two, and copies drift: the panel's caret mirror was still missing
 * the try/catch the other three grew after WebKit threw IndexSizeError on a
 * stale selection and blanked the page mid-send. One copy cannot drift.
 *
 * Same global scope as its callers (classic scripts, loaded before them).
 */
'use strict';

/** The assistant bubble a turn streams into, carrying the waiting cursor.
 *
 * The cursor is the surface's own (`#blinkcursor` on the document pages,
 * `#exec-bc` in the panel, `.reader-cursor` at the reading table) because each
 * is styled where that surface's CSS lives; everything around it is identical.
 * A blinking block, never three dots: a terminal that is thinking shows a
 * cursor.
 */
function chatStreamDiv(termEl, opts) {
  const o = opts || {};
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const cur = document.createElement('span');
  if (o.id) cur.id = o.id;
  if (o.className) cur.className = o.className;
  // The dot-triplet cursors animate their three spans; the reader's is a solid
  // block drawn by CSS alone.
  if (!o.className) cur.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(cur);
  div.appendChild(body);
  termEl.appendChild(div);
  if (o.scroll) termEl.scrollTop = termEl.scrollHeight;
  return { div: div, body: body, cur: cur };
}

/** The caret mirror for a contenteditable composer.
 *
 * The composer is a contenteditable with its own drawn cursor: `pre` and `post`
 * hold the text either side of the insertion point, and the cursor element sits
 * between them. This measures where that point is.
 */
function chatCaret(input, pre, post) {
  function offset() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !input.contains(sel.anchorNode)) return input.innerText.length;
    const range = document.createRange();
    range.selectNodeContents(input);
    // After clearing the input on submit, the stale selection offset can point
    // past the emptied node -- WebKit THROWS IndexSizeError where Chromium
    // clamps. Falling back keeps render() (and therefore the send that called
    // it) from aborting and blanking the page.
    try {
      range.setEnd(sel.anchorNode, sel.anchorOffset);
    } catch {
      return input.innerText.length;
    }
    return range.toString().length;
  }

  function render() {
    const text = input.innerText;
    const pos = offset();
    pre.textContent = text.slice(0, pos);
    post.textContent = text.slice(pos);
  }

  return { render: render, offset: offset };
}
