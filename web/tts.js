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
const OFFLINE = "TTS server offline — start it on Wai's GPU";

const PARAM_IDS = ["exaggeration", "cfg_weight", "temperature", "speed"];

// Fallback for upstreams that don't tag voices with `cb`: backends whose
// generation runs through Chatterbox, so the clone knobs
// (exaggeration/cfg_weight/temperature) take effect. `rvc` = a Chatterbox
// clone fed through RVC voice conversion (e.g. charlie) -- still Chatterbox
// underneath. kokoro/piper honor only speed. When the upstream sends `cb` per
// voice (authoritative), that wins -- see reflectBackend().
const CLONE_BACKENDS = new Set(["chatterbox", "rvc"]);
const PIPER_BACKENDS = new Set(["piper"]);

// Per-voice loudness trim so every voice's default lands at ~80% of the clipping
// limit (output peak ~0.8) at volume knob 1.0. Effective gain = volume knob *
// this trim, so gain = 0.8 / (voice's measured worst-case peak): nicole peaks
// ~0.59 (kokoro, quiet) -> 1.35; glados ~1.01 (piper, hot) -> 0.79; charlie
// ~0.83 (rvc clone) -> 0.97. Unknown voices fall back to 1.0.
const VOICE_GAIN = {
  nicole: 1.35, glados: 0.79, charlie: 0.97,
};
const voiceGain = () => VOICE_GAIN[$("tts-voice").value] ?? 1.0;

// Charlie (RVC clone) degrades past 1.1x playback speed; cap its slider there.
// Other voices keep the full range.
const SPEED_CAP = { charlie: 1.1 };
const applyVolume = () => player.setVolume(parseFloat($("tts-volume").value) * voiceGain());

let speaking = false; // suppress health polling clobbering live speak status
let health = { ok: false, home: false, piper: false };

// The params are locked in for the in-flight utterance, so freeze every knob
// for the whole generating->playback lifecycle. The `.busy` class dims + makes
// all knob blocks non-interactive uniformly; don't also set the speed slider's
// `disabled` (the native UA grey made it look different from the others).
const setSpeaking = (on) => {
  speaking = on;
  document.querySelector(".tts").classList.toggle("busy", on);
};

const player = HosakaAudio.createPlayer({
  onConnState: (state) => {
    if (state === "error" || state === "disconnected") {
      if (speaking) { setSpeaking(false); setBtn("Speak", true); }
      setStatus(OFFLINE);
    }
  },
});

// Minimalist playback scope: a scrolling waveform pinned to the right edge.
// Always present -- on load it shows a flat baseline; each animation frame
// samples the player's analyser tap for a single peak amplitude and pushes it
// onto the right edge, scrolling older samples left. When nothing is playing the
// analyser reads silence (or is absent before the first unlock), so the trace
// sits flat. The stroke hue is read from the canvas `color` (set in tts.css) so
// the palette stays in CSS.
const wave = (() => {
  const cv = $("tts-wave");
  const cx = cv && cv.getContext("2d");
  if (!cx) return { start() {} };
  let timer = 0;
  let cols = [];
  let stroke = "currentColor";

  const dpr = () => window.devicePixelRatio || 1;
  function resize() {
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr()));
    cv.height = Math.max(1, Math.round(r.height * dpr()));
    stroke = getComputedStyle(cv).color || stroke;
  }

  function peak() {
    const an = player.getAnalyser();
    if (!an) return 0;
    const buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > m) m = v;
    }
    return m;
  }

  function frame() {
    const w = cv.width, h = cv.height, mid = h / 2;
    cols.push(peak()); // silence (or 0 before unlock) keeps the line flat
    while (cols.length > w) cols.shift(); // scroll left
    cx.clearRect(0, 0, w, h);
    cx.strokeStyle = stroke;
    cx.lineWidth = dpr();
    cx.beginPath();
    const base = w - cols.length; // newest sample hugs the right edge
    for (let i = 0; i < cols.length; i++) {
      const x = base + i + 0.5;
      const a = cols[i] * (mid - 1);
      cx.moveTo(x, mid - a);
      cx.lineTo(x, mid + a);
    }
    cx.stroke();
  }

  return {
    // Timer-driven, not requestAnimationFrame: WebKit throttles rAF to a crawl
    // when the window loses focus, freezing the scope while audio still plays.
    // setInterval keeps firing at full rate for a visible-but-unfocused window
    // (it only clamps once the tab is fully hidden, where the wave isn't seen).
    start() {
      if (timer) return;
      resize();
      timer = setInterval(frame, 1000 / 60);
    },
  };
})();

