// /aspira — sound effects, all synthesised with WebAudio (no audio files).
// The context is created on the first tap/key (browsers refuse audio before a
// gesture). Each sound has a minimum gap so a wall of rapid-fire towers is a
// texture, not a roar, and there is a hard cap on live voices.

let AC = null, master = null, outGain = null, noiseBuf = null, voices = 0, muted = false;
// volume slider (owner, 2026-10-02): 0..2, applied AFTER the limiter so it
// really scales what you hear; the default 1 is twice the old loudness
let volume = 1;
const VOL_BOOST = 2;
try {
  muted = localStorage.getItem("aspira.mute") === "1";
  const v = parseFloat(localStorage.getItem("aspira.vol"));
  if (v >= 0 && v <= 2) volume = v;
} catch (_e) {}
const lastAt = {};
const MAX_VOICES = 24;

function audioUnlock() {
  if (AC) { if (AC.state === "suspended") AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = 0.22;
    // a limiter after the mix: with towers firing many times a second, stacked
    // sounds used to sum past full scale and clip into audible zaps/crackle
    const limiter = AC.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.15;
    outGain = AC.createGain();
    outGain.gain.value = volume * VOL_BOOST;
    master.connect(limiter).connect(outGain).connect(AC.destination);
    loadSamples();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (_e) { AC = null; }
}
document.addEventListener("pointerdown", audioUnlock);
document.addEventListener("keydown", audioUnlock);

function setMuted(m) {
  muted = m;
  try { localStorage.setItem("aspira.mute", m ? "1" : "0"); } catch (_e) {}
}
function setVolume(v) {
  volume = v;
  if (outGain) outGain.gain.setTargetAtTime(v * VOL_BOOST, AC.currentTime, 0.02);
  try { localStorage.setItem("aspira.vol", String(v)); } catch (_e) {}
}

function envelope(node, t0, dur, vol) {
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); // 8ms fade-in: no start click
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g).connect(master);
  voices++;
  // a synth sound is several nodes: it counts as one copy until its last ends
  const inst = curSound;
  if (inst) inst.nodes++;
  node.onended = () => { voices--; if (inst && --inst.nodes === 0) playing[inst.name]--; };
}

function tone({ type = "sine", f0, f1 = f0, dur = 0.1, vol = 0.3, delay = 0 }) {
  const t0 = AC.currentTime + delay, o = AC.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  envelope(o, t0, dur, vol);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.1, vol = 0.3, freq = 2000, q = 1, delay = 0 }) {
  const t0 = AC.currentTime + delay, src = AC.createBufferSource(), f = AC.createBiquadFilter();
  src.buffer = noiseBuf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  src.connect(f);
  envelope(f, t0, dur, vol);
  src.onended = f.onended;
  src.start(t0); src.stop(t0 + dur + 0.02);
}

const notes = (fs, step, opts) => fs.forEach((f, i) => tone({ f0: f, delay: i * step, ...opts }));

const SFX = {
  chain:   () => { noise({ dur: 0.08, vol: 0.2, freq: 3200, q: 2 }); tone({ type: "sawtooth", f0: 600, f1: 1800, dur: 0.07, vol: 0.06 }); },
  // RPR fires a LASER (owner: no bass): a fast falling zap, a brighter buzz
  // under it, a high crack and a faint echo - nothing below ~350Hz
  reaper:  () => {
    tone({ f0: 600, f1: 90, dur: 0.32, vol: 0.24 });
    tone({ type: "square", f0: 420, f1: 110, dur: 0.24, vol: 0.05 });
    noise({ dur: 0.07, vol: 0.12, freq: 1400, q: 1.2 });
    tone({ f0: 600, f1: 90, dur: 0.32, vol: 0.06, delay: 0.12 });
  },
  slower:  () => tone({ f0: 900, f1: 480, dur: 0.18, vol: 0.1 }),
  kill:    () => tone({ type: "triangle", f0: 520, f1: 1040, dur: 0.07, vol: 0.16 }),
  // the core is hit: a SHUTDOWN (owner) - a click, then the power sliding
  // away, everything falling to nothing like a machine switching off
  leak:    () => {
    noise({ dur: 0.03, vol: 0.14, freq: 1800, q: 1 });
    tone({ type: "square", f0: 520, f1: 30, dur: 0.75, vol: 0.09 });
    tone({ f0: 260, f1: 22, dur: 0.85, vol: 0.22 });
  },
  wave:    () => notes([440, 554, 659], 0.07, { type: "triangle", dur: 0.12, vol: 0.18 }),
  build:   () => tone({ type: "square", f0: 300, f1: 600, dur: 0.06, vol: 0.12 }),
  up:      () => notes([523, 784, 1046], 0.06, { type: "triangle", dur: 0.1, vol: 0.18 }),
  sell:    () => notes([523, 330], 0.06, { type: "triangle", dur: 0.1, vol: 0.15 }),
  life:    () => notes([659, 880, 1318], 0.08, { dur: 0.16, vol: 0.18 }),
  over:    () => notes([392, 330, 262, 196], 0.18, { type: "triangle", dur: 0.32, vol: 0.25 }),
};
// minimum seconds between two plays of the same sound
const GAP = { chain: 0.07, kill: 0.04, slower: 0.1, leak: 0.5 };

