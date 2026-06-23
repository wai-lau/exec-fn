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
(function () {
  const SR = 24000; // upstream PCM rate

  function createPlayer(opts = {}) {
    let ctx = null;
    let gainNode = null;
    let ws = null;
    let volume = opts.volume == null ? 1.0 : opts.volume;
    let playhead = 0; // next free time on the schedule (ctx clock)
    let sources = []; // scheduled buffer sources, for flush()
    let silentEl = null;

    // current utterance
    let cur = null; // {onStatus, onFirstAudio, onChunk}
    let startTime = null; // ctx clock time the current utterance begins
    let bufferedDur = 0; // seconds scheduled for the current utterance

    // iOS mutes the Web Audio API under the Ring/Silent switch. Looping a silent
    // HTMLMediaElement (in-gesture) moves the page's audio session to "playback",
    // which the switch does NOT mute -- so buffer output is then audible even in
    // silent mode. Kept looping so the session stays in that category.
    function enableSilentModePlayback() {
      if (!silentEl) {
        silentEl = document.createElement("audio");
        silentEl.src = "/silence.wav?v=1";
        silentEl.loop = true;
        silentEl.playsInline = true;
        silentEl.setAttribute("playsinline", "");
      }
      silentEl.play().catch(() => {
        /* no gesture / unsupported -- audio still works with the switch off */
      });
    }

    // Create + unlock the AudioContext. MUST run synchronously inside a click
    // gesture: iOS Safari only unlocks audio when a buffer source is started (not
    // resume() alone) within the gesture, so the first utterance stays silent
    // otherwise. No forced sampleRate (see file header).
    function unlock() {
      if (!ctx) {
        ctx = new AudioContext();
        gainNode = ctx.createGain();
        gainNode.gain.value = volume;
        gainNode.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      enableSilentModePlayback(); // play through the iOS Ring/Silent switch
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    }

    function flush() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      sources = [];
      playhead = 0;
      startTime = null;
      bufferedDur = 0;
    }

    // Schedule one PCM chunk (Float32Array @ 24 kHz) right after the previous one.
    function enqueuePCM(f32) {
      if (!f32.length) return;
      const buf = ctx.createBuffer(1, f32.length, SR);
      buf.getChannelData(0).set(f32);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gainNode);
      const at = Math.max(ctx.currentTime + 0.05, playhead);
      src.start(at);
      if (startTime === null) {
        startTime = at;
        if (cur && cur.onFirstAudio) cur.onFirstAudio(at);
      }
      playhead = at + buf.duration;
      bufferedDur += buf.duration;
      sources.push(src);
      src.onended = () => {
        sources = sources.filter((x) => x !== src);
      };
      if (cur && cur.onChunk) cur.onChunk(bufferedDur);
    }

    function openSocket() {
      return new Promise((resolve, reject) => {
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${scheme}://${location.host}/ws/hosaka`);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          if (opts.onConnState) opts.onConnState("connected");
          resolve();
        };
        ws.onerror = () => {
          if (opts.onConnState) opts.onConnState("error");
          reject(new Error("ws error"));
        };
        ws.onclose = () => {
          if (opts.onConnState) opts.onConnState("disconnected");
        };
        ws.onmessage = (e) => {
          if (typeof e.data === "string") {
            let msg;
            try {
              msg = JSON.parse(e.data);
            } catch {
              return;
            }
            if (cur && cur.onStatus) cur.onStatus(msg);
            return;
          }
          enqueuePCM(new Float32Array(e.data));
        };
      });
    }

    // Speak one utterance. Opens the socket on first use, drops any previous
    // tail, then streams. Callbacks fire per-utterance:
    //   onStatus(msg)      -- {type:"start"|"end"|"error", detail?}
    //   onFirstAudio(at)   -- first PCM chunk scheduled (ctx clock)
    //   onChunk(seconds)   -- running buffered duration after each chunk
    async function speak(req) {
      unlock();
      if (ctx.state === "suspended") await ctx.resume();
      if (!ws || ws.readyState !== WebSocket.OPEN) await openSocket();
      flush();
      cur = { onStatus: req.onStatus, onFirstAudio: req.onFirstAudio, onChunk: req.onChunk };
      ws.send(
        JSON.stringify({
          input: req.input,
          backend: req.backend,
          voice: req.voice,
          params: req.params || {},
        }),
      );
    }

    return {
      unlock,
      speak,
      flush,
      setVolume(v) {
        volume = v;
        if (gainNode) gainNode.gain.value = v;
      },
      // seconds of the current utterance that have actually played
      elapsed() {
        if (startTime === null || !ctx) return 0;
        return Math.max(0, ctx.currentTime - startTime);
      },
      // seconds of audio buffered so far (final once {end} arrives)
      audioDuration() {
        return bufferedDur;
      },
      isUnlocked() {
        return !!ctx && ctx.state === "running";
      },
    };
  }

  window.HosakaAudio = { createPlayer };
})();
