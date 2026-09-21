/* /cc — the composer: caret mirror, Enter, paste, iOS first-gesture focus.
 *
 * Split out of cc.js at the 500-line cap. Same global scope, and loaded AFTER
 * cc.js rather than before it (the order every other cc-*.js uses): this file
 * touches `_msgInput` and calls `renderCaret()` at load, and a top-level const
 * in a classic script is only initialised when ITS script runs -- reading
 * cc.js's consts from a file loaded first is a TDZ error, not a hoist.
 *
 * The idioms are mtg.js's, kept deliberately: a contenteditable box with a
 * mirrored caret (a real caret cannot be styled to the terminal block), plain
 * text on paste (rich HTML drags in colours invisible on black), images off
 * clipboardData.files before the text path, and a one-shot pointerdown focus
 * because iOS raises the keyboard only inside a user gesture.
 */

// ── input (mtg idioms) ────────────────────────────────────────────────────
const _pre = document.getElementById('input-pre');
const _post = document.getElementById('input-post');
const _inputCursor = document.getElementById('input-cursor');

// Shared with the other three transcripts — see chat-dom.js.
const _caret = chatCaret(_msgInput, _pre, _post);
const renderCaret = _caret.render;

_msgInput.addEventListener('input', () => { renderCaret(); syncInputH(); });
_msgInput.addEventListener('blur', () => { _inputCursor.style.display = 'none'; });
_msgInput.addEventListener('focus', () => { _inputCursor.style.display = ''; renderCaret(); });
_msgInput.addEventListener('keyup', renderCaret);
_msgInput.addEventListener('click', renderCaret);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === _msgInput) renderCaret();
});
_msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
// Paste plain text only: rich HTML drags in inline colors (invisible on the dark
// terminal) and stray nodes the input wasn't built for.
_msgInput.addEventListener('paste', e => {
  const cd = e.clipboardData || window.clipboardData;
  // A screenshot paste carries an image FILE, not text. Take those first;
  // anything else falls through to the plain-text path below, which exists
  // because rich HTML drags in inline colors invisible on a dark terminal.
  const files = Array.from(cd.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    Promise.all(files.slice(0, 4).map(shrink)).then(list => {
      for (const im of list) if (im && pending.length < 4) pending.push(im);
      thumbStrip();
    });
    return;
  }
  e.preventDefault();
  const text = cd.getData('text/plain');
  document.execCommand('insertText', false, text);
  renderCaret();
  syncInputH();
});
/* [x] is /new typed for you -- the same call, the same archive-first
 * guarantee, the same sys line -- because on a phone the command that is
 * reached for most is the one that is most annoying to type. A run in flight is
 * interrupted first: dropping the session pointer out from under a live query
 * leaves the reply streaming into a conversation that no longer exists. */
document.getElementById('cc-new').addEventListener('click', async () => {
  if (streaming) await ccInterrupt();
  await runCommand('/new');
});

_msgInput.focus();
renderCaret();

// iOS raises the soft keyboard only for a focus() inside a user gesture, so the
// on-load focus above can't summon it. Seat focus on the first interaction.
(function () {
  const onFirst = e => {
    // `.mic` is the `$` prompt: a SPAN, so it is not in the list of things that
    // look like controls, and the preventDefault below ate the very first tap
    // on it -- the mic only opened on the second try, from a cold page.
    if (e.target.closest('button, a, input, textarea, [contenteditable], .mic')) {
      document.removeEventListener('pointerdown', onFirst, true);
      return;
    }
    // Empty-space tap: completing it on a non-editable element would blur the
    // input we just focused and iOS drops the keyboard.
    e.preventDefault();
    document.removeEventListener('pointerdown', onFirst, true);
    _msgInput.focus({ preventScroll: true });
    if (document.activeElement === _msgInput) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(_msgInput);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      renderCaret();
    }
  };
  document.addEventListener('pointerdown', onFirst, { capture: true, passive: false });
})();
