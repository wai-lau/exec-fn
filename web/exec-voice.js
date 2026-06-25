// Exec chat narration. Speaks everything Exec says in the bubble — assistant
// replies, monitor comments, and timed nudges — in the GLaDOS voice, over the
// shared HosakaAudio core (same /ws/hosaka stream as /hosaka + /tarot). Wai's
// own messages and bracketed sys notes are never spoken (the caller only hands
// us Exec's turns, and we strip any [...] just in case).
//
// Modeled on tarot-voice.js but simpler: there is no typewriter to pace, so
// speak() just fires and forgets. Exposes window.execVoice for exec-bubble.js.
const EXEC_VOICE_ID = "glados"; // upstream piper voice
const EXEC_VOICE_BACKEND = "piper";
const EXEC_VOICE_GAIN = 0.25; // glados clips at 1.0 — matches tts.js VOICE_GAIN
const EXEC_LS_VOICE = "exec.voice";

window.execVoice = (function () {
  "use strict";
  let player = null;
  // Audible by default; "0" in localStorage mutes. The mute only zeroes the
  // player volume — Exec's turns still reach here either way.
  let on = localStorage.getItem(EXEC_LS_VOICE) !== "0";

  function ensurePlayer() {
    if (!player) player = HosakaAudio.createPlayer({ volume: on ? EXEC_VOICE_GAIN : 0 });
    return player;
  }

  // A user gesture has unlocked audio. Gate on gestureUnlocked() (sticky), NOT
  // isUnlocked() (live ctx.state) — the live state false-negatives on Windows
  // Chrome right after a gesture; speak() resumes a suspended context anyway.
  function ready() {
    return !!player && player.gestureUnlocked();
  }

  // Unlock inside a real gesture (panel open / send / first interaction). iOS
  // only unlocks audio when a buffer source starts within the gesture.
  function unlock() {
    ensurePlayer().unlock();
  }

  function isOn() {
    return on;
  }

  // Mute toggle: true = audible (volume = glados gain), false = silent.
  function setOn(v) {
    on = v;
    localStorage.setItem(EXEC_LS_VOICE, v ? "1" : "0");
    if (v) ensurePlayer().unlock(); // unmute is a gesture -> iOS unlock
    if (player) player.setVolume(v ? EXEC_VOICE_GAIN : 0);
  }

  // Persisted-on across a reload leaves `on` true but no gesture has unlocked
  // the player, so nothing speaks until the first interaction. Arm a one-shot
  // unlock on the first tap/keypress anywhere (synchronous, in-gesture — iOS
  // rule), so the next nudge/reply narrates without a manual toggle.
  function armUnlock() {
    function fire() {
      document.removeEventListener("pointerdown", fire, true);
      document.removeEventListener("keydown", fire, true);
      ensurePlayer().unlock();
    }
    document.addEventListener("pointerdown", fire, true);
    document.addEventListener("keydown", fire, true);
  }

  // Speak one of Exec's turns. No-op when muted, not-yet-unlocked, or empty
  // after stripping markdown + any [bracketed] spans. Fire-and-forget.
  function speak(md) {
    if (!on || !ready()) return;
    const text = VoiceUtil.stripMarkdown(md).replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;
    player.setVolume(EXEC_VOICE_GAIN);
    player
      .speak({
        input: text,
        backend: EXEC_VOICE_BACKEND,
        voice: EXEC_VOICE_ID,
        params: {},
      })
      .catch(() => {
        /* connection failed — stay silent, the text is already on screen */
      });
  }

  // Wire the panel's mute button (#exec-mute, built by exec-bubble.js) to the
  // toggle + reflect state on it, and arm a one-shot unlock so a persisted-on
  // voice narrates after the first interaction without a manual toggle.
  function mountButton() {
    var b = document.getElementById("exec-mute");
    if (!b) return;
    function sync() {
      b.dataset.muted = on ? "false" : "true";
      b.title = on ? "Mute Exec voice" : "Unmute Exec voice";
      b.setAttribute("aria-pressed", String(on));
    }
    b.addEventListener("click", function () {
      setOn(!on);
      sync();
    });
    sync();
    armUnlock();
  }

  return { speak, setOn, isOn, ready, unlock, armUnlock, mountButton };
})();
