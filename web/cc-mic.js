/* Hands-free input for /cc, on the browser's own speech recognition.
 *
 * The keyboard's dictation key already types into this field, so this is not
 * about making speech possible -- it is about not needing the keyboard at all:
 * tap once, talk, and the message sends itself when you stop. That matters on a
 * page whose whole use is one-handed at odd hours.
 *
 * webkitSpeechRecognition is the native API (Safari, Chrome); Firefox has none,
 * and a home-screen launch on iOS has historically been the flakiest host for
 * it. Where it is missing the prompt stays an ordinary `$` and nothing is
 * wired -- a missing API costs an affordance, never a dead control that does
 * nothing when tapped.
 *
 * THE CONTROL IS THE PROMPT. A separate button belongs at the right end of the
 * input line, which is exactly where the Exec bubble rests (right: 14px, bottom
 * nav + 10) -- it intercepted the taps, measured. The `$` is already a
 * one-character cell in the shared 1ch gutter, so using it costs no width,
 * cannot collide, and keeps the composer aligned with the transcript above it.
 * It turns into a filled dot while listening.
 *
 * Loaded before cc.js, same global scope, so it calls sendMsg() and
 * syncInputH() by bare name like its own functions.
 */
'use strict';

const CC_MIC_IDLE = '$';
const CC_MIC_LIVE = '●';   // the prompt itself, lit while listening

let ccRec = null;
let ccMicOn = false;
let ccMicSent = false;
let ccMicTimer = 0;
// Results already sent. With a continuous session e.results KEEPS every result
// of the session, so without a floor each new utterance would resend the whole
// conversation so far.
let ccMicBase = 0;
// NO held getUserMedia stream, deliberately. One was added to keep iOS's audio
// session warm across a long silence, and it worked, but Safari gates
// getUserMedia (microphone) and speech recognition SEPARATELY -- so opening a
// voice session asked for permission twice, which is a worse bug than the one
// it fixed. The recovery path carries it instead: every error is silent, every
// restart builds a fresh recognizer, and a refused start is retried. If
// `audio-capture` ever becomes common again, the held stream is the fix, and
// the second prompt is its price.
// Consecutive failed restarts. A recognizer that cannot be restarted must not
// be retried forever; ten is far past any transient hiccup.
let ccMicFails = 0;
const CC_MIC_MAX_FAILS = 10;
const CC_MIC_RETRY_MS = 300;
// A voice SESSION, not a single dictation: tapping the prompt starts a
// back-and-forth, and the mic re-opens as soon as Claude has finished
// answering. Scoped deliberately -- a turn you typed never opens the
// microphone, because a page that starts listening on its own is a page you
// have to remember to switch off.
let ccMicMode = false;
// Long enough for the reply to finish rendering, short enough to feel like a
// conversation rather than a form.
const CC_MIC_REARM_MS = 350;

// A recognizer that never fires `end` holds the microphone open for as long as
// the page lives. Safari has done exactly that when a handler threw, so the
// watchdog is a second line of defence rather than a nicety. Generous, because
// a session is now meant to span several turns -- it is a stuck-mic backstop,
// not an utterance timer.
const CC_MIC_MAX_MS = 180000;

function ccMicSupported() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function ccMicSet(btn, live) {
  ccMicOn = live;
  btn.textContent = live ? CC_MIC_LIVE : CC_MIC_IDLE;
  btn.dataset.live = live ? 'true' : 'false';
  btn.title = live ? 'Stop listening' : 'Speak';
  btn.setAttribute('aria-pressed', String(live));
}

/** Dim the dot while a reply is streaming: the mic is open but nothing said
 *  into it will be kept, and a control that looks identical either way is how
 *  you end up talking into a bin. */
function ccMicBusyPaint() {
  const btn = document.getElementById('input-prompt');
  if (!btn || !btn.classList.contains('mic')) return;
  btn.dataset.drop = ccMicOn && ccMicBusy() ? 'true' : 'false';
}

