// Exec's voice — the binding, not the engine.
//
// Speaks everything Exec says in the panel (assistant replies, monitor
// comments, timed nudges) and everything /cc answers, in the GLaDOS voice. The
// player, the on/off, the unlock dance and the queue are voice-narrator.js;
// the button and the replay glyph are voice-ui.js. What is left here is the
// configuration and the two surface helpers that call into them.
//
// GLADOS COMES FROM THIS BOX. `piper` routes to the always-on container on the
// droplet (tts_routing.pick_upstream), not to the home GPU over the tunnel — so
// Exec and /cc keep their voice with the home machine asleep. Only /tarot's
// reader (nicole/kokoro) is the home box's, and only /tarot can lose it.
//
// Wai's own messages and bracketed sys notes are never spoken: the caller hands
// over Exec's turns only, and stripBrackets removes any [...] that rides along.
//
// Every name here lives INSIDE the closure. Two pages load this file from two
// places (a template and the nav injection), and a top-level `const` would make
// the second evaluation throw "duplicate variable" and take the page's scripts
// down with it.
window.execVoice = (function () {
  "use strict";

  const EXEC_VOICE_ID = "glados";      // upstream piper voice, droplet-local
  const EXEC_VOICE_BACKEND = "piper";
  // glados is peak-normalized to ~1.0 by the upstream (measured worst-case peak
  // ~1.013), so 0.95 is about as loud as it goes without clipping — a
  // deliberate step up from tts.js's 0.25 RMS-match trim: Exec should be heard.
  const EXEC_VOICE_GAIN = 0.95;
  // glados's default piper pace reads slow for a nudge bark; 1.2x keeps the
  // deadpan but stops Exec droning (piper maps speed -> 1/length_scale).
  const EXEC_VOICE_SPEED = 1.2;
  const EXEC_LS_VOICE = "exec.voice";

  const n = VoiceNarrator.create({
    voice: EXEC_VOICE_ID,
    backend: EXEC_VOICE_BACKEND,
    speed: EXEC_VOICE_SPEED,
    gain: EXEC_VOICE_GAIN,
    lsKey: EXEC_LS_VOICE,
    // A monitor comment or a replay tap arriving mid-reply must not cut the
    // reply off: player.speak() flushes, so extra utterances wait their turn.
    queue: true,
    stripBrackets: true,
    // The mics dim their dot while Exec talks and light it again on this.
    idleEvent: "exec:voice-idle",
  });

  // Build the on/off toggle for a surface to place: the panel drops it in its
  // composer row, /cc in its input line. Same element, same state contract.
  function button(opts) {
    return VoiceUI.muteButton(n, Object.assign({
      offTitle: "Turn Exec's voice off",
      onTitle: "Turn Exec's voice on",
    }, opts || {}));
  }

  // The clickable leading glyph for an Exec turn — tap to hear it again.
  function mark(role, text) {
    return VoiceUI.replayMark(n, role, text);
  }

  return {
    speak: n.speak,
    ready: n.ready,
    unlock: n.unlock,
    armUnlock: n.armUnlock,
    isOn: n.isOn,
    setOn: n.setOn,
    isSpeaking: n.isSpeaking,
    button,
    mark,
  };
})();
