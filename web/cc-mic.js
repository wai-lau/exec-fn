/* Hands-free input for /cc: the `$` prompt IS the mic.
 *
 * The engine and the composer wiring are web/voice-input.js (bindComposer),
 * shared with the Exec panel and /tarot. What is left here is the /cc-specific
 * part: which moments must not become Wai's next message.
 *
 * Loaded before cc.js, same global scope, so it calls sendMsg(), syncInputH()
 * and renderCaret() by bare name.
 */
'use strict';

let ccMic = null;

/** Is a reply streaming right now?
 *
 * cc.js's `streaming` is a top-level `let`, so it is a global lexical binding
 * rather than a window property -- readable by bare name from here, but only
 * after cc.js has evaluated. Every call site runs during a session, long after
 * that, and the try/catch covers the impossible case rather than assuming it. */
function ccReplyStreaming() {
  try { return typeof streaming !== 'undefined' && streaming; } catch { return false; }
}

/** Is a voice session live (listening, or waiting to listen again)? */
function ccMicActive() {
  return !!ccMic && ccMic.active();
}

function ccMicInit() {
  ccMic = VoiceInput.bindComposer({
    btn: 'input-prompt',
    input: 'msg-input',
    // The second one is why this page could not have a voice before: without
    // it /cc transcribes GLaDOS reading its own reply and sends it straight
    // back, which is a conversation with itself.
    busy: [ccReplyStreaming, () => !!(window.execVoice && execVoice.isSpeaking())],
    send: () => { if (typeof sendMsg === 'function') sendMsg(); },
    afterFill: () => {
      if (typeof syncInputH === 'function') syncInputH();
      if (typeof renderCaret === 'function') renderCaret();
    },
    replyDoneOn: document.getElementById('terminal'),
    replyDoneEvent: 'cc:reply-done',
    idleEvent: 'exec:voice-idle',
  });
}

ccMicInit();