/** Put what has been heard so far into the composer, as if typed. */
function ccMicFill(text) {
  const input = document.getElementById('msg-input');
  if (!input) return;
  input.textContent = text;
  if (typeof syncInputH === 'function') syncInputH();
  if (typeof renderCaret === 'function') renderCaret();
}

/** End the session and put the prompt back, without sending. Ends the voice
 *  session too: every caller is a deliberate stop or a failure. */
function ccMicStop(btn) {
  ccMicSent = true;
  ccMicMode = false;
  ccMicFails = 0;
  ccMicKill();
  ccMicSet(btn, false);
  ccMicBusyPaint();
}

/** Tear the recognizer down completely.
 *
 * Handlers are detached first: an aborted instance still fires `end`, and a
 * corpse calling back into the restart path is how one dead recognizer turned
 * into a mic that no tap could revive. */
function ccMicKill() {
  clearTimeout(ccMicTimer);
  if (!ccRec) return;
  ccRec.onresult = null;
  ccRec.onend = null;
  ccRec.onerror = null;
  try { ccRec.abort(); } catch { /* already gone */ }
  ccRec = null;
}

/** Is a reply streaming right now?
 *
 * cc.js's `streaming` is a top-level `let`, so it is a global lexical binding
 * rather than a window property -- readable by bare name from here, but only
 * after cc.js has evaluated. Every call site runs during a session, long after
 * that, and the try/catch covers the impossible case rather than assuming it. */
function ccMicBusy() {
  try { return typeof streaming !== 'undefined' && streaming; } catch { return false; }
}

/** Is a voice session live (listening, or waiting to listen again)? */
function ccMicActive() {
  return ccMicMode || ccMicOn;
}

