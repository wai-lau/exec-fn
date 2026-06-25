// /tarot reader narration. Owns the voice toggle + a HosakaAudio player.
// tarot-chat.js calls in during a reader turn to decide whether to narrate,
// start TTS for the full reader text, and read the audio clock so the
// typewriter paces to the actual voice (the upstream emits no word timings --
// see hosaka-audio.js -- so we sync the typing to measured audio duration).
const TAROT_VOICE = "af_nicole"; // default reader voice (kokoro, realtime)
const LS_VOICE = "tarot.voice";

const tarotVoice = (() => {
  let player = null;
  // Narration is ON by default; the #voice-btn is a MUTE (volume -> 0), not an
  // on/off gate. `on` = audible. localStorage "0" = muted, anything else audible.
  let on = localStorage.getItem(LS_VOICE) !== "0";
  let btn = null;
  // Active TTS voice -- the default reader unless a persona overrides it via
  // setVoice(). gain is the per-voice loudness trim (HosakaAudio default is hot
  // for clone voices like glados); see VOICE_GAIN in tts.js for the rationale.
  let voiceId = TAROT_VOICE;
  let backend = "kokoro";
  let gain = 0.98;

  // Push the live volume to the player: the persona's gain when audible, 0 when
  // muted. Narration still STREAMS while muted (the button only zeroes volume),
  // so the typewriter stays audio-paced either way.
  function applyVolume() {
    if (player) player.setVolume(on ? gain : 0);
  }

  // Point narration at a persona's voice (tarot-persona.js calls this on load
  // and on every persona change). Applies the loudness trim immediately if a
  // player already exists.
  function setVoice(p) {
    voiceId = p.voice_id || TAROT_VOICE;
    backend = p.backend || "kokoro";
    gain = typeof p.gain === "number" ? p.gain : 1.0;
    applyVolume();
  }

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
  // muting only zeroes the volume (applyVolume), it does NOT stop narration.
  // Gate on gestureUnlocked() (sticky "a gesture ran"), NOT isUnlocked() (live
  // ctx.state): on Windows Chrome the live state can read non-running at this
  // check even though playback works, which silently dropped the voice. speak()
  // resumes a suspended context, so the sticky signal is the right gate.
  function ready() {
    return !!player && player.gestureUnlocked();
  }

  // In-gesture audio unlock (iOS rule). The reader-select pick is a real user
  // gesture, so calling this in the pick handler unlocks audio for the opening
  // narration with no separate "tap to begin".
  function unlock() {
    ensurePlayer().unlock();
  }

  // The #voice-btn is a mute toggle: v=true audible, v=false muted (volume 0).
  function setOn(v) {
    on = v;
    localStorage.setItem(LS_VOICE, v ? "1" : "0");
    if (btn) {
      btn.dataset.on = v ? "true" : "false";
      btn.setAttribute("aria-pressed", String(v));
    }
    if (v) ensurePlayer().unlock(); // unmute is a gesture -> iOS unlock
    applyVolume();                  // live: mutes/unmutes the current utterance too
  }

  // Returning mid-reading: no gesture has unlocked the player yet, so ready()
  // stays false and the reader is silent until the user interacts. Arm a one-shot
  // unlock on the first real gesture (tap or keypress) -- it MUST run
  // synchronously inside that gesture (iOS audio rule), so no load-time unlock.
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
  // reveal+voice held until the first gesture: no gesture has unlocked audio yet
  // (browsers won't play audio pre-gesture). Already unlocked -> no hold.
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
    applyVolume();
    player
      .speak({
        input: text,
        backend: backend,
        voice: voiceId,
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
    btn.innerHTML = '[<span class="voice-glyph">&#9834;</span>]';
    btn.addEventListener("click", () => setOn(!on));
    controls.insertBefore(btn, controls.firstChild);
  }

  return { ready, speak, mount, setVoice, unlock, armPersistedUnlock, wantsDeferredOpening, armOpeningUnlock };
})();

tarotVoice.mount();
