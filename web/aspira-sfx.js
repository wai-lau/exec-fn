// /aspira — sound effects, all synthesised with WebAudio (no audio files).
// The context is created on the first tap/key (browsers refuse audio before a
// gesture). Each sound has a minimum gap so a wall of rapid-fire towers is a
// texture, not a roar, and there is a hard cap on live voices.

let AC = null, master = null, noiseBuf = null, voices = 0, muted = false;
try { muted = localStorage.getItem("aspira.mute") === "1"; } catch (_e) {}
const lastAt = {};
const MAX_VOICES = 24;

function audioUnlock() {
  if (AC) { if (AC.state === "suspended") AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = 0.22;
    master.connect(AC.destination);
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

function envelope(node, t0, dur, vol) {
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g).connect(master);
  voices++;
  node.onended = () => { voices--; };
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

// A rising, swelling hum over `dur` seconds (the Reaper's reload); returns a
// handle whose stop() cuts it short when the charge is abandoned.
function chargeHum(dur) {
  const t0 = AC.currentTime, o = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(420, t0 + dur);
  f.type = "lowpass"; f.frequency.setValueAtTime(350, t0); f.frequency.exponentialRampToValueAtTime(2600, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.07, t0 + dur);
  o.connect(f).connect(g).connect(master);
  voices++; o.onended = () => { voices--; };
  o.start(t0); o.stop(t0 + dur + 0.05);
  return { stop() { try { g.gain.cancelScheduledValues(AC.currentTime); g.gain.setTargetAtTime(0.0001, AC.currentTime, 0.03); o.stop(AC.currentTime + 0.12); } catch (_e) {} } };
}

const notes = (fs, step, opts) => fs.forEach((f, i) => tone({ f0: f, delay: i * step, ...opts }));

const SFX = {
  rapid:   () => tone({ type: "square", f0: 1400, f1: 900, dur: 0.03, vol: 0.08 }),
  chain:   () => { noise({ dur: 0.08, vol: 0.2, freq: 3200, q: 2 }); tone({ type: "sawtooth", f0: 600, f1: 1800, dur: 0.07, vol: 0.06 }); },
  // RPR fires a big-cannon discharge (owner asked for that feel; original
  // synthesis): a deep falling body, a low rumble and a bright crack on top
  reaper:  () => {
    tone({ f0: 150, f1: 32, dur: 0.8, vol: 0.38 });
    tone({ type: "sawtooth", f0: 90, f1: 40, dur: 0.5, vol: 0.12 });
    noise({ dur: 0.6, vol: 0.28, freq: 260, q: 0.6 });
    noise({ dur: 0.09, vol: 0.16, freq: 2600, q: 1.2 });
  },
  // and charges up for it: a hum that climbs and swells over the whole reload
  reaperCharge: dur => chargeHum(dur),
  slower:  () => tone({ f0: 900, f1: 480, dur: 0.18, vol: 0.1 }),
  kill:    () => tone({ type: "triangle", f0: 520, f1: 1040, dur: 0.07, vol: 0.16 }),
  leak:    () => tone({ type: "sawtooth", f0: 110, f1: 60, dur: 0.4, vol: 0.3 }),
  wave:    () => notes([440, 554, 659], 0.07, { type: "triangle", dur: 0.12, vol: 0.18 }),
  build:   () => tone({ type: "square", f0: 300, f1: 600, dur: 0.06, vol: 0.12 }),
  up:      () => notes([523, 784, 1046], 0.06, { type: "triangle", dur: 0.1, vol: 0.18 }),
  sell:    () => notes([523, 330], 0.06, { type: "triangle", dur: 0.1, vol: 0.15 }),
  life:    () => notes([659, 880, 1318], 0.08, { dur: 0.16, vol: 0.18 }),
  over:    () => notes([392, 330, 262, 196], 0.18, { type: "triangle", dur: 0.32, vol: 0.25 }),
};
// minimum seconds between two plays of the same sound
const GAP = { rapid: 0.06, chain: 0.07, kill: 0.04, slower: 0.1, leak: 0.15 };

// returns whatever the sound returns (a stop() handle for long sounds), or null
function sfx(name, ...args) {
  if (muted || !AC || AC.state !== "running" || voices > MAX_VOICES || !SFX[name]) return null;
  const now = AC.currentTime;
  if (now - (lastAt[name] ?? -1) < (GAP[name] ?? 0.03)) return null;
  lastAt[name] = now;
  return SFX[name](...args) || null;
}