function backendLive(backend) {
  return PIPER_BACKENDS.has(backend) ? health.piper : health.home;
}

function applyHealth() {
  const sel = $("tts-voice");
  for (const o of sel.options) {
    o.disabled = !backendLive(o.dataset.backend);
  }
  // If the selected voice's upstream just went down, move to a live one.
  const cur = sel.selectedOptions[0];
  if (cur && cur.disabled) {
    const live = [...sel.options].find((o) => !o.disabled);
    if (live) live.selected = true;
  }
  const liveSel = sel.selectedOptions[0];
  if (liveSel && backendLive(liveSel.dataset.backend)) {
    setBtn("Speak", true);
    setStatus(health.home ? "" : "Wai's GPU offline -- glados only");
  } else {
    setBtn("offline", false);
    setStatus(OFFLINE);
  }
  if (typeof reflectBackend === "function") reflectBackend();
}

// Poll the upstream so the page shows offline BEFORE the user hits SPEAK (a bound
// tunnel port isn't liveness -- see /api/hosaka/health).
async function checkHealth() {
  if (speaking) return; // mid-speak: the button shows generating/speaking
  try {
    health = await (await fetch("/api/hosaka/health")).json();
  } catch {
    health = { ok: false, home: false, piper: false };
  }
  applyHealth();
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
  sel.addEventListener("change", () => { reflectBackend(); applyHealth(); });
  reflectBackend();
  applyHealth();
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
  setSpeaking(true);
  setStatus("");
  setBtn("generating...", false);
  await player.speak({
    input: $("tts-text").value,
    backend: selectedBackend(),
    voice: $("tts-voice").value,
    params: params(),
    onStatus: (msg) => {
      if (msg.type === "error") {
        setSpeaking(false);
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
          setSpeaking(false);
          setBtn("Speak", true);
        }, remainMs + 200);
      }
    },
  });
}

// Live count of users on /hosaka right now. A dedicated presence WebSocket
// (separate from the audio /ws/hosaka, which only opens on Speak): the server
// holds every open presence socket and broadcasts {count} on each join/leave.
// Reconnects with a capped backoff if the socket drops.
function mountPresence() {
  const el = $("tts-presence");
  if (!el) return;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  let retry = 0;
  const render = (n) => {
    el.textContent = n === 1 ? "1 user connected" : n + " users connected";
  };
  const connect = () => {
    const ws = new WebSocket(`${scheme}://${location.host}/ws/hosaka/presence`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => {
      try { render(JSON.parse(e.data).count); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      // Keep the last count on screen (never blank) so the line holds its
      // height -- reconnect quietly in the background.
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, retry * 1000);
    };
    ws.onerror = () => ws.close();
  };
  connect();
}

window.addEventListener("DOMContentLoaded", () => {
  wireKnobs();
  applyVolume();
  loadVoices();
  wave.start(); // always-on scope -- flat baseline until audio plays
  mountPresence();
  checkHealth();
  setInterval(checkHealth, 15000);
  $("tts-speak").addEventListener("click", () => {
    player.unlock(); // synchronous, in-gesture -- the iOS audio unlock
    speak().catch((err) => {
      setSpeaking(false);
      setBtn("Speak", true);
      setStatus("error: " + err.message);
    });
  });
});

// --- GPU mode control (owner-only). GET 401 for guests keeps the control
// hidden. The three-button segmented strip switches emo / idle / homo. ---
(function () {
  const el = document.getElementById("tts-mode");
  if (!el) return;
  const buttons = Array.from(el.querySelectorAll(".tts-mode-btn"));

  function render(mode) {
    el.hidden = false;
    el.classList.toggle("gone", mode === "gone");
    for (const b of buttons) {
      const isActive = b.dataset.mode === mode;
      b.classList.toggle("active", isActive);
      // active button + gone state are non-interactive; others clickable
      b.disabled = isActive || mode === "gone";
    }
  }

  async function load() {
    try {
      const r = await fetch("/api/hosaka/mode");
      if (r.status === 401) { el.hidden = true; return; } // guest: no control
      render((await r.json()).mode);
    } catch { el.hidden = true; }
  }

  async function post(action, force) {
    const r = await fetch("/api/hosaka/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, force: !!force }),
    });
    if (r.status === 409) {
      const info = (await r.json()).detail || {};
      const n = info.count != null ? info.count : "some";
      if (confirm(n + " user(s) streaming -- switch anyway?")) return post(action, true);
      return; // cancelled
    }
    render((await r.json()).mode);
  }

  for (const b of buttons) {
    b.addEventListener("click", () => { if (!b.disabled) post(b.dataset.mode, false); });
  }
  load();
})();
