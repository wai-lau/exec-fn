/* Hands-free input for /tarot: the `$` prompt IS the mic.
 *
 * The session engine -- continuous recognition, the restart path, the iOS
 * gesture rule, every comment explaining why -- is web/voice-input.js, shared
 * with /cc (cc-mic.js) and the Exec panel (exec-mic.js). This file is only the
 * binding to the reading table's composer.
 *
 * WHY THE READER GETS ONE. A reading is the longest-form conversation on the
 * site and the one most likely to be had lying down in the dark: the querent
 * answers five Phase 1 questions, then a query dialogue, then turns three
 * cards. Typing each of those on a phone is the part of the ritual nobody
 * wants. Talking to a reader who talks back is the whole point.
 *
 * WHICH IS ALSO THE TRAP. The reader speaks (nicole, from the home box), and
 * an open microphone hears it: without the isSpeaking() guard the page
 * transcribes the reading and sends it back as the querent's answer, and the
 * reader interviews itself. The same guard the Exec panel has had since it
 * started speaking -- and the reason narration had to report when it stops
 * (voice-narrator.js fires `tarot:voice-idle`).
 *
 * Loaded before tarot-chat.js, same global scope, so it calls sendMsg(),
 * renderCaret() and the rest by bare name.
 */
'use strict';

let tarotMic = null;

/** Is this a moment whose sound must NOT become the querent's next message?
 *
 * Three: a reader turn still streaming, the reader's voice playing out of the
 * speaker, and a card blown up over the table (a tap there is a card being
 * looked at, not an answer being given). */
function tarotMicBusy() {
  try {
    if (typeof streaming !== 'undefined' && streaming) return true;
  } catch { /* tarot-view.js not evaluated yet */ }
  if (typeof tarotVoice !== 'undefined' && tarotVoice.isSpeaking()) return true;
  const zoom = document.getElementById('card-zoom');
  return !!(zoom && zoom.classList.contains('open'));
}

/** Is a voice session live (listening, or waiting to listen again)? */
function tarotMicActive() {
  return !!tarotMic && tarotMic.active();
}

function tarotMicInit() {
  const btn = document.getElementById('input-prompt');
  if (!btn) return;
  if (!VoiceInput.supported()) return;    // no API: the prompt stays a plain `$`
  tarotMic = VoiceInput.create({
    btn: btn,
    busy: tarotMicBusy,
    send: function () { if (typeof sendMsg === 'function') sendMsg(); },
    fill: function (text) {
      const input = document.getElementById('msg-input');
      if (!input) return;
      input.textContent = text;
      if (typeof renderCaret === 'function') renderCaret();
    },
    blur: function () {
      const input = document.getElementById('msg-input');
      if (input && document.activeElement === input) input.blur();
    },
  });

  // A reader turn ended -- repaint, and re-arm on a browser that ends
  // recognition per utterance.
  const term = document.getElementById('terminal');
  if (term) term.addEventListener('tarot:reply-done', function () { tarotMic.replyDone(); });
  // The reader stopped talking: the dot goes from dim (dropping what it hears)
  // back to lit.
  document.addEventListener('tarot:voice-idle', function () { tarotMic.paint(); });
}

tarotMicInit();
