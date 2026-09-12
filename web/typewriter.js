/* The guessed-pace typewriter, shared by every chat surface.
 *
 * It began as /tarot's silent fallback -- the path taken when the reader's
 * audio fails or has not been unlocked -- and it is the half of that engine
 * with nothing tarot-specific in it: a weighted per-character delay, where
 * punctuation is a pause. Tarot's other mode (pacing the reveal off the
 * measured audio clock) stays in tarot-stream.js, since without narration
 * there is no clock to pace to.
 *
 * The three chat surfaces run it at SPEED 3 against tarot's 1.25. A reading is
 * paced to be listened to; /cc, /mtg and the Exec panel are read for an answer,
 * and a typewriter that lags behind the eye is just latency with a costume on.
 *
 * STATE IS SHARED AND MUTABLE, by design: the caller appends to `buffered` as
 * the stream arrives and sets `serverDone` at the end, while this owns
 * `displayed`. That is the contract tarot already had; it is repeated here
 * rather than invented.
 */
'use strict';

const TW_BASE_MS = 65;

/** Per-character delay in ms. The SHAPE of the reveal: punctuation is a beat. */
function twCharWeight(ch, baseMs) {
  switch (ch) {
    case '.': case '!': case '?': return 850;
    case ';':                     return 620; // more than comma, less than period
    case ',': case ':':           return 420;
    case '—': case '-':           return 480; // em-dash, hyphen
    case '\n':                    return 1100;
    case ' ':                     return 110;
    default:                      return baseMs || TW_BASE_MS;
  }
}

/** Where a fenced block that opens at `from` ends, or -1 while it is unclosed.
 *
 * Includes the closing fence's own line: the whole block is one unit, and
 * stopping on the last backtick would leave the fence typing itself out. */
function twFenceEnd(text, from) {
  const close = text.indexOf('\n```', from + 3);
  if (close === -1) return -1;
  const after = text.indexOf('\n', close + 1);
  return after === -1 ? text.length : after + 1;
}

/** Where a markdown table's opening lines end, or -1 if this is not one.
 *
 * A table is only a table once its `|---|---|` separator is complete: until
 * then markdown renders the header as a line of raw pipes, so typing those two
 * lines character by character shows a row of punctuation slowly turning into a
 * table. Both are revealed at once instead. Only the OPENING is jumped -- the
 * body rows are prose and type like everything else.
 *
 * `from` must be a line start, and the pattern is deliberately strict: a header
 * row, then a separator of nothing but pipes, dashes, colons and spaces. */
function twTableHead(text, from) {
  const rest = text.slice(from, from + 2000);
  const m = /^\|[^\n]*\|[ \t]*\r?\n[ \t]*\|[ :|<>=-]*\|[ \t]*(\r?\n|$)/.exec(rest);
  return m ? from + m[0].length : -1;
}

/** Where a markdown link's `](url)` tail ends, or -1 if it is not there yet.
 *
 * The label is the only part anyone reads -- the URL is machinery, and typing
 * it out character by character spends seconds rendering something that will
 * not even be visible once the link closes. So the label types and the tail
 * arrives whole.
 *
 * Returns -1 while the closing paren has not streamed in: jumping to the end of
 * what has arrived would reveal half a URL as text and then take it back. */
function twLinkTail(text, from) {
  if (!text.startsWith('](', from)) return -1;
  const close = text.indexOf(')', from + 2);
  if (close === -1 || close - from > 500) return -1;
  return close + 1;
}

/* Syntax that is not prose. Markdown's markers are instructions to the
 * renderer: a `#` becomes a heading, a `-` becomes a bullet, `**` becomes
 * weight. Typing them out shows punctuation that then vanishes -- the reader
 * watches the machinery instead of the sentence. Everything here is revealed in
 * one frame; only the words between them type.
 *
 * BLOCK markers count only at a line start (a `-` mid-sentence is a dash, a `#`
 * is a hash); inline ones count anywhere. */
const TW_BLOCK_RE = /^(?:#{1,6} +|>[ \t]?|[-*+] +|\d{1,9}[.)] +|(?:---+|\*\*\*+|___+)[ \t]*(?:\r?\n|$))/;
const TW_INLINE_RE = /^(?:!\[[^\]]*\]\([^)\s]{0,500}\)|\*\*\*|\*\*|__|~~|[*_`[])/;

/** The index to jump to for any syntax at `i`, or -1 to type the next char.
 *
 * Order is by size, largest first: a fenced block swallows everything inside
 * it, a table opening spans two lines, an image is one token, and the small
 * markers are last. */
function twJump(text, i) {
  const atStart = i === 0 || text[i - 1] === '\n';
  if (atStart) {
    const head = twTableHead(text, i);
    if (head > i) return head;
  }
  if (text.startsWith('```', i)) {
    const end = twFenceEnd(text, i);
    return end === -1 ? text.length : end;
  }
  const tail = twLinkTail(text, i);
  if (tail > i) return tail;
  const rest = text.slice(i, i + 600);
  const m = (atStart && TW_BLOCK_RE.exec(rest)) || TW_INLINE_RE.exec(rest);
  return m ? i + m[0].length : -1;
}

/** Reveal `state.buffered` one character at a time.
 *
 * @param state  {buffered, displayed, serverDone, cancelled} -- shared, mutable
 * @param render called after each character with the revealed text
 * @param opts   {speed, baseMs, onDone}
 */
function twGuess(state, render, opts) {
  const o = opts || {};
  const speed = o.speed || 1.25;
  const baseMs = o.baseMs || TW_BASE_MS;
  let done = false;

  function step() {
    if (state.cancelled) return;
    if (state.displayed.length < state.buffered.length) {
      const i = state.displayed.length;
      const jump = twJump(state.buffered, i);
      if (jump > i) {
        state.displayed = state.buffered.slice(0, jump);
        render(state.displayed);
        setTimeout(step, 0);
        return;
      }
      state.displayed = state.buffered.slice(0, i + 1);
      render(state.displayed);
      const last = state.displayed[state.displayed.length - 1];
      setTimeout(step, twCharWeight(last, baseMs) / speed);
      return;
    }
    // Caught up. If the stream is still open the next chunk is coming, so idle
    // rather than finish -- finishing early is what would make a reply arrive
    // in two halves with a settled render between them.
    if (!state.serverDone) { setTimeout(step, 50); return; }
    if (!done) { done = true; if (o.onDone) o.onDone(); }
  }

  return { start: step };
}