function ccMicStart(btn) {
  const Rec = ccMicSupported();
  if (!Rec) return;
  ccMicKill();          // never two recognizers, never a corpse still wired up
  // Drop the keyboard if it is up. Voice mode does not need it, and on a phone
  // the keyboard is what shrinks the viewport and takes the nav bar with it --
  // the whole screen reshuffles for an input nobody is typing into.
  const input = document.getElementById('msg-input');
  if (input && document.activeElement === input) input.blur();
  ccMicSent = false;
  ccMicBase = 0;
  ccRec = new Rec();
  ccRec.lang = navigator.language || 'en-US';
  // Interim results are what make it feel like dictation rather than a form:
  // the words appear while you are still saying them.
  ccRec.interimResults = true;
  // CONTINUOUS, and this is the whole fix for "it didn't re-arm". iOS refuses
  // recognition.start() outside a user gesture, so re-opening the mic a few
  // hundred ms after a reply -- which is nowhere near a tap -- is simply
  // denied. One gesture has to cover the whole session, so the recognizer is
  // never stopped between turns: it stays open, the send happens on each final
  // result, and the next thing said is just the next result.
  ccRec.continuous = true;
  ccRec.maxAlternatives = 1;

  ccRec.onresult = (e) => {
    try {
      // DROP whatever is heard while a reply is streaming. The mic cannot be
      // paused and resumed -- stop() needs no gesture but start() does, so a
      // pause would be one-way and the session could never restart itself. So
      // it stays open and the bytes go in the bin: the results are marked
      // consumed so they can never surface as part of the next utterance, and
      // the composer is left empty. Talking over the answer costs nothing
      // rather than sending half a sentence.
      if (ccMicBusy()) {
        ccMicBase = e.results.length;
        ccMicFill('');
        ccMicBusyPaint();
        return;
      }
      let text = '';
      let done = false;
      // INDEX LOOP, not for...of. SpeechRecognitionResultList is array-LIKE in
      // Safari with no Symbol.iterator, so for...of threw TypeError here --
      // which killed the handler before it could fill the composer or call
      // stop(), leaving the recognizer running with its audio session hot. That
      // is what "it never sends" and "the whole page freezes" both were.
      for (let i = ccMicBase; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (alt && alt.transcript) text += alt.transcript;
        if (res.isFinal) done = true;
      }
      ccMicFill(text.trim());
      // Sending happens HERE now, not in onend: the recognizer is never stopped
      // between turns, so there is no end to hang it off.
      if (done) {
        ccMicBase = e.results.length;
        const said = text.trim();
        if (said && typeof sendMsg === 'function') { sendMsg(); ccMicBusyPaint(); }
      }
    } catch {
      // A throw in here once killed the handler before it could send or stop,
      // which is how the mic silently stopped working. Swallow it, mark what
      // arrived as consumed so it cannot resurface glued to the next utterance,
      // and let the session carry on -- one lost sentence beats a dead mic.
      try { ccMicBase = e.results.length; } catch { /* nothing usable */ }
    }
  };

  // NOTHING here is shown. `no-speech` after a pause, `audio-capture` when iOS
  // drops an idle audio session, `network` on a flaky connection -- these are
  // weather, not failures, and a red line in the transcript for each one made a
  // working session look broken. `end` follows every error, so the restart path
  // there is the single place that decides what happens next. The one thing an
  // error must not do is end a session the user never ended.
  ccRec.onerror = () => {};

  // iOS ends a recognizer on silence even in continuous mode, so `end` is an
  // ordinary mid-session event rather than the end of one. Silence no longer
  // ends a session either: a session ends when it is tapped off, and not
  // before -- the held stream is what makes an idle one survivable.
  ccRec.onend = () => {
    clearTimeout(ccMicTimer);
    if (!ccMicMode) { ccMicSet(btn, false); return; }   // tapped off
    // A FRESH recognizer every time. Restarting an ended instance is what
    // Safari is least reliable about, and a dead one that still holds the audio
    // session is how the mic stopped answering any tap at all.
    setTimeout(() => { if (ccMicMode) ccMicStart(btn); }, CC_MIC_RETRY_MS);
  };

  try {
    ccRec.start();
    ccMicFails = 0;
    ccMicSet(btn, true);
    clearTimeout(ccMicTimer);
    ccMicTimer = setTimeout(() => { try { ccRec.stop(); } catch { /* gone */ } }, CC_MIC_MAX_MS);
  } catch {
    // Refused (no gesture, or one still winding down). Retry quietly; give up
    // silently rather than ever printing at her, and leave the prompt idle so a
    // tap is obviously the way back.
    ccMicSet(btn, false);
    if (ccMicMode && ++ccMicFails < CC_MIC_MAX_FAILS) {
      setTimeout(() => { if (ccMicMode) ccMicStart(btn); }, CC_MIC_RETRY_MS);
    } else {
      ccMicStop(btn);
    }
  }
}

function ccMicInit() {
  const btn = document.getElementById('input-prompt');
  if (!btn) return;
  if (!ccMicSupported()) return;    // no API: the prompt stays a plain `$`
  btn.classList.add('mic');
  ccMicSet(btn, false);
  btn.addEventListener('click', () => {
    if (ccMicOn && ccRec) { ccMicStop(btn); try { ccRec.abort(); } catch { /* gone */ } return; }
    ccMicMode = true;          // a tap opens a session, not one dictation
    ccMicStart(btn);
    ccMicBusyPaint();
  });

  // Claude has finished answering. In a continuous session the recognizer never
  // stopped and this does nothing; it is the fallback for a browser that ends
  // recognition per utterance anyway.
  const term = document.getElementById('terminal');
  if (term) {
    term.addEventListener('cc:reply-done', () => {
      ccMicBusyPaint();
      if (!ccMicMode || ccMicOn) return;
      setTimeout(() => { if (ccMicMode && !ccMicOn) ccMicStart(btn); }, CC_MIC_REARM_MS);
    });
  }
}

// Backgrounding the tab with the mic live leaves iOS holding the audio session.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ccMicActive()) ccMicStop(document.getElementById('input-prompt'));
});

ccMicInit();
