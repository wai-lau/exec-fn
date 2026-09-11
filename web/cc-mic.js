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
// watchdog is a second line of defence rather than a nicety.
const CC_MIC_MAX_MS = 20000;

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
  ccRec = new Rec();
  ccRec.lang = navigator.language || 'en-US';
  // Interim results are what make it feel like dictation rather than a form:
  // the words appear while you are still saying them.
  ccRec.interimResults = true;
  ccRec.continuous = false;
  ccRec.maxAlternatives = 1;

  ccRec.onresult = (e) => {
    try {
      let text = '';
      let done = false;
      // INDEX LOOP, not for...of. SpeechRecognitionResultList is array-LIKE in
      // Safari with no Symbol.iterator, so for...of threw TypeError here --
      // which killed the handler before it could fill the composer or call
      // stop(), leaving the recognizer running with its audio session hot. That
      // is what "it never sends" and "the whole page freezes" both were.
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (alt && alt.transcript) text += alt.transcript;
        if (res.isFinal) done = true;
      }
      ccMicFill(text.trim());
      // Recognition stops itself on silence; onend does the sending so a final
      // result and a natural stop cannot both fire it.
      if (done) ccRec.stop();
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

  ccRec.onend = () => {
    clearTimeout(ccMicTimer);
    ccMicSet(btn, false);
    const input = document.getElementById('msg-input');
    const said = input ? input.innerText.trim() : '';
    if (ccMicSent || !said) {
      // Heard nothing. That is how a voice session ends: stop talking and it
      // stops listening, rather than holding the microphone open indefinitely.
      ccMicMode = false;
      return;
    }
    ccMicSent = true;
    if (typeof sendMsg === 'function') sendMsg();
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
  });

  // Claude has finished answering: listen again, so a conversation is talk,
  // listen, talk -- with no tap in between.
  const term = document.getElementById('terminal');
  if (term) {
    term.addEventListener('cc:reply-done', () => {
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
