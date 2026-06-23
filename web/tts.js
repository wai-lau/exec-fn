// TTS page client: opens a same-origin WebSocket (proxied server-side to the
// home GPU server), streams float32 PCM (24 kHz mono) into an AudioWorklet.
// Auth is the app's session cookie -- sent automatically on the WS handshake.
const $ = (id) => document.getElementById(id);
const setStatus = (s) => {
  $("tts-status").textContent = s;
};

let ctx = null;
let node = null;
let ws = null;
let gain = 1.0;

const PARAM_IDS = ["exaggeration", "cfg_weight", "temperature", "speed"];

async function loadVoices() {
  const sel = $("tts-voice");
  let voices;
  try {
    voices = await (await fetch("/api/tts/voices")).json();
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
        gain = parseFloat(el.value);
        if (node) node.port.postMessage({ gain });
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

async function ensureAudio() {
  if (ctx) return;
  ctx = new AudioContext({ sampleRate: 24000 });
  await ctx.audioWorklet.addModule("/pcm-player.js");
  node = new AudioWorkletNode(ctx, "pcm-player");
  node.port.postMessage({ gain });
  node.connect(ctx.destination);
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}/ws/tts`);
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
      node.port.postMessage(new Float32Array(e.data));
    };
  });
}

async function speak() {
  await ensureAudio();
  if (ctx.state === "suspended") await ctx.resume();
  if (!ws || ws.readyState !== WebSocket.OPEN) await openSocket();
  node.port.postMessage(null); // flush previous tail
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
    speak().catch((err) => setStatus("error: " + err.message));
  });
});
