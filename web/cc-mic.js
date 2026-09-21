/* Hands-free input for /cc: the `$` prompt IS the mic.
 *
 * The session engine -- continuous recognition, the restart path, the iOS
 * gesture rule, every comment explaining why -- is web/voice-input.js, shared
 * with the Exec panel (exec-mic.js). This file is only the binding to /cc's
 * composer.
 *
 * Loaded before cc.js, same global scope, so it calls sendMsg(), syncInputH()
 * and renderCaret() by bare name like its own functions.
 */
'use strict';

let ccMic = null;

/** Is this a moment whose sound must NOT become Wai's next message?
 *
 * TWO of them, and the second is why this page could not have a voice before:
 * a reply still streaming, and GLaDOS reading one out of the speaker. Without
 * the second, /cc transcribes its own narration and sends it straight back --
 * a conversation with itself. The panel has had this guard since it got the
 * voice (exec-mic.js); the two now share both the engine and the rule.
 *
 * cc.js's `streaming` is a top-level `let`, so it is a global lexical binding
 * rather than a window property -- readable by bare name from here, but only
 * after cc.js has evaluated. Every call site runs during a session, long after
 * that, and the try/catch covers the impossible case rather than assuming it. */
function ccMicBusy() {
  try {
    if (typeof streaming !== 'undefined' && streaming) return true;
  } catch { /* cc.js not evaluated yet */ }
  return !!(window.execVoice && execVoice.isSpeaking());
}

/** Is a voice session live (listening, or waiting to listen again)? */
function ccMicActive() {
  return !!ccMic && ccMic.active();
}

function ccMicInit() {
  const btn = document.getElementById('input-prompt');
  if (!btn) return;
  if (!VoiceInput.supported()) return;    // no API: the prompt stays a plain `$`
  ccMic = VoiceInput.create({
    btn: btn,
    busy: ccMicBusy,
    send: function () { if (typeof sendMsg === 'function') sendMsg(); },
    fill: function (text) {
      const input = document.getElementById('msg-input');
      if (!input) return;
      input.textContent = text;
      if (typeof syncInputH === 'function') syncInputH();
      if (typeof renderCaret === 'function') renderCaret();
    },
    blur: function () {
      const input = document.getElementById('msg-input');
      if (input && document.activeElement === input) input.blur();
    },
  });

  const term = document.getElementById('terminal');
  if (term) term.addEventListener('cc:reply-done', function () { ccMic.replyDone(); });
  // The voice stopped -- the dot goes from dim (dropping what it hears) back
  // to lit. Same event the panel's mic listens for.
  document.addEventListener('exec:voice-idle', function () { ccMic.paint(); });
}

ccMicInit();
