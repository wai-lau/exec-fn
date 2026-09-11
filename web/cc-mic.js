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
// Did this recognizer instance hear anything at all? Silence is how a session
// ends; a restart loop that never hears anything would hold the mic open for
// the life of the page.
let ccMicHeard = false;
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
  clearTimeout(ccMicTimer);
  ccMicSet(btn, false);
}

/** Same, but say why on the page -- there is no console on a phone. */
function ccMicFail(btn, why) {
  ccMicStop(btn);
  try { ccRec.abort(); } catch { /* already dead */ }
  if (typeof addMsg === 'function') addMsg('sys warn', '[ mic: ' + why + ' ]');
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
  // Drop the keyboard if it is up. Voice mode does not need it, and on a phone
  // the keyboard is what shrinks the viewport and takes the nav bar with it --
  // the whole screen reshuffles for an input nobody is typing into.
  const input = document.getElementById('msg-input');
  if (input && document.activeElement === input) input.blur();
  ccMicSent = false;
  ccMicHeard = false;
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
      ccMicHeard = true;
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
    } catch (err) {
      ccMicFail(btn, err && err.message ? err.message : 'result error');
    }
  };

  // A refused or failed recognition must not leave the prompt lit and the page
  // looking like it is still listening. The reason is SHOWN, not swallowed: a
  // mic that silently does nothing is indistinguishable from a broken page,
  // and this one is used on a phone where there is no console to check.
  ccRec.onerror = (e) => {
    // `no-speech` and `aborted` are ordinary outcomes of tapping and not
    // talking -- ending quietly is the right answer for those.
    const code = (e && e.error) || 'error';
    if (code === 'no-speech' || code === 'aborted') { ccMicStop(btn); return; }
    ccMicFail(btn, code);
  };

  // iOS ends a recognizer on silence even in continuous mode, so `end` is a
  // normal event mid-session rather than the end of one.
  ccRec.onend = () => {
    clearTimeout(ccMicTimer);
    ccMicSet(btn, false);
    if (!ccMicMode) return;                 // tapped off, or failed
    if (!ccMicHeard) { ccMicMode = false; return; }   // silence ends the session
    // Heard something, so the session continues: pick the mic straight back up.
    // This start() is still outside a gesture and Safari may refuse it -- if it
    // does, say so rather than leaving a prompt that looks armed and is not.
    try {
      ccMicHeard = false;
      ccRec.start();
      ccMicSet(btn, true);
    } catch {
      ccMicMode = false;
      ccMicSet(btn, false);
      if (typeof addMsg === 'function') addMsg('sys', '[ mic: tap $ to keep talking ]');
    }
  };

  try {
    ccRec.start();
    ccMicSet(btn, true);
    clearTimeout(ccMicTimer);
    ccMicTimer = setTimeout(() => { try { ccRec.stop(); } catch { /* gone */ } }, CC_MIC_MAX_MS);
  } catch {
    ccMicSet(btn, false);   // start() throws if one is already running
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
  if (document.hidden && ccMicOn && ccRec) { try { ccRec.abort(); } catch { /* gone */ } }
});

ccMicInit();
