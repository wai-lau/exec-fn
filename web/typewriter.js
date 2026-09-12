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
      // A fenced block is not prose and nobody reads it as it arrives -- an SVG
      // diagram typed backtick by backtick is markup scrolling past, not a
      // picture being drawn. Jump the whole block in one frame. While it is
      // still unclosed (the stream is mid-block) reveal everything there is and
      // keep jumping, so the typewriter never crawls through markup.
      const i = state.displayed.length;
      // Table openings, like fenced blocks, are structure rather than prose.
      // Only at a line start, or a `|` mid-sentence would be mistaken for one.
      if (i === 0 || state.buffered[i - 1] === '\n') {
        const head = twTableHead(state.buffered, i);
        if (head > i) {
          state.displayed = state.buffered.slice(0, head);
          render(state.displayed);
          setTimeout(step, 0);
          return;
        }
      }
      if (state.buffered.startsWith('```', i)) {
        const end = twFenceEnd(state.buffered, i);
        state.displayed = state.buffered.slice(0, end === -1 ? state.buffered.length : end);
        render(state.displayed);
        setTimeout(step, 0);
        return;
      }
      state.displayed = state.buffered.slice(0, state.displayed.length + 1);
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
