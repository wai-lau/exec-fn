/* /zombo — the intro's sound, synthesised rather than shipped.
 *
 * The original is a looping trance bed under a slow, deep voiceover. Both are
 * built here in the browser: WebAudio for the bed (glide pad + sub + kick + hat
 * + pentatonic arp on a lookahead scheduler) and speechSynthesis for the voice.
 * No audio file, so nothing to cache-bust and nothing to host.
 *
 * Same global scope as zombo.js, which owns the caption and calls in here.
 */

var zbCtx = null;
var zbBus = null;          // master gain, faded rather than hard-stopped
var zbPad = [];            // the three glide oscillators
var zbNoise = null;        // one shared white-noise buffer for the hat
var zbBeat = 0;            // beats emitted since start
var zbNext = 0;            // context time of the next unscheduled beat
var zbPump = null;         // scheduler interval id
var zbVoice = null;

var ZB_BPM = 100;
var ZB_SPB = 60 / ZB_BPM;
/* Am → F → C → G, eight beats each: the four-chord loop the bed walks. */
var ZB_CHORDS = [[110, 130.81, 164.81], [87.31, 110, 130.81],
                 [130.81, 164.81, 196], [98, 123.47, 146.83]];
var ZB_ARP = [440, 523.25, 659.25, 587.33, 523.25, 783.99, 659.25, 523.25];

function zbEnv(node, t, peak, attack, decay) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function zbNoiseBuf() {
  var n = Math.floor(zbCtx.sampleRate * 0.4);
  var buf = zbCtx.createBuffer(1, n, zbCtx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/* Three detuned saws through a slowly swept lowpass: the whole bed's body. */
function zbBuildPad() {
  var filt = zbCtx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 520;
  filt.Q.value = 6;
  var lfo = zbCtx.createOscillator();
  var lfoGain = zbCtx.createGain();
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 320;
  lfo.connect(lfoGain).connect(filt.frequency);
  lfo.start();
  var gain = zbCtx.createGain();
  gain.gain.value = 0.05;
  filt.connect(gain).connect(zbBus);
  ZB_CHORDS[0].forEach(function (f, i) {
    var o = zbCtx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = (i - 1) * 7;
    o.connect(filt);
    o.start();
    zbPad.push(o);
  });
  var sub = zbCtx.createOscillator();
  var subGain = zbCtx.createGain();
  sub.type = 'sine';
  sub.frequency.value = 55;
  subGain.gain.value = 0.06;
  sub.connect(subGain).connect(zbBus);
  sub.start();
  zbPad.push(sub);
}

function zbKick(t) {
  var o = zbCtx.createOscillator();
  var g = zbCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
  zbEnv(g, t, 0.5, 0.004, 0.16);
  o.connect(g).connect(zbBus);
  o.start(t);
  o.stop(t + 0.3);
}

function zbHat(t) {
  var s = zbCtx.createBufferSource();
  var hp = zbCtx.createBiquadFilter();
  var g = zbCtx.createGain();
  s.buffer = zbNoise;
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  zbEnv(g, t, 0.05, 0.002, 0.04);
  s.connect(hp).connect(g).connect(zbBus);
  s.start(t);
  s.stop(t + 0.1);
}

function zbPluck(t, freq) {
  var o = zbCtx.createOscillator();
  var g = zbCtx.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  zbEnv(g, t, 0.075, 0.01, 0.42);
  o.connect(g).connect(zbBus);
  o.start(t);
  o.stop(t + 0.6);
}

/* One beat: kick on every beat, hat on the off, arp on both eighths, and a
 * glide to the next chord whenever the eight-beat bar turns over. */
function zbEmit(beat, t) {
  zbKick(t);
  zbHat(t + ZB_SPB / 2);
  zbPluck(t, ZB_ARP[beat * 2 % ZB_ARP.length]);
  zbPluck(t + ZB_SPB / 2, ZB_ARP[(beat * 2 + 1) % ZB_ARP.length]);
  if (beat % 8) return;
  var chord = ZB_CHORDS[(beat / 8) % ZB_CHORDS.length];
  chord.forEach(function (f, i) {
    zbPad[i].frequency.setTargetAtTime(f, t, 0.35);
  });
}

/* Lookahead scheduler: a setInterval can't be trusted to land on a beat, so it
 * only ever hands the audio clock the beats falling inside the next 150ms. */
function zbTick() {
  if (!zbCtx) return;
  while (zbNext < zbCtx.currentTime + 0.15) {
    zbEmit(zbBeat, zbNext);
    zbBeat++;
    zbNext += ZB_SPB;
  }
}

function zbAudioStart() {
  try {
    if (!zbCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      zbCtx = new Ctor();
      zbBus = zbCtx.createGain();
      zbBus.gain.value = 0;
      zbBus.connect(zbCtx.destination);
      zbNoise = zbNoiseBuf();
      zbBuildPad();
      zbNext = zbCtx.currentTime + 0.1;
    }
    if (zbCtx.state === 'suspended') zbCtx.resume();
    zbBus.gain.cancelScheduledValues(zbCtx.currentTime);
    zbBus.gain.setTargetAtTime(0.9, zbCtx.currentTime, 0.6);
    if (!zbPump) zbPump = window.setInterval(zbTick, 25);
    return true;
  } catch (_e) {
    return false;
  }
}

function zbAudioStop() {
  if (zbPump) { window.clearInterval(zbPump); zbPump = null; }
  if (zbBus) zbBus.gain.setTargetAtTime(0.0001, zbCtx.currentTime, 0.25);
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/* Deep, slow, and English: the closest a stock voice gets to the original. */
function zbPickVoice() {
  if (zbVoice || !window.speechSynthesis) return zbVoice;
  var all = window.speechSynthesis.getVoices() || [];
  var en = all.filter(function (v) { return /^en/i.test(v.lang); });
  var named = en.filter(function (v) {
    return /daniel|alex|fred|google uk english male|male/i.test(v.name);
  });
  zbVoice = named[0] || en[0] || all[0] || null;
  return zbVoice;
}

/* `done` must fire exactly once. Safari drops `onend` often enough that the
 * caption would stall forever on it, so a length-estimated timeout races it
 * and whichever lands first wins. */
function zbSpeak(text, done) {
  var fired = false;
  function finish() {
    if (fired) return;
    fired = true;
    done();
  }
  var est = 900 + text.length * 95;
  window.setTimeout(finish, est + 2500);
  if (!window.speechSynthesis) {
    window.setTimeout(finish, est);
    return;
  }
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    var v = zbPickVoice();
    if (v) u.voice = v;
    u.rate = 0.72;
    u.pitch = 0.55;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  } catch (_e) {
    window.setTimeout(finish, est);
  }
}

if (window.speechSynthesis) {
  window.speechSynthesis.addEventListener('voiceschanged', function () {
    zbVoice = null;
    zbPickVoice();
  });
}
