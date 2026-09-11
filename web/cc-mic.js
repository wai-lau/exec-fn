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

function ccMicStart(btn) {
  const Rec = ccMicSupported();
  if (!Rec) return;
  ccMicSent = false;
  ccRec = new Rec();
  ccRec.lang = navigator.language || 'en-US';
  // Interim results are what make it feel like dictation rather than a form:
  // the words appear while you are still saying them.
  ccRec.interimResults = true;
  ccRec.continuous = false;
  ccRec.maxAlternatives = 1;

  ccRec.onresult = (e) => {
    let text = '';
    let done = false;
    for (const res of e.results) {
      text += res[0].transcript;
      if (res.isFinal) done = true;
    }
    ccMicFill(text.trim());
    // Recognition stops itself on silence; onend does the sending so a final
    // result and a natural stop cannot both fire it.
    if (done) ccRec.stop();
  };

  // A refused or failed recognition must not leave the button lit and the page
  // looking like it is still listening.
  ccRec.onerror = () => { ccMicSent = true; ccMicSet(btn, false); };

  ccRec.onend = () => {
    ccMicSet(btn, false);
    const input = document.getElementById('msg-input');
    const said = input ? input.innerText.trim() : '';
    if (ccMicSent || !said) return;
    ccMicSent = true;
    if (typeof sendMsg === 'function') sendMsg();
  };

  try {
    ccRec.start();
    ccMicSet(btn, true);
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
    if (ccMicOn && ccRec) { ccRec.stop(); return; }
    ccMicStart(btn);
  });
}

ccMicInit();
