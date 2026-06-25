// /tarot reader narration. Owns the voice toggle + a HosakaAudio player.
// tarot-chat.js calls in during a reader turn to decide whether to narrate,
// start TTS for the full reader text, and read the audio clock so the
// typewriter paces to the actual voice (the upstream emits no word timings --
// see hosaka-audio.js -- so we sync the typing to measured audio duration).
const TAROT_VOICE = "af_nicole"; // reader voice (kokoro, realtime)
const LS_VOICE = "tarot.voice";

const tarotVoice = (() => {
  let player = null;
  // The #voice-btn is a MUTE: narration is audible by default; the button only
  // sets the player volume to 0 (and back). `on` = unmuted. localStorage "0" =
  // muted, anything else audible.
  let on = localStorage.getItem(LS_VOICE) !== "0";
  let btn = null;

  function ensurePlayer() {
    if (!player) player = HosakaAudio.createPlayer();
    return player;
  }

  // Strip markdown so the voice reads prose, not asterisks. Runs on the reader's
  // already-cleaned text (event markers never reach here).
  function plain(md) {
    return md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  // A user gesture has unlocked the player. Narration plays whenever unlocked;
  // the mute button only zeroes the volume (setOn), it does NOT gate narration.
  // Gate on gestureUnlocked() (sticky "a gesture ran"), NOT isUnlocked() (live
  // ctx.state): on Windows Chrome the live state can read non-running at this
  // check even though playback works, which silently dropped the voice. speak()
  // resumes a suspended context, so the sticky signal is the right gate.
  function ready() {
    return !!player && player.gestureUnlocked();
  }

  // The mute toggle: v=true unmuted (volume 1), v=false muted (volume 0). It does
  // nothing but set the player volume -- narration still streams + paces either way.
  function setOn(v) {
    on = v;
    localStorage.setItem(LS_VOICE, v ? "1" : "0");
    if (btn) {
      btn.dataset.on = v ? "true" : "false";
      btn.setAttribute("aria-pressed", String(v));
    }
    if (v) ensurePlayer().unlock(); // unmute is a gesture -> iOS unlock
    if (player) player.setVolume(v ? 1.0 : 0);
  }

  // Persisted-on across a reload: the toggle reads on but no gesture has unlocked
  // the player, so ready() stays false and the reader is silent until the user
  // re-clicks. Arm a one-shot unlock on the first real gesture (tap or keypress)
  // -- it MUST run synchronously inside that gesture (iOS audio rule), so no
  // load-time/setTimeout unlock here.
  function armPersistedUnlock() {
    function fire() {
      document.removeEventListener("pointerdown", fire, true);
      document.removeEventListener("keydown", fire, true);
      ensurePlayer().unlock(); // synchronous, inside the gesture
    }
    document.addEventListener("pointerdown", fire, true);
    document.addEventListener("keydown", fire, true);
  }

  // True when the opening reader turn should be pre-generated on load but its
  // reveal+voice held until the first gesture: voice is on but no gesture has
  // unlocked audio yet (browsers won't play audio pre-gesture). Voice off /
  // already unlocked -> reveal immediately, no hold.
  function wantsDeferredOpening() {
    ensurePlayer();
    return !player.gestureUnlocked();
  }

  // Arm a one-shot first gesture (tap/keypress) that unlocks audio and calls
  // `onGesture` IN the gesture. The opening turn's reveal+voice are gated on this
  // (generation already ran in the background) so the click starts the reading
  // with no LLM wait. MUST unlock synchronously inside the gesture (iOS rule).
  function armOpeningUnlock(onGesture) {
    function go() {
      document.removeEventListener("pointerdown", go, true);
      document.removeEventListener("keydown", go, true);
      ensurePlayer().unlock(); // synchronous, inside the gesture
      if (onGesture) onGesture();
    }
    document.addEventListener("pointerdown", go, true);
    document.addEventListener("keydown", go, true);
  }

  // Begin narrating `md`. Returns a controller the typewriter polls:
  //   elapsed()  seconds of voice played
  //   duration() seconds buffered so far (final once ended)
  //   ended      true once upstream sent {end} (or errored)
  //   ok         false if audio never started -> caller types at guessed pace
  function speak(md) {
    const ctl = {
      ended: false,
      ok: true,
      error: null,
      elapsed: () => (player ? player.elapsed() : 0),
      duration: () => (player ? player.audioDuration() : 0),
    };
    const text = plain(md);
    if (!text || !ready()) {
      ctl.ok = false;
      ctl.ended = true;
      return ctl;
    }
    player.setVolume(on ? 1.0 : 0);
    player
      .speak({
        input: text,
        backend: "kokoro",
        voice: TAROT_VOICE,
        params: { speed: 1.0 },
        onStatus: (msg) => {
          if (msg.type === "end") ctl.ended = true;
          else if (msg.type === "error") {
            ctl.ok = false;
            ctl.ended = true;
            ctl.error = msg.detail || "tts error";
          }
        },
      })
      .catch(() => {
        ctl.ok = false;
        ctl.ended = true;
        ctl.error = "connection failed";
      });
    return ctl;
  }

  function mount() {
    const controls = document.getElementById("spread-controls");
    if (!controls) return;
    btn = document.createElement("button");
    btn.className = "spread-btn voice-btn";
    btn.id = "voice-btn";
    btn.title = "Mute reader voice";
    btn.setAttribute("aria-label", "Mute reader voice");
    btn.setAttribute("aria-pressed", String(on));
    btn.dataset.on = on ? "true" : "false";
    btn.innerHTML = '[<span class="voice-glyph">&#10022;</span>]';
    btn.addEventListener("click", () => setOn(!on));
    controls.insertBefore(btn, controls.firstChild);
  }

  return { ready, speak, mount, armPersistedUnlock, wantsDeferredOpening, armOpeningUnlock };
})();

tarotVoice.mount();
