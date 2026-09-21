/* /cc's reveal — the typewriter, and who sets its pace.
 *
 * One of these per assistant bubble. It owns the shared mutable state the
 * engine in typewriter.js reads (`buffered` from the caller, `displayed` from
 * the engine) and picks between the two paces:
 *
 *   SILENT   twGuess at SPEED 5 -- /cc is read for an answer, and a typewriter
 *            the eye outruns is latency wearing a costume.
 *   SPOKEN   twAudio, the same weights rescaled to the measured utterance, so
 *            the words land as GLaDOS says them.
 *
 * With the voice on, push() deliberately does NOT start revealing: the text
 * buffers while it streams and the reveal begins when the utterance does.
 * Typing at 5 under a voice would finish the answer before it had been read
 * out, which is two versions of the same reply racing each other.
 *
 * Loaded before cc.js, same global scope, so it calls renderText(),
 * ccRenderSvgBlocks(), ccClosedSvgCount(), atBottom() and terminal by bare
 * name -- the same arrangement cc-mic.js has with sendMsg().
 */
'use strict';

// Chat pace: FOUR times the tarot reader's 1.25. A reading is paced to be
// listened to; this page is read for an answer.
const CC_TYPE_SPEED = 5;

function ccVoiceOn() {
  return !!(window.execVoice && execVoice.isOn() && execVoice.ready());
}

function ccTyper(body, cur) {
  const tw = { buffered: '', displayed: '', serverDone: false, cancelled: false };
  let typing = null;

  function render(shown) {
    body.innerHTML = renderText(shown);
    // Swap in every diagram whose closing fence has already arrived. A finished
    // SVG used to sit as raw markup until the WHOLE reply settled, so a picture
    // the model had finished drawing was still scrolling past as source. Only
    // CLOSED blocks: a half-written one would flicker.
    ccRenderSvgBlocks(body, ccClosedSvgCount(shown));
    (body.lastElementChild || body).appendChild(cur);
    if (atBottom()) terminal.scrollTop = terminal.scrollHeight;
  }

  function startGuess() {
    if (typing) return typing;
    typing = new Promise((resolve) => {
      twGuess(tw, render, { speed: CC_TYPE_SPEED, onDone: resolve }).start();
    });
    return typing;
  }

  /** Text arrived. Buffer it either way; reveal only when no voice will claim
   *  the pace. */
  function push(text) {
    tw.buffered = text;
    if (!ccVoiceOn()) startGuess();
  }

  /** Speak finished prose, and pace its reveal to the voice when THIS utterance
   *  is the one about to play.
   *
   *  A segment landing behind something already speaking (the queue in
   *  voice-narrator.js) takes the guessed pace instead: its audio may be a
   *  minute away, and twAudio would sit out its first-audio window and bail to
   *  the same place anyway. Same for a dead controller -- voice off, never
   *  unlocked, piper unreachable. */
  function speakAndPace(text) {
    tw.serverDone = true;
    if (!text || !window.execVoice) { startGuess(); return null; }
    const queuedBehind = execVoice.isSpeaking();
    const ctl = execVoice.speak(text);
    if (ctl.ok && !queuedBehind && !typing) {
      typing = new Promise((resolve) => {
        twAudio(tw, render, ctl, { speed: CC_TYPE_SPEED, onDone: resolve }).start();
      });
    } else {
      startGuess();
    }
    return ctl;
  }

  /** Wait for the reveal to land. Starts one if nothing has: with the voice on
   *  nothing types until the utterance begins, so a turn that ends without one
   *  would otherwise settle a bubble that never showed a character. */
  function done() {
    tw.serverDone = true;
    return startGuess();
  }

  /** A tool call closed this bubble. Cancel the reveal so a typer still running
   *  against it cannot write into the bubble that opens next. */
  function cancel() {
    tw.cancelled = true;
  }

  return { push, speakAndPace, done, cancel };
}
