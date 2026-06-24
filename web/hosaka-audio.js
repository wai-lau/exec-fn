// Shared client for the home-GPU TTS upstream, proxied same-origin at
// /ws/hosaka. Owns the AudioContext, the iOS unlock dance, the WebSocket, and
// playback of the streamed float32 PCM (24 kHz mono) via scheduled
// AudioBufferSourceNodes. Used by both the /hosaka SPEAK page (tts.js) and the
// /tarot reader narration (tarot-voice.js).
//
// AudioBufferSourceNode scheduling (not an AudioWorklet): on iOS Safari a
// worklet context forced to a non-hardware sampleRate (24 kHz) renders silence
// even when it reports "running". An AudioBuffer carries any rate and gets
// resampled to the hardware rate on playback, so the context is left at its
// default rate and stays audible on iOS.
//
// Player state lives in one mutable `S` object threaded through the helpers
// below (instead of a fat closure) so each stays small; createPlayer() just
// wires S to the public methods.
(function () {
  const SR = 24000; // upstream PCM rate

  // iOS mutes the Web Audio API under the Ring/Silent switch. Looping a silent
  // HTMLMediaElement (in-gesture) moves the page's audio session to "playback",
  // which the switch does NOT mute -- so buffer output is then audible even in
  // silent mode. Kept looping so the session stays in that category.
  function enableSilentModePlayback(S) {
    if (!S.silentEl) {
      S.silentEl = document.createElement("audio");
      S.silentEl.src = "/silence.wav?v=1";
      S.silentEl.loop = true;
      S.silentEl.playsInline = true;
      S.silentEl.setAttribute("playsinline", "");
    }
    S.silentEl.play().catch(() => {
      /* no gesture / unsupported -- audio still works with the switch off */
    });
  }

  // Create + unlock the AudioContext. MUST run synchronously inside a click
  // gesture: iOS Safari only unlocks audio when a buffer source is started (not
  // resume() alone) within the gesture, so the first utterance stays silent
  // otherwise. No forced sampleRate (see file header).
  function unlock(S) {
    if (!S.ctx) {
      S.ctx = new AudioContext();
      S.gainNode = S.ctx.createGain();
      S.gainNode.gain.value = S.volume;
      S.gainNode.connect(S.ctx.destination);
    }
    if (S.ctx.state === "suspended") S.ctx.resume();
    enableSilentModePlayback(S); // play through the iOS Ring/Silent switch
    const b = S.ctx.createBuffer(1, 1, S.ctx.sampleRate);
    const s = S.ctx.createBufferSource();
    s.buffer = b;
    s.connect(S.ctx.destination);
    s.start(0);
    S.unlockedOnce = true; // a gesture ran this; the player may now speak
  }

  function flush(S) {
    for (const s of S.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    S.sources = [];
    S.playhead = 0;
    S.startTime = null;
    S.bufferedDur = 0;
  }

  // Schedule one PCM chunk (Float32Array @ 24 kHz) right after the previous one.
  function enqueuePCM(S, f32) {
    if (!f32.length) return;
    const buf = S.ctx.createBuffer(1, f32.length, SR);
    buf.getChannelData(0).set(f32);
    const src = S.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(S.gainNode);
    const at = Math.max(S.ctx.currentTime + 0.05, S.playhead);
    src.start(at);
    if (S.startTime === null) {
      S.startTime = at;
      if (S.cur && S.cur.onFirstAudio) S.cur.onFirstAudio(at);
    }
    S.playhead = at + buf.duration;
    S.bufferedDur += buf.duration;
    S.sources.push(src);
    src.onended = () => {
      S.sources = S.sources.filter((x) => x !== src);
    };
    if (S.cur && S.cur.onChunk) S.cur.onChunk(S.bufferedDur);
  }

  function openSocket(S) {
    return new Promise((resolve, reject) => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      S.ws = new WebSocket(`${scheme}://${location.host}/ws/hosaka`);
      S.ws.binaryType = "arraybuffer";
      S.ws.onopen = () => {
        if (S.opts.onConnState) S.opts.onConnState("connected");
        resolve();
      };
      S.ws.onerror = () => {
        if (S.opts.onConnState) S.opts.onConnState("error");
        reject(new Error("ws error"));
      };
      S.ws.onclose = () => {
        if (S.opts.onConnState) S.opts.onConnState("disconnected");
      };
      S.ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          let msg;
          try {
            msg = JSON.parse(e.data);
          } catch {
            return;
          }
          if (S.cur && S.cur.onStatus) S.cur.onStatus(msg);
          return;
        }
        enqueuePCM(S, new Float32Array(e.data));
      };
    });
  }

  // Speak one utterance. Opens the socket on first use, drops any previous tail,
  // then streams. Callbacks fire per-utterance:
  //   onStatus(msg)      -- {type:"start"|"end"|"error", detail?}
  //   onFirstAudio(at)   -- first PCM chunk scheduled (ctx clock)
  //   onChunk(seconds)   -- running buffered duration after each chunk
  async function speak(S, req) {
    unlock(S);
    if (S.ctx.state === "suspended") await S.ctx.resume();
    if (!S.ws || S.ws.readyState !== WebSocket.OPEN) await openSocket(S);
    flush(S);
    S.cur = { onStatus: req.onStatus, onFirstAudio: req.onFirstAudio, onChunk: req.onChunk };
    S.ws.send(
      JSON.stringify({
        input: req.input,
        backend: req.backend,
        voice: req.voice,
        params: req.params || {},
      }),
    );
  }

  function createPlayer(opts = {}) {
    const S = {
      ctx: null, gainNode: null, ws: null,
      volume: opts.volume == null ? 1.0 : opts.volume,
      playhead: 0,      // next free time on the schedule (ctx clock)
      sources: [],      // scheduled buffer sources, for flush()
      silentEl: null,
      unlockedOnce: false, // a user-gesture unlock has run at least once
      cur: null,        // current utterance {onStatus, onFirstAudio, onChunk}
      startTime: null,  // ctx clock time the current utterance begins
      bufferedDur: 0,   // seconds scheduled for the current utterance
      opts,
    };
    return {
      unlock: () => unlock(S),
      speak: (req) => speak(S, req),
      flush: () => flush(S),
      setVolume(v) {
        S.volume = v;
        if (S.gainNode) S.gainNode.gain.value = v;
      },
      // seconds of the current utterance that have actually played
      elapsed() {
        if (S.startTime === null || !S.ctx) return 0;
        return Math.max(0, S.ctx.currentTime - S.startTime);
      },
      // seconds of audio buffered so far (final once {end} arrives)
      audioDuration() {
        return S.bufferedDur;
      },
      // Live state: is the context running RIGHT NOW. Racy -- on Windows Chrome
      // (WASAPI) the state can read non-running between a gesture-unlock and the
      // next playback even though audio is fully usable. Prefer gestureUnlocked()
      // to decide "may we speak"; speak() itself resumes a suspended context.
      isUnlocked() {
        return !!S.ctx && S.ctx.state === "running";
      },
      // Sticky: has a user gesture ever unlocked this player. The correct gate
      // for "audio is permitted" -- doesn't false-negative on a transient suspend.
      gestureUnlocked() {
        return S.unlockedOnce;
      },
    };
  }

  window.HosakaAudio = { createPlayer };
})();