// returns whatever the sound returns (a stop() handle for long sounds), or null
// Optional SAMPLES (owner, 2026-10-02: Brood War sounds) replace a synth
// sound when present. They live in api/data/aspira-sfx/ - never committed
// (api/data/ is gitignored; the repo is public) and served owner-only through
// /data/ - listed in its index.json as { "<sound name>": "file" | ["file", ...],
// "_gain": 0.5 } (several files = one picked at random each time). Missing
// folder, index or file: that sound stays synthesised.
const SAMPLE_DIR = "/data/aspira-sfx/", SAMPLES = {};
let sampleMap = null, sampleGain = 0.5;
fetch(SAMPLE_DIR + "index.json").then(r => (r.ok ? r.json() : null)).then(m => {
  if (!m) return;
  sampleMap = m;
  if (typeof m._gain === "number") sampleGain = m._gain;
  loadSamples();
}).catch(() => {});
function loadSamples() {
  if (!sampleMap || !AC) return;
  for (const [name, files] of Object.entries(sampleMap)) {
    if (name.startsWith("_") || SAMPLES[name]) continue;
    SAMPLES[name] = [];
    // an entry is a file, or { file, start, end } to play only a slice of it
    // (seconds), e.g. just the double beep at the head of an advisor line
    for (const f of [].concat(files)) {
      const clip = typeof f === "string" ? { file: f } : f;
      fetch(SAMPLE_DIR + clip.file).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(clip.file))))
        .then(b => AC.decodeAudioData(b)).then(buf => SAMPLES[name].push({ buf, start: clip.start || 0, end: clip.end || buf.duration }))
        .catch(() => {});
    }
  }
}
// Each TOWER's sound plays at most 3 copies at once (owner, 2026-10-02),
// sample or synth alike: playing[name] counts live copies and a 4th is
// skipped. A sample copy is also quieter by how many are already sounding.
const SOUND_MAX = { chain: 3, slower: 3, reaper: 3, acid: 3 }, playing = {};
let curSound = null; // the synth sound being built, so envelope() can count it
// LOUDNESS (owner, 2026-10-02): the bosses' warnings and voices and every
// upgrade/build sound stand well above the towers' shots - about 10 dB
// (TOWER_GAIN 0.6 vs LOUD_GAIN 2)
const TOWER_GAIN = 0.6, LOUD_GAIN = 2;
const LOUD = /^(bosswarn|bossvoice|coreup|up|build)/;
const gainFor = name => (LOUD.test(name) ? LOUD_GAIN : SOUND_MAX[name] ? TOWER_GAIN : 1);
function playSample(name, at = 0) {
  const list = SAMPLES[name], n = playing[name] || 0;
  const src = AC.createBufferSource(), g = AC.createGain(), clip = list[Math.floor(Math.random() * list.length)];
  src.buffer = clip.buf;
  g.gain.value = sampleGain * gainFor(name) / (SOUND_MAX[name] ? 1 + n : 1);
  src.connect(g).connect(master);
  voices++; playing[name] = n + 1;
  src.onended = () => { voices--; playing[name]--; };
  src.start(AC.currentTime + at, clip.start, clip.end - clip.start);
  return src;
}
// samples played back to back (owner: the boss warning - a double beep, then
// the voice); missing ones are skipped, and a sequence never overlaps itself
const bossVoice = id => (SAMPLES["bossvoice." + id] && SAMPLES["bossvoice." + id].length ? "bossvoice." + id : "bossvoice");
function sfxSeq(names) {
  if (muted || !AC || AC.state !== "running") return;
  let at = 0;
  for (const name of names) {
    const list = SAMPLES[name];
    if (!list || !list.length) continue;
    playSample(name, at);
    at += list[0].end - list[0].start + 0.1;
  }
}

// a per-TOWER variant of a sound when one is mapped (owner: each tower's own
// build/upgrade sample, index.json keys like "build.reaper"), else the shared one
function sfxFor(name, kind) {
  const k = name + "." + kind;
  return SAMPLES[k] && SAMPLES[k].length ? sfx(k) : sfx(name);
}
function sfx(name, ...args) {
  const sample = SAMPLES[name] && SAMPLES[name].length;
  if (muted || !AC || AC.state !== "running" || voices > MAX_VOICES || !(SFX[name] || sample)) return null;
  const now = AC.currentTime;
  if (now - (lastAt[name] ?? -1) < (GAP[name] ?? 0.03)) return null;
  if (SOUND_MAX[name] && (playing[name] || 0) >= SOUND_MAX[name]) return null;
  lastAt[name] = now;
  if (sample) return playSample(name);
  const inst = { name, nodes: 0 };
  curSound = inst;
  let h;
  try { h = SFX[name](...args); } finally { curSound = null; }
  if (inst.nodes) playing[name] = (playing[name] || 0) + 1;
  return h || null;
}
