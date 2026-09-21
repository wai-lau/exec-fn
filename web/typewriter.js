/* The guessed-pace typewriter, shared by every chat surface.
 *
 * TWO modes, and the voice decides which one runs.
 *
 * twGuess is the silent pace: a weighted per-character delay where punctuation
 * is a pause. The surfaces run it at SPEED 5 against tarot's 1.25 -- a reading
 * is paced to be listened to, while /cc, /mtg and the Exec panel are read for
 * an answer, and a typewriter that lags behind the eye is just latency with a
 * costume on.
 *
 * twAudio is the spoken pace: the same weights give the SHAPE, but the total is
 * rescaled to the measured audio duration, so the text lands with the voice
 * saying it. It began as /tarot's main path (in tarot-stream.js) and moved here
 * when the Exec panel and /cc got the same voice -- the rule being that with
 * narration on, every surface types at the narrator's speed rather than its
 * own.
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

/** Cumulative reveal weight per character, with syntax costing nothing.
 *
 * Two reasons it is free rather than cheap. The reveal jumps syntax in a single
 * frame (see twJump), so it takes no time; and the NARRATOR never says it --
 * VoiceUtil.stripMarkdown drops fences, tables and markers before the text
 * reaches TTS. Charging time for a span the voice skips is what would put a
 * long code block's worth of drift between the words on screen and the words in
 * the air on /cc, where a reply is half prose and half machinery. */
function twWeights(text, baseMs) {
  const cum = new Array(text.length + 1);
  cum[0] = 0;
  let i = 0;
  while (i < text.length) {
    const jump = twJump(text, i);
    if (jump > i) {
      for (let k = i; k < jump; k++) cum[k + 1] = cum[i];
      i = jump;
      continue;
    }
    cum[i + 1] = cum[i] + twCharWeight(text[i], baseMs);
    i += 1;
  }
  return cum;
}

/** Reveal `state.buffered` at the pace of the voice reading it.
 *
 * `state.buffered` must be FINAL: the whole point is to spread exactly this
 * text across exactly that utterance. `ctl` is a narrator controller
 * (voice-narrator.js) -- elapsed(), duration(), ended, ok.
 *
 * Upstream's {end} means the audio is BUFFERED, not played, so the reveal stays
 * synced to elapsed/duration until playback actually finishes. Every failure
 * path ends at the guessed pace: a reveal that hangs is the one outcome that
 * must never happen, because it freezes the page with the answer half-written.
 *
 * @param opts {speed, baseMs, onDone} -- speed applies to the guessed fallback.
 */
function twAudio(state, render, ctl, opts) {
  const o = opts || {};
  const baseMs = o.baseMs || TW_BASE_MS;
  const text = state.buffered;
  const cum = twWeights(text, baseMs);
  const totalW = cum[text.length] || 1;
  const startWait = performance.now();
  let lastProgress = -1;
  let lastProgressAt = performance.now();
  let done = false;

  // TTS synthesizes for a while before the first PCM chunk streams, and that
  // silent gap is NOT a failure -- kokoro can take seconds on a cold box (10.3s
  // measured off a box that had just come up). So the pre-audio wait is
  // generous; a stream that never streams still bails at the end of it.
  const FIRST_AUDIO_MS = 12000;
  // Once audio IS flowing, a 2.5s freeze (playback clock or buffer not moving)
  // means the upstream stalled mid-stream.
  const STALL_MS = 2500;

  function finish() {
    if (!done) { done = true; if (o.onDone) o.onDone(); }
  }

  function bail(reason) {
    ctl.ok = false;
    ctl.ended = true;
    if (!ctl.error) ctl.error = reason;
    twGuess(state, render, { speed: o.speed, baseMs: baseMs, onDone: finish }).start();
  }

  function finishBrisk() {   // clean end, text still behind -> mop up the tail
    if (state.cancelled) return;
    if (state.displayed.length >= text.length) { finish(); return; }
    state.displayed = text.slice(0, state.displayed.length + 2);
    render(state.displayed);
    setTimeout(finishBrisk, 16);
  }

  function tick() {
    if (state.cancelled) return;
    if (!ctl.ok) { bail(ctl.error); return; }
    const dur = ctl.duration();
    const el = ctl.elapsed();
    const started = dur > 0 || el > 0;
    // Any forward motion (playback advancing OR more audio buffered) resets the
    // stall clock -- one watchdog covers a frozen context and a dead upstream.
    // `el` is the context clock and keeps climbing after the buffer drains, so
    // a raw el+dur NEVER stops rising: an upstream that dies mid-utterance
    // without {end}/{error} defeated this watchdog entirely and hung the reveal
    // forever. Capping el at what was actually buffered freezes the signal once
    // playback catches up to a stream that stopped arriving.
    const progress = Math.min(el, dur) + dur;
    if (progress > lastProgress) { lastProgress = progress; lastProgressAt = performance.now(); }
    const audioFinished = ctl.ended && dur > 0 && el >= dur;
    if (!started) {
      if (ctl.ended) { bail('no audio'); return; }                  // ended, never made a sound
      if (performance.now() - startWait > FIRST_AUDIO_MS) { bail('no audio'); return; }
    } else if (!audioFinished && performance.now() - lastProgressAt > STALL_MS) {
      bail('no audio'); return;
    }
    if (dur > 0) {
      let frac = Math.min(el / dur, audioFinished ? 1 : 0.999);
      frac = Math.max(0, Math.min(1, frac));
      const targetW = frac * totalW;
      let n = state.displayed.length;
      while (n < text.length && cum[n + 1] <= targetW) n++;
      if (n !== state.displayed.length) { state.displayed = text.slice(0, n); render(state.displayed); }
    }
    if (audioFinished && state.displayed.length >= text.length) { finish(); return; }
    if (audioFinished) { finishBrisk(); return; }
    requestAnimationFrame(tick);
  }

  return { start: tick };
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
