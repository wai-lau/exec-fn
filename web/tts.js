// TTS page client: opens a same-origin WebSocket (proxied server-side to the
// home GPU server) and plays the streamed float32 PCM (24 kHz mono). Auth is
// the app's session cookie -- sent automatically on the WS handshake.
//
// Playback uses AudioBufferSourceNode scheduling rather than an AudioWorklet:
// on iOS Safari a worklet context forced to a non-hardware sampleRate (24 kHz)
// renders silence even when it reports "running". An AudioBuffer can carry any
// rate and gets resampled to the hardware rate on playback, so the context is
// left at its default rate and stays audible on iOS.
const $ = (id) => document.getElementById(id);
const setStatus = (s) => {
  $("tts-status").textContent = s;
};

const SR = 24000; // upstream PCM rate

let ctx = null;
let gainNode = null;
let ws = null;
let volume = 1.0;
let playhead = 0; // next free time on the schedule (ctx clock)
let sources = []; // scheduled buffer sources, for flush()

const PARAM_IDS = ["exaggeration", "cfg_weight", "temperature", "speed"];

async function loadVoices() {
  const sel = $("tts-voice");
  let voices;
  try {
    voices = await (await fetch("/api/hosaka/voices")).json();
  } catch {
    voices = [];
  }
  if (!voices.length) {
    sel.innerHTML = '<option value="af_heart">af_heart</option>';
    return;
  }
  const groups = {};
  for (const v of voices) (groups[v.backend] ||= []).push(v);
  const labels = { kokoro: "kokoro (realtime)", chatterbox: "chatterbox (clone)" };
  sel.innerHTML = "";
  for (const backend of Object.keys(groups)) {
    const og = document.createElement("optgroup");
    og.label = labels[backend] || backend;
    for (const v of groups[backend]) {
      const o = document.createElement("option");
      o.value = v.id;
      o.dataset.backend = v.backend;
      o.textContent = v.description ? `${v.id} - ${v.description}` : v.id;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  sel.addEventListener("change", reflectBackend);
  reflectBackend();
}

function selectedBackend() {
  const o = $("tts-voice").selectedOptions[0];
  return o ? o.dataset.backend : "kokoro";
}

// Dim the chatterbox-only knobs for kokoro voices (kokoro honors only speed).
function reflectBackend() {
  $("tts-cb").classList.toggle("off", selectedBackend() !== "chatterbox");
}

function wireKnobs() {
  for (const name of [...PARAM_IDS, "volume"]) {
    const el = $("tts-" + name);
    const out = $("tts-" + name + "-val");
    const show = () => {
      out.textContent = parseFloat(el.value).toFixed(2);
    };
    el.addEventListener("input", () => {
      show();
      if (name === "volume") {
        volume = parseFloat(el.value);
        if (gainNode) gainNode.gain.value = volume;
      }
    });
    show();
  }
}

function params() {
  const p = {};
  for (const name of PARAM_IDS) p[name] = parseFloat($("tts-" + name).value);
  return p;
}

// Create + unlock the AudioContext. MUST run synchronously inside the click
// gesture: iOS Safari only unlocks audio when a buffer source is started (not
// resume() alone) within the gesture, so the first utterance stays silent
// otherwise -- "done" with no sound. No forced sampleRate (see file header).
function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  // Silent 1-sample blip through the destination: the actual iOS unlock kick.
  const b = ctx.createBuffer(1, 1, ctx.sampleRate);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
}

function flushPlayback() {
  for (const s of sources) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  sources = [];
  playhead = 0;
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
  playhead = at + buf.duration;
  sources.push(src);
  src.onended = () => {
    sources = sources.filter((x) => x !== src);
  };
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}/ws/hosaka`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      setStatus("connected");
      resolve();
    };
    ws.onerror = () => {
      setStatus("connection error");
      reject(new Error("ws error"));
    };
    ws.onclose = () => setStatus("disconnected");
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);
        if (msg.type === "error") setStatus("error: " + msg.detail);
        else if (msg.type === "start") setStatus("speaking...");
        else if (msg.type === "end") setStatus("done");
        return;
      }
      enqueuePCM(new Float32Array(e.data));
    };
  });
}

async function speak() {
  unlockAudio();
  if (ctx.state === "suspended") await ctx.resume();
  if (!ws || ws.readyState !== WebSocket.OPEN) await openSocket();
  flushPlayback(); // drop any tail from a previous utterance
  ws.send(
    JSON.stringify({
      input: $("tts-text").value,
      backend: selectedBackend(),
      voice: $("tts-voice").value,
      params: params(),
    }),
  );
}

window.addEventListener("DOMContentLoaded", () => {
  wireKnobs();
  loadVoices();
  $("tts-speak").addEventListener("click", () => {
    unlockAudio(); // synchronous, in-gesture -- the iOS audio unlock
    speak().catch((err) => setStatus("error: " + err.message));
  });
});
