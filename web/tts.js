// TTS page client: drives the SPEAK UI (voice list, knobs) and plays streamed
// audio via the shared HosakaAudio player (see hosaka-audio.js for the WS +
// iOS-unlock + PCM-scheduling core). Auth is the app's session cookie -- sent
// automatically on the same-origin WS handshake.
const $ = (id) => document.getElementById(id);
const setStatus = (s) => {
  $("tts-status").textContent = s;
};

const PARAM_IDS = ["exaggeration", "cfg_weight", "temperature", "speed"];

const player = HosakaAudio.createPlayer({
  onConnState: (state) => {
    if (state === "connected") setStatus("connected");
    else if (state === "error") setStatus("connection error");
    else if (state === "disconnected") setStatus("disconnected");
  },
});

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
      if (name === "volume") player.setVolume(parseFloat(el.value));
    });
    show();
  }
}

function params() {
  const p = {};
  for (const name of PARAM_IDS) p[name] = parseFloat($("tts-" + name).value);
  return p;
}

async function speak() {
  await player.speak({
    input: $("tts-text").value,
    backend: selectedBackend(),
    voice: $("tts-voice").value,
    params: params(),
    onStatus: (msg) => {
      if (msg.type === "error") setStatus("error: " + msg.detail);
      else if (msg.type === "start") setStatus("speaking...");
      else if (msg.type === "end") setStatus("done");
    },
  });
}

window.addEventListener("DOMContentLoaded", () => {
  wireKnobs();
  player.setVolume(parseFloat($("tts-volume").value));
  loadVoices();
  $("tts-speak").addEventListener("click", () => {
    player.unlock(); // synchronous, in-gesture -- the iOS audio unlock
    speak().catch((err) => setStatus("error: " + err.message));
  });
});
