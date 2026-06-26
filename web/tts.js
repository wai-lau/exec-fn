// TTS page client: drives the SPEAK UI (voice list, knobs) and plays streamed
// audio via the shared HosakaAudio player (see hosaka-audio.js for the WS +
// iOS-unlock + PCM-scheduling core). Auth is the app's session cookie -- sent
// automatically on the same-origin WS handshake.
const $ = (id) => document.getElementById(id);
// #tts-status carries only diagnostic detail now (offline reason / error text);
// the speak lifecycle (ready -> generating -> speaking) drives the SPEAK button.
const setStatus = (s) => {
  $("tts-status").textContent = s;
};
const setBtn = (label, enabled) => {
  const b = $("tts-speak");
  b.textContent = label;
  b.disabled = !enabled;
};

// The upstream lives on a home GPU box behind an SSH tunnel; when its model
// server is down the WS just closes ("disconnected" from the raw conn state),
// which reads like a bug. Name the real cause instead.
const OFFLINE = "TTS server offline — start it on the home box";

const PARAM_IDS = ["exaggeration", "cfg_weight", "temperature", "speed"];

// Fallback for upstreams that don't tag voices with `cb`: backends whose
// generation runs through Chatterbox, so the clone knobs
// (exaggeration/cfg_weight/temperature) take effect. `rvc` = a Chatterbox
// clone fed through RVC voice conversion (e.g. charlie) -- still Chatterbox
// underneath. kokoro/piper honor only speed. When the upstream sends `cb` per
// voice (authoritative), that wins -- see reflectBackend().
const CLONE_BACKENDS = new Set(["chatterbox", "rvc"]);

// Per-voice loudness trim so every voice plays at ~the same level by default.
// Derived from the measured RMS of a fixed sentence per voice, normalized to a
// ~0.05 target (glados is hot enough to clip). Effective gain = volume knob *
// this trim; unknown voices (e.g. charlie) default to 1.0.
const VOICE_GAIN = {
  nicole: 0.98, glados: 0.25,
};
const voiceGain = () => VOICE_GAIN[$("tts-voice").value] ?? 1.0;

// Charlie (RVC clone) degrades past 1.1x playback speed; cap its slider there.
// Other voices keep the full range.
const SPEED_CAP = { charlie: 1.1 };
const applyVolume = () => player.setVolume(parseFloat($("tts-volume").value) * voiceGain());

let speaking = false; // suppress health polling clobbering live speak status

const player = HosakaAudio.createPlayer({
  onConnState: (state) => {
    if (state === "error" || state === "disconnected") {
      if (speaking) { speaking = false; setBtn("Speak", true); }
      setStatus(OFFLINE);
    }
  },
});

// Poll the upstream so the page shows offline BEFORE the user hits SPEAK (a bound
// tunnel port isn't liveness -- see /api/hosaka/health).
async function checkHealth() {
  if (speaking) return; // mid-speak: the button shows generating/speaking
  try {
    const j = await (await fetch("/api/hosaka/health")).json();
    if (j.ok) { setBtn("Speak", true); setStatus(""); }
    else { setBtn("offline", false); setStatus(OFFLINE); }
  } catch {
    setBtn("offline", false);
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
    sel.innerHTML = '<option value="nicole">nicole</option>';
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
      // Authoritative chatterbox-clone flag from the upstream, when present.
      if (v.cb != null) o.dataset.cb = v.cb ? "1" : "0";
      o.textContent = v.id;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  // Charlie (chatterbox clone + RVC) is the headline voice -- default to it
  // when the upstream offers it; fall back to the first listed voice otherwise.
  const def = [...sel.options].find((o) => o.value === "charlie");
  if (def) def.selected = true;
  sel.addEventListener("change", reflectBackend);
  reflectBackend();
}

function selectedBackend() {
  const o = $("tts-voice").selectedOptions[0];
  return o ? o.dataset.backend : "kokoro";
}

// Does the selected voice run through Chatterbox (clone knobs apply). Prefer the
// upstream's per-voice `cb` flag; fall back to the backend heuristic when absent.
function selectedIsClone() {
  const o = $("tts-voice").selectedOptions[0];
  if (o && o.dataset.cb != null) return o.dataset.cb === "1";
  return CLONE_BACKENDS.has(selectedBackend());
}

// Dim the clone knobs for non-Chatterbox voices (kokoro/piper honor only speed).
function reflectBackend() {
  $("tts-cb").classList.toggle("off", !selectedIsClone());
  applyVolume(); // re-trim for the newly selected voice
  applySpeedCap(); // charlie degrades past 1.1x
}

function applySpeedCap() {
  const el = $("tts-speed");
  const cap = SPEED_CAP[$("tts-voice").value] ?? 2;
  el.max = cap;
  if (parseFloat(el.value) > cap) {
    el.value = cap;
    $("tts-speed-val").textContent = parseFloat(el.value).toFixed(2);
  }
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
  setStatus("");
  setBtn("generating...", false);
  await player.speak({
    input: $("tts-text").value,
    backend: selectedBackend(),
    voice: $("tts-voice").value,
    params: params(),
    onStatus: (msg) => {
      if (msg.type === "error") {
        speaking = false;
        setBtn("Speak", true);
        setStatus(msg.detail === "tts upstream unreachable" ? OFFLINE : "error: " + msg.detail);
      } else if (msg.type === "start") {
        setBtn("generating...", false);
      } else if (msg.type === "end") {
        // {end} = upstream done sending; audio is buffered + playing. Hold the
        // button on "speaking..." for the remaining playback, then free it.
        setBtn("speaking...", false);
        const remainMs = Math.max(0, player.audioDuration() - player.elapsed()) * 1000;
        setTimeout(() => {
          speaking = false;
          setBtn("Speak", true);
        }, remainMs + 200);
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
      setBtn("Speak", true);
      setStatus("error: " + err.message);
    });
  });
});
