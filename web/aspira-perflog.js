// /spire SLOW LOGS (owner, 2026-10-12: "this is just my partner's brave - can we make it so that each session takes slowlogs
// and sends them back to the server every 3 min of play?"): every frame's real time is tallied (aspira-ui.js frame calls
// perfTick), with the quality, the board's size and the AUDIO's state - whether it unlocked, how many samples loaded, and how
// many sounds were asked for against how many played - and every PERF_SEND_S seconds of PLAY (unpaused, the tab showing)
// one summary goes to /api/spire/perflog (api/spire_perflog.py, a temp folder on the server). Never in the way of the game:
// every failure is swallowed.
const PERF_SEND_S = 180, PERF_BUCKETS = [16.7, 33, 50, 100, Infinity];
const perfSid = Math.random().toString(36).slice(2, 10);
let perf = null;
const perfReset = () => { perf = { secs: 0, frames: 0, sum: 0, buckets: PERF_BUCKETS.map(() => 0), worst: [], maxEnemies: 0, sfxCalls: 0, sfxPlayed: 0, simMs: 0, drawMs: 0, warpMs: 0, glMs: 0, entMs: 0, speed: 0, picMs: 0, fxMs: 0, bindMs: 0, fxN: 0, fxMax: 0, upBoard: 0, upDyn: 0 }; };
perfReset();
// the sound calls counted on their way through (sfx is a global function: every caller looks it up by name)
if (typeof sfx === "function") { const sfx0 = sfx; sfx = function (...a) { perf.sfxCalls++; const r = sfx0.apply(this, a); if (r) perf.sfxPlayed++; return r; }; }
// WHERE a frame's time goes (2026-10-12: her frames split fast / 50-100 ms): the simulation (step), the 2D picture (render) and
// the 3D pass (warp3d), summed by wrapping the globals - every caller looks them up by name
const perfWrap = (name, key) => { if (typeof window[name] !== "function") return; const f0 = window[name]; window[name] = function (...a) { const t0 = performance.now(); try { return f0.apply(this, a); } finally { perf[key] += performance.now() - t0; } }; };
perfWrap("step", "simMs"); perfWrap("render", "drawMs"); perfWrap("warp3d", "warpMs");
// ...and INSIDE the 3D pass (perf, 2026-10-13: an iPhone spent 19.6 of its 23.5 ms there with the picture itself 0.5): the GL draw with
// the picture's upload (warpDraw, which INCLUDES the next) and the flat towers / dice / enemies layer (warpEntities)
perfWrap("warpDraw", "glMs"); perfWrap("warpEntities", "entMs");
// ...and inside THAT (2026-10-14: the new build still spent ~20 ms of an iPhone's frame in warpDraw): the board picture drawn
// (warpRender), the effects batch (fxGlRender - its shapes counted), the two layers sent up (warpLayersBind - how often each).
// A GPU that cannot keep up makes the call that waits on it slow, so these say WHERE, not only how long
perfWrap("warpRender", "picMs"); perfWrap("warpLayersBind", "bindMs");
if (typeof fxGlRender === "function") { const f0 = fxGlRender; fxGlRender = function (...a) { const n = typeof fxGl !== "undefined" ? fxGl.n : 0; perf.fxN += n; perf.fxMax = Math.max(perf.fxMax, n); const t0 = performance.now(); try { return f0.apply(this, a); } finally { perf.fxMs += performance.now() - t0; } }; }
if (typeof warpLayersBind === "function") { const b0 = warpLayersBind; warpLayersBind = function (...a) { if (typeof warp !== "undefined") { if (warp.statNew) perf.upBoard++; if (warp.dynUp) perf.upDyn++; } return b0.apply(this, a); }; }
function perfTick(dt) {
  if (!(dt > 0) || dt > 1 || ui.paused || document.hidden) return; // a stall or a tab switch is not a frame
  const ms = dt * 1000;
  perf.secs += dt; perf.frames++; perf.sum += ms;
  perf.buckets[PERF_BUCKETS.findIndex(b => ms < b)]++;
  if (perf.worst.length < 5 || ms > perf.worst[4]) { perf.worst.push(Math.round(ms)); perf.worst.sort((a, b) => b - a); perf.worst.length = Math.min(5, perf.worst.length); }
  perf.maxEnemies = Math.max(perf.maxEnemies, G.enemies.length); perf.speed += typeof speedX === "function" ? speedX() : 1;
  if (perf.secs >= PERF_SEND_S) perfSend();
}
// which GPU the browser hands WebGL - read once (the 3D view's own context if it has one, else a throwaway one)
let perfGpuName = null;
function perfGpu() {
  if (perfGpuName) return perfGpuName;
  try {
    const gl = (typeof warp !== "undefined" && warp.gl) || document.createElement("canvas").getContext("webgl"), x = gl && gl.getExtension("WEBGL_debug_renderer_info");
    perfGpuName = !gl ? "no webgl" : x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch (e) { perfGpuName = "?"; }
  return perfGpuName;
}
// the 3D pass's parts a frame (ms), the effects batch's shapes (mean, most), and the share of frames that sent each layer up
function perfSplit() {
  const n = Math.max(1, perf.frames), r = v => +(v / n).toFixed(1);
  return { picMs: r(perf.picMs), fxMs: r(perf.fxMs), bindMs: r(perf.bindMs), fxN: Math.round(perf.fxN / n), fxMax: perf.fxMax, upBoard: +(perf.upBoard / n).toFixed(2), upDyn: +(perf.upDyn / n).toFixed(2), tex: typeof cv !== "undefined" ? cv.width : null, fxTex: typeof fxGl !== "undefined" && fxGl.S ? fxGl.S : null };
}
function perfSend() {
  const ver = document.querySelector(".asp-ver span");
  const body = {
    sid: perfSid, v: ver ? ver.textContent : "?", secs: Math.round(perf.secs), frames: perf.frames, avgMs: +(perf.sum / Math.max(1, perf.frames)).toFixed(1),
    buckets: Object.fromEntries(PERF_BUCKETS.map((b, i) => ["<" + b, perf.buckets[i]])), worst: perf.worst, maxEnemies: perf.maxEnemies,
    gpuSplit: perfSplit(), perFrame: { simMs: +(perf.simMs / Math.max(1, perf.frames)).toFixed(1), drawMs: +(perf.drawMs / Math.max(1, perf.frames)).toFixed(1), warpMs: +(perf.warpMs / Math.max(1, perf.frames)).toFixed(1), glMs: +(perf.glMs / Math.max(1, perf.frames)).toFixed(1), entMs: +(perf.entMs / Math.max(1, perf.frames)).toFixed(1), speed: +(perf.speed / Math.max(1, perf.frames)).toFixed(2) }, // (3D: drawMs is inside warpMs)
    detailR: typeof detailFarR !== "undefined" ? Math.round(detailFarR) : null, texCap: typeof warpTexCap !== "undefined" ? Math.round(warpTexCap) : null, warpRes: typeof WARP_RES !== "undefined" ? +WARP_RES.toFixed(2) : null, // 3D's full-detail radius at send time
    quality: qMode, autoQ: typeof autoQ !== "undefined" ? Math.round(autoQ.ema) : null, qpick: (() => { try { return localStorage.getItem("spire.qpick"); } catch (e) { return "?"; } })(), stepped: typeof autoQSteps !== "undefined" ? autoQSteps : null, wave: G.wave, brave: !!navigator.brave,
    screen: [innerWidth, innerHeight, devicePixelRatio], canvas: [cv.width, cv.height],
    gpu: perfGpu(), // the WebGL renderer ("SwiftShader" / "llvmpipe" = software, no GPU)
    audio: { ac: typeof AC !== "undefined" && AC ? AC.state : null, samples: typeof SAMPLES !== "undefined" ? Object.values(SAMPLES).filter(s => s.length).length : null, calls: perf.sfxCalls, played: perf.sfxPlayed, muted: typeof muted !== "undefined" ? muted : null, volume: typeof volume !== "undefined" ? volume : null },
  };
  perfReset();
  try { fetch("/api/spire/perflog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch (e) { /* never in the way */ }
}
