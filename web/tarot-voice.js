// The reader's voice — the binding, not the engine.
//
// /tarot narrates in `nicole` on `kokoro`, which is the ONE voice in the app
// that comes from the home GPU box over the SSH tunnel (Exec and /cc speak
// glados from a container on this droplet). So this file owns the two things
// that follow from that: the home-box probe, and the canned opening that speaks
// from a file when the box is asleep.
//
// Everything else — the player, the on/off, the iOS unlock, the controller the
// typewriter paces off — is voice-narrator.js, and the toggle is voice-ui.js.
//
// tarot-chat.js calls in during a reader turn to decide whether to narrate and
// to get that controller; the upstream emits no word timings (see
// hosaka-audio.js), so the reveal syncs to measured audio duration.
const TAROT_VOICE = "nicole";   // reader voice (kokoro, home box)
const TAROT_BACKEND = "kokoro";
const LS_VOICE = "tarot.voice";

const tarotVoice = (() => {
  "use strict";

  const n = VoiceNarrator.create({
    voice: TAROT_VOICE,
    backend: TAROT_BACKEND,
    speed: 1.0,
    lsKey: LS_VOICE,
    // No queue: a new reader turn REPLACES the last one. The reader speaks once
    // per turn, and a re-read should interrupt rather than stack up behind it.
    queue: false,
    // The mic (tarot-mic.js) drops what it hears while the reader talks and
    // lights its dot again on this.
    idleEvent: "tarot:voice-idle",
  });

  // Is the home GPU box — which renders the reader's voice — actually
  // answering? The droplet's own piper is always up but only speaks glados,
  // which is Exec's voice, not the reader's: when the box is down the reading
  // is silent, and the page should say so rather than let the querent wonder.
  // `/api/hosaka/health` is the same probe /hosaka polls for its "Wai's GPU
  // offline" line, and works for guests.
  let homeUp = null;  // null until probed — never assume down before asking

  async function probeHome() {
    try {
      const r = await fetch("/api/hosaka/health");
      homeUp = !!(await r.json()).home;
    } catch {
      homeUp = false;
    }
    return homeUp;
  }

  // Answers only once the probe has come back: an unprobed voice is not a voice
  // known to be down, and a note that guesses is worse than no note. Also false
  // when the narrator is off — a voice nobody asked for cannot be missing.
  function homeDown() {
    return homeUp === false && n.isOn();
  }

  // Persisted-on across a reload: the toggle reads on but no gesture has
  // unlocked the player, so the reader stays silent until the first interaction.
  function armPersistedUnlock() {
    n.armUnlock();
  }

  // True when the opening reader turn should be prepared on load but its
  // reveal+voice held until the first gesture: the narrator is ON and no
  // gesture has unlocked audio yet (browsers will not play audio pre-gesture).
  // Narrator off, or already unlocked → reveal immediately. With the voice off
  // there is nothing to wait for, and holding the opening behind a tap that
  // buys nothing is just a page that will not start.
  function wantsDeferredOpening() {
    return n.isOn() && !n.gestureUnlocked();
  }

  // Arm a one-shot first gesture that unlocks audio and then runs `onGesture`.
  // The opening turn's reveal+voice are gated on it (the text is already here),
  // so the tap starts the reading with no wait behind it.
  function armOpeningUnlock(onGesture) {
    n.armUnlock(onGesture);
  }

  // The reader's toggle, in the spread controls. Same element and the same
  // `data-on` contract as the Exec panel's and /cc's (voice-ui.js);
  // `.spread-btn` is tarot.css layering its own body and pulse over it.
  function mount() {
    const controls = document.getElementById("spread-controls");
    if (!controls) return;
    const btn = VoiceUI.muteButton(n, {
      id: "voice-btn",
      className: "spread-btn",
      offTitle: "Turn the reader's voice off",
      onTitle: "Turn the reader's voice on",
    });
    controls.insertBefore(btn, controls.firstChild);
  }

  return {
    speak: n.speak,
    speakClip: n.speakClip,
    ready: n.ready,
    isSpeaking: n.isSpeaking,
    isOn: n.isOn,
    setOn: n.setOn,
    probeHome,
    homeDown,
    mount,
    armPersistedUnlock,
    wantsDeferredOpening,
    armOpeningUnlock,
  };
})();

tarotVoice.mount();

// Hold a presence socket so a reader at the table counts as a person on the
// hosaka voice backend (the reader narrates through the same /ws/hosaka).
// /tarot renders no count of its own -- it only contributes to /hosaka's.
if (typeof HosakaPresence !== "undefined") HosakaPresence.mount();
