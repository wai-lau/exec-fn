// /tarot reader narration. Owns the voice toggle + a HosakaAudio player.
// tarot-chat.js calls in during a reader turn to decide whether to narrate,
// start TTS for the full reader text, and read the audio clock so the
// typewriter paces to the actual voice (the upstream emits no word timings --
// see hosaka-audio.js -- so we sync the typing to measured audio duration).
const TAROT_VOICE = "af_nicole"; // reader voice (kokoro, realtime)
const LS_VOICE = "tarot.voice";

const tarotVoice = (() => {
  let player = null;
  let on = localStorage.getItem(LS_VOICE) === "1";
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

  // on AND a user gesture has unlocked the player. When off / not yet
  // unlocked, tarot-chat falls back to the guessed-pace typewriter.
  // Gate on gestureUnlocked() (sticky "a gesture ran"), NOT isUnlocked() (live
  // ctx.state): on Windows Chrome the live state can read non-running at this
  // check even though playback works, which silently dropped the voice. speak()
  // resumes a suspended context, so the sticky signal is the right gate.
  function ready() {
    return on && !!player && player.gestureUnlocked();
  }

  function setOn(v) {
    on = v;
    localStorage.setItem(LS_VOICE, v ? "1" : "0");
    if (btn) {
      btn.dataset.on = v ? "true" : "false";
      btn.setAttribute("aria-pressed", String(v));
    }
    if (v) ensurePlayer().unlock(); // in-gesture (toggle click) -> iOS unlock
  }

  // Persisted-on across a reload: the toggle reads on but no gesture has unlocked
  // the player, so ready() stays false and the reader is silent until the user
  // re-clicks. Arm a one-shot unlock on the first real gesture (tap or keypress)
  // -- it MUST run synchronously inside that gesture (iOS audio rule), so no
  // load-time/setTimeout unlock here.
  function armPersistedUnlock() {
    if (!on) return;
    function fire() {
      document.removeEventListener("pointerdown", fire, true);
      document.removeEventListener("keydown", fire, true);
      if (on) ensurePlayer().unlock(); // still synchronous, inside the gesture
    }
    document.addEventListener("pointerdown", fire, true);
    document.addEventListener("keydown", fire, true);
  }

  // Fire the opening reader turn so it gets NARRATED, not typed silently.
  // Browsers won't play audio before a user gesture, and the opening turn
  // auto-fires with none -- so when voice is on but not yet unlocked, hold the
  // turn until the user's first gesture (tap/keypress), which both unlocks audio
  // and fires it. Voice off / already unlocked -> fire immediately (today's
  // behaviour). `onHold` (called when we defer) may return a cleanup run on fire,
  // e.g. to show/clear a "tap to begin" hint.
  function armOpening(fire, onHold) {
    if (!on) return fire();
    ensurePlayer();
    if (player.gestureUnlocked()) return fire();
    const cleanup = onHold ? onHold() : null;
    function go() {
      document.removeEventListener("pointerdown", go, true);
      document.removeEventListener("keydown", go, true);
      if (typeof cleanup === "function") cleanup();
      ensurePlayer().unlock(); // synchronous, inside the gesture
      fire();
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
      elapsed: () => (player ? player.elapsed() : 0),
      duration: () => (player ? player.audioDuration() : 0),
    };
    const text = on ? plain(md) : "";
    if (!text || !ready()) {
      ctl.ok = false;
      ctl.ended = true;
      return ctl;
    }
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
          }
        },
      })
      .catch(() => {
        ctl.ok = false;
        ctl.ended = true;
      });
    return ctl;
  }

  function mount() {
    const controls = document.getElementById("spread-controls");
    if (!controls) return;
    btn = document.createElement("button");
    btn.className = "spread-btn voice-btn";
    btn.id = "voice-btn";
    btn.title = "Reader voice";
    btn.setAttribute("aria-label", "Toggle reader voice");
    btn.setAttribute("aria-pressed", String(on));
    btn.dataset.on = on ? "true" : "false";
    btn.innerHTML = '[<span class="voice-glyph">&#9834;</span>]';
    btn.addEventListener("click", () => setOn(!on));
    controls.insertBefore(btn, controls.firstChild);
  }

  return { ready, speak, mount, armPersistedUnlock, armOpening };
})();

tarotVoice.mount();
