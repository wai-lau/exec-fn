// The narrator every speaking surface shares.
//
// Three pages put a voice on a stream of text — /tarot's reader, the Exec panel
// and /cc — and they were two hand-written modules with a third about to be
// copied from one of them. Everything below is what they agreed on anyway: one
// HosakaAudio player, an on/off that persists per surface, the iOS unlock
// dance, and a speak() that hands back a controller a typewriter can pace to.
// What differs is configuration — which voice, how fast, how loud, which
// localStorage key — plus one behaviour flag (queue), so that is all a binding
// passes.
//
// WHICH VOICE COMES FROM WHERE MATTERS. Exec and /cc speak `glados` on the
// `piper` backend, which is a container on THIS droplet (tts_routing routes
// backend "piper" to the local upstream), so their voice works with the home
// GPU box asleep. Only /tarot's `nicole`/`kokoro` comes from the home box over
// the SSH tunnel — it is the one voice that can be "down".
//
// The bindings keep what is genuinely theirs: tarot-voice.js owns the canned
// opening and the home-box probe, exec-voice.js owns the replay glyph and the
// button both it and /cc mount. Neither owns a player any more.
//
// State lives in one mutable `S` threaded through the helpers below rather than
// a fat closure — the same shape hosaka-audio.js uses, and for the same reason:
// every function stays small enough to read.
//
// Depends on hosaka-audio.js (PCM + the socket) and voice-util.js (the markdown
// strip). Load both before this, and this before any binding.
(function () {
  "use strict";

  function ensurePlayer(S) {
    if (!S.player) S.player = HosakaAudio.createPlayer({ volume: S.on ? S.gain : 0 });
    return S.player;
  }

  // A user gesture has unlocked audio. Gate on gestureUnlocked() (sticky), NOT
  // isUnlocked() (live ctx.state): on Windows Chrome the live state can read
  // non-running right after a gesture even though playback works, which
  // silently dropped the voice. speak() resumes a suspended context anyway.
  function ready(S) {
    return !!S.player && S.player.gestureUnlocked();
  }

  // Persisted-on across a reload leaves `on` true with no gesture behind it, so
  // nothing speaks until the first interaction. Arm a one-shot unlock on the
  // first tap/keypress anywhere — synchronously, inside that gesture, which is
  // the iOS rule — so the next turn narrates without a manual toggle.
  function armUnlock(S, after) {
    function fire() {
      document.removeEventListener("pointerdown", fire, true);
      document.removeEventListener("keydown", fire, true);
      ensurePlayer(S).unlock();
      if (after) after();
    }
    document.addEventListener("pointerdown", fire, true);
    document.addEventListener("keydown", fire, true);
  }

  function setOn(S, v) {
    S.on = v;
    localStorage.setItem(S.lsKey, v ? "1" : "0");
    if (v) ensurePlayer(S).unlock();   // turning it on is a gesture -> iOS unlock
    if (S.player) S.player.setVolume(v ? S.gain : 0);
  }

  // The controller a caller polls: the typewriter paces its reveal off
  // elapsed()/duration() and waits on `ended`, and every surface reads `ok` to
  // decide whether the voice is worth waiting for at all.
  function newCtl(S) {
    return {
      ended: false,
      ok: true,
      error: null,
      elapsed: () => (S.player ? S.player.elapsed() : 0),
      duration: () => (S.player ? S.player.audioDuration() : 0),
    };
  }

  function spoken(S, md) {
    let text = VoiceUtil.stripMarkdown(md);
    // Exec writes sys notes as [bracketed] spans and answer rows as [a | b];
    // both are instructions to the page, not words to say.
    if (S.stripBrackets) text = text.replace(/\[[^\]]*\]/g, " ");
    return text.replace(/\s+/g, " ").trim();
  }

  // Advance the queue once the current utterance has finished PLAYING (not just
  // finished streaming) — wait out whatever is still buffered ahead.
  function finishThenNext(S) {
    const remainMs = Math.max(0, (S.player.audioDuration() - S.player.elapsed()) * 1000);
    setTimeout(() => {
      S.speaking = false;
      // The mics dim their dot while the page talks; tell them the speaker is
      // clear, or the dot stays dim until the next thing it says.
      if (S.idleEvent) document.dispatchEvent(new Event(S.idleEvent));
      if (!S.on) { S.queued = []; return; }   // turned off mid-queue: drop the backlog
      const next = S.queued.shift();
      if (next) doSpeak(S, next.text, next.ctl);
    }, remainMs);
  }

  function settle(S, ctl, msg) {
    if (msg.type === "end") ctl.ended = true;
    else if (msg.type === "error") {
      ctl.ok = false;
      ctl.ended = true;
      ctl.error = msg.detail || "tts error";
    }
    if ((msg.type === "end" || msg.type === "error") && S.queue) finishThenNext(S);
  }

  function fail(S, ctl, reason) {
    ctl.ok = false;
    ctl.ended = true;
    ctl.error = reason;
    if (S.queue) finishThenNext(S);
  }

  function doSpeak(S, text, ctl) {
    S.speaking = true;
    S.player.setVolume(S.on ? S.gain : 0);
    S.player
      .speak({
        input: text,
        backend: S.backend,
        voice: S.voice,
        params: { speed: S.speed },
        onStatus: (msg) => settle(S, ctl, msg),
      })
      .catch(() => fail(S, ctl, "connection failed"));
    return ctl;
  }

  // A DEAD controller: ok:false and already ended. Every caller reads it as
  // "reveal at your own pace, now" — which is what makes the narrator's OFF
  // state also the fast-typing state, with no second flag to keep in sync.
  function deadCtl(S) {
    const ctl = newCtl(S);
    ctl.ok = false;
    ctl.ended = true;
    return ctl;
  }

  // Speak one turn. Off, never unlocked, or nothing left after the strip → dead
  // controller and not a byte synthesized.
  function speak(S, md) {
    const text = spoken(S, md);
    if (!S.on || !text || !ready(S)) return deadCtl(S);
    const ctl = newCtl(S);
    if (S.queue && S.speaking) { S.queued.push({ text, ctl }); return ctl; }
    return doSpeak(S, text, ctl);
  }

  // Play an ALREADY-RENDERED clip (the pre-generated /tarot opening) instead of
  // synthesizing one. Same controller, so the typewriter cannot tell which it
  // got; no socket opens, because there is nothing to synthesize.
  function speakClip(S, arrayBuffer) {
    if (!S.on || !arrayBuffer || !ready(S)) return deadCtl(S);
    const ctl = newCtl(S);
    S.speaking = true;
    S.player.setVolume(S.on ? S.gain : 0);
    S.player
      .speakBuffer({ data: arrayBuffer, onStatus: (msg) => settle(S, ctl, msg) })
      .catch(() => fail(S, ctl, "playback failed"));
    return ctl;
  }

  function create(cfg) {
    const S = {
      voice: cfg.voice,
      backend: cfg.backend,
      speed: cfg.speed == null ? 1.0 : cfg.speed,
      // Per-voice trim. glados is peak-normalized to ~1.0 upstream, so 0.95 is
      // about as loud as it goes without clipping; kokoro rides at 1.0.
      gain: cfg.gain == null ? 1.0 : cfg.gain,
      lsKey: cfg.lsKey,
      // Queueing is the Exec behaviour: player.speak() FLUSHES whatever is
      // still playing, so a monitor comment or a replay tap arriving mid-reply
      // would cut the reply off. The reader does not queue — a new turn
      // replaces the last, which is what a re-read should do.
      queue: !!cfg.queue,
      stripBrackets: !!cfg.stripBrackets,
      idleEvent: cfg.idleEvent || null,
      player: null,
      // ON by default; "0" in localStorage turns the narrator OFF — really off,
      // not merely silent. Nothing is synthesized, no socket opens, and the
      // controller comes back dead so the caller types at its own pace instead
      // of waiting on a clock that will never tick. /tarot's toggle used to be
      // a volume mute that kept narrating (and kept pacing the reveal to audio
      // nobody could hear); one rule for three surfaces is the simpler promise:
      // the voice is on, or the page is quiet and quick.
      on: localStorage.getItem(cfg.lsKey) !== "0",
      speaking: false,
      queued: [],
    };
    return {
      speak: (md) => speak(S, md),
      speakClip: (buf) => speakClip(S, buf),
      ready: () => ready(S),
      unlock: () => ensurePlayer(S).unlock(),
      armUnlock: (after) => armUnlock(S, after),
      isOn: () => S.on,
      setOn: (v) => setOn(S, v),
      // Is an utterance playing, or still draining? The mics (voice-input.js)
      // drop everything they hear while this is true — otherwise the page
      // transcribes its own narration and sends it back as the next message. It
      // stays true through the playout TAIL, not just the stream, because that
      // is exactly the window a microphone can hear.
      isSpeaking: () => S.speaking,
      // Has a gesture ever unlocked this player? /tarot asks before deciding
      // whether the opening turn has to be held for one.
      gestureUnlocked: () => ensurePlayer(S).gestureUnlocked(),
    };
  }

  window.VoiceNarrator = { create };
})();
