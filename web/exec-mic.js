/* Hands-free input for the Exec panel: the `$` prompt IS the mic, exactly as on
 * /cc. The session engine is web/voice-input.js; this file is the binding to
 * the panel's composer.
 *
 * Why the panel gets it too: the panel is where a nudge is answered, and a
 * nudge arrives at the moment Wai is least likely to be holding the phone in
 * two hands -- mid-cook, mid-pack, on the way out. Tapping `$` once and talking
 * is the whole point.
 *
 * TWO things must never become her next message, and both are folded into
 * busy(): a reply still streaming (same as /cc), and Exec's own GLaDOS voice
 * playing out of the speaker (exec-voice.js). The second is new here -- /cc has
 * no TTS -- and without it the panel transcribes Exec narrating its own reply
 * and sends it straight back, which is a conversation with itself.
 *
 * exec-bubble.js builds the panel asynchronously (after its stylesheets apply)
 * and calls execMicInit(host) once the composer exists; the host is the only
 * way into that file's closure.
 */
'use strict';

let execMic = null;

function execMicInit(host) {
  if (!host || !host.prompt) return;
  // The panel builds its composer inside exec-bubble.js's closure, so it hands
  // over accessors where /cc and /tarot hand over element ids. Everything else
  // -- the drop rules, the idle repaint -- is the shared binding.
  execMic = VoiceInput.bindComposer({
    btn: host.prompt,
    busy: [host.busy],
    send: host.send,
    fill: host.fill,
    blur: host.blur,
    idleEvent: 'exec:voice-idle',
  });
}

/** Called by exec-bubble.js when a reply has finished streaming. Repaints the
 *  dot, and re-arms on a browser that ends recognition per utterance. */
function execMicReplyDone() {
  if (execMic) execMic.replyDone();
}

/** Called by exec-bubble.js when the panel closes. */
function execMicStop() {
  if (execMic) execMic.stop();
}
