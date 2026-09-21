/* Hands-free input for /tarot: the `$` prompt IS the mic.
 *
 * The engine and the composer wiring are web/voice-input.js (bindComposer),
 * shared with /cc and the Exec panel. What is left here is the reading table's
 * own answer to one question: which moments must not become the querent's
 * next message.
 *
 * WHY THE READER GETS ONE. A reading is the longest-form conversation on the
 * site and the one most likely to be had lying down in the dark: five Phase 1
 * answers, a query dialogue, then three cards turned. Typing that on a phone is
 * the part of the ritual nobody wants. Talking to a reader who talks back is
 * the whole point.
 *
 * Loaded before tarot-chat.js, same global scope, so it calls sendMsg() and
 * renderCaret() by bare name.
 */
'use strict';

let tarotMic = null;

function tarotReplyStreaming() {
  // tarot-view.js's `streaming` is a global lexical binding, not a window
  // property: readable by bare name, but only after that file has evaluated.
  try { return typeof streaming !== 'undefined' && streaming; } catch { return false; }
}

/** The reader SPEAKS, and an open microphone hears it. Without this the page
 *  transcribes the reading and sends it back as the querent's answer, and the
 *  reader interviews itself. */
function tarotReaderSpeaking() {
  return typeof tarotVoice !== 'undefined' && tarotVoice.isSpeaking();
}

/** A card blown up over the table: a tap there is someone LOOKING at a card,
 *  not answering a question. */
function tarotCardZoomed() {
  const zoom = document.getElementById('card-zoom');
  return !!(zoom && zoom.classList.contains('open'));
}

/** Is a voice session live (listening, or waiting to listen again)? */
function tarotMicActive() {
  return !!tarotMic && tarotMic.active();
}

function tarotMicInit() {
  tarotMic = VoiceInput.bindComposer({
    btn: 'input-prompt',
    input: 'msg-input',
    busy: [tarotReplyStreaming, tarotReaderSpeaking, tarotCardZoomed],
    send: () => { if (typeof sendMsg === 'function') sendMsg(); },
    afterFill: () => { if (typeof renderCaret === 'function') renderCaret(); },
    replyDoneOn: document.getElementById('terminal'),
    replyDoneEvent: 'tarot:reply-done',
    idleEvent: 'tarot:voice-idle',
  });
}

tarotMicInit();
