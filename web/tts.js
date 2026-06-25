// TTS page client: drives the SPEAK UI (voice list, knobs) and plays streamed
// audio via the shared HosakaAudio player (see hosaka-audio.js for the WS +
// iOS-unlock + PCM-scheduling core). Auth is the app's session cookie -- sent
// automatically on the same-origin WS handshake.
const $ = (id) => document.getElementById(id);
const setStatus = (s) => {
  $("tts-status").textContent = s;
};

// The upstream lives on a home GPU box behind an SSH tunnel; when its model
// server is down the WS just closes ("disconnected" from the raw conn state),
// which reads like a bug. Name the real cause instead.
const OFFLINE = "TTS server offline — start it on the home box";

const PARAM_IDS = ["exaggeration", "cfg_weight", "temperature", "speed"];

// Backends whose generation runs through Chatterbox, so the clone knobs
// (exaggeration/cfg_weight/temperature) take effect. `rvc` = a Chatterbox
// clone fed through RVC voice conversion (e.g. charlie) -- still Chatterbox
// underneath, so its knobs are live too. kokoro/piper honor only speed.
const CLONE_BACKENDS = new Set(["chatterbox", "rvc"]);

// Per-voice loudness trim so every voice plays at ~the same level by default.
// Derived from the measured RMS of a fixed sentence per voice, normalized to a
// ~0.05 target (calm_brit was ~3x quiet; f_ellen/glados hot enough to clip).
// Effective gain = volume knob * this trim; unknown voices default to 1.0.
const VOICE_GAIN = {
  af_heart: 1.09, af_bella: 1.08, af_nicole: 0.98, af_sarah: 0.92,
  am_adam: 0.65, am_michael: 1.29, bf_emma: 0.81, bm_george: 0.86,
  calm_brit: 2.72, f_ellen: 0.16, glados: 0.25,
};
const voiceGain = () => VOICE_GAIN[$("tts-voice").value] ?? 1.0;
const applyVolume = () => player.setVolume(parseFloat($("tts-volume").value) * voiceGain());

let speaking = false; // suppress health polling clobbering live speak status

const player = HosakaAudio.createPlayer({
  onConnState: (state) => {
    if (state === "connected") setStatus("connected");
    else if (state === "error" || state === "disconnected") setStatus(OFFLINE);
  },
});

// Poll the upstream so the page shows offline BEFORE the user hits SPEAK (a bound
// tunnel port isn't liveness -- see /api/hosaka/health).
async function checkHealth() {
  if (speaking) return;
  try {
    const j = await (await fetch("/api/hosaka/health")).json();
    setStatus(j.ok ? "ready" : OFFLINE);
  } catch {
    setStatus(OFFLINE);
  }
}

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
  const labels = {
    kokoro: "kokoro (realtime)",
    chatterbox: "chatterbox (clone)",
    rvc: "rvc (chatterbox clone + voice conversion)",
    piper: "piper",
  };
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

// Dim the clone knobs for non-Chatterbox voices (kokoro/piper honor only speed).
function reflectBackend() {
  $("tts-cb").classList.toggle("off", !CLONE_BACKENDS.has(selectedBackend()));
  applyVolume(); // re-trim for the newly selected voice
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
      if (name === "volume") applyVolume();
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
  speaking = true;
  await player.speak({
    input: $("tts-text").value,
    backend: selectedBackend(),
    voice: $("tts-voice").value,
    params: params(),
    onStatus: (msg) => {
      if (msg.type === "error") {
        speaking = false;
        setStatus(msg.detail === "tts upstream unreachable" ? OFFLINE : "error: " + msg.detail);
      } else if (msg.type === "start") setStatus("speaking...");
      else if (msg.type === "end") {
        speaking = false;
        setStatus("done");
      }
    },
  });
}

window.addEventListener("DOMContentLoaded", () => {
  wireKnobs();
  applyVolume();
  loadVoices();
  checkHealth();
  setInterval(checkHealth, 15000);
  $("tts-speak").addEventListener("click", () => {
    player.unlock(); // synchronous, in-gesture -- the iOS audio unlock
    speak().catch((err) => {
      speaking = false;
      setStatus("error: " + err.message);
    });
  });
});
