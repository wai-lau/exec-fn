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
