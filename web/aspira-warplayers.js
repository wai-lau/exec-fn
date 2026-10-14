// /aspira - THE 3D PICTURE IN TWO LAYERS (owner, 2026-10-13: "do the rework" - the iPhone spent ~28 of a 32 ms frame
// sending the whole 2D board up to the GPU, every frame, for the bell's texture). Split from aspira-warp.js at its cap.
// The BOARD (background, graticule, lanes and their labels - drawSceneBase) changes slowly: it is redrawn and sent up at
// most every WARP_STAT_MS. What MOVES (beams, shots, ranges, coins, goo, threats - drawSceneTop) is drawn every frame
// on a layer of its own at WARP_DYN_K of the picture's size a side, and the bell's shader lays it over the board
// (WARP_FS). The screen shake rides on the shader's texCam (warpDraw), so both layers shake together.
const WARP_STAT_MS = 150;
let WARP_DYN_K = 0.5; // let: the moving layer's share of the picture's size, a side (a quarter of the pixels to send)
// the picture's camera for a square of S px: the whole board (WARP_TEX_R world units round the core) in it
function warpTexCamFor(S) {
  const k = S / (2 * WARP_TEX_R);
  Object.assign(cam, { k, ox: S / 2 - CX * k, oy: S / 2 - CY * k });
}
function warpRender() {
  // SHARP (owner: "all these are so blurry, make them sharp"): the picture is a SQUARE as fine as the view's own scale
  // (capped at WARP_TEX_MAX px), not the screen-sized canvas squeezed to fit the board - that was ~3x coarser than the view
  const S = Math.min(WARP_TEX_MAX, Math.round(warpTexCap / 64) * 64, Math.ceil(2 * WARP_TEX_R * cam.k)); // warpTexCap follows the frame rate (aspira-quality.js), stepped by 64 so it is not resized every frame
  const view = { ...cam }, main = ctx, now = performance.now();
  try {
    warpTexCamFor(S);
    bossSkyStep(); // the sky's state: phase, radius, full (aspira-bosses.js) - render()'s first step in 2D
    warp.shake = shakeOffset();
    const key = [S, COL.bg].join();
    if (cv.width !== S || cv.height !== S) { cv.width = S; cv.height = S; warp.statKey = ""; } // (resize() sets it back for 2D)
    // THE BOARD on the main canvas: at once for a new size or palette, else only when what it shows has changed (the lit
    // lanes, their brightness, the wave's labels - warpBoardSig), at most every WARP_STAT_MS (a still board is never resent)
    const sig = warpBoardSig(now);
    if (key !== warp.statKey || (sig !== warp.statSig && now - (warp.statAt || 0) >= WARP_STAT_MS)) {
      warp.statKey = key; warp.statSig = sig; warp.statAt = now; warp.statNew = true;
      ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy); ctx.save(); drawSceneBase(); ctx.restore();
    }
    warp.texCam = { ...cam };
    const D = Math.max(64, Math.round(S * WARP_DYN_K)), d = warp.dynCv ||= document.createElement("canvas");
    if (d.width !== D || d.height !== D) { d.width = D; d.height = D; }
    const real = warp.dynCtx ||= d.getContext("2d");
    warpTexCamFor(D); // the same board, D px across: the layers line up in the shader's 0..1
    // the stand-in context (aspira-glctx.js): what the GPU batch can draw goes there; the canvas gets the rest, and is cleared
    // and sent up only when it held something this frame or the last (warp.dynUp, warpLayersBind)
    const k = cam.k, ox = cam.ox, oy = cam.oy, toWorld = Object.assign((x, y) => [(x - ox) / k, (y - oy) / k], { k });
    const g = typeof glCtx === "function" && fxGlTake() ? glCtx(real, toWorld) : null;
    if (warp.dynDirty || !g) { real.setTransform(1, 0, 0, 1, 0, 0); real.clearRect(0, 0, D, D); }
    ctx = g || real;
    real.lineJoin = "round"; real.lineCap = "round"; // (as drawLanes leaves them for what follows, in 2D)
    ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy); ctx.save(); drawSceneTop(); ctx.restore();
    warp.dynUp = !g || g.used || warp.dynDirty; warp.dynDirty = !g || g.used;
  } finally { ctx = main; Object.assign(cam, view); }
}
// what the board layer shows, as a string: the lanes lit (each one's lane, turn, colour, wave and brightness to 1/LIT_STEPS -
// as aspira-lanes.js keys its own layers), the wave (the idle labels), the boss sky's phase; while a lane is still fading in,
// the time too, so the fade is drawn
function warpBoardSig(now) {
  const live = typeof litLanes === "function" ? litLanes() : [];
  let fading = false;
  const lanes = live.map(u => {
    const t0 = laneSeen.get(u.pi + ":" + u.ang);
    if (!u.star && (t0 === undefined || now - t0 < LANE_FADE_IN_MS)) fading = true;
    return u.pi + ":" + u.ang.toFixed(3) + ":" + u.color + ":" + u.n + ":" + Math.round(u.a * LIT_STEPS);
  }).join(",");
  return G.wave + "|" + bossInv.phase + "|" + lanes + (fading ? "|" + Math.floor(now / WARP_STAT_MS) : "");
}
// both layers onto their texture units for the bell (warpDraw): the board sent up only when it was redrawn
function warpLayersBind(gl, u) {
  if (!warp.dynTex) {
    warp.dynTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, warp.dynTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, warp.tex);
  if (warp.statNew || warp.statUp !== warp.tex) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); warp.statNew = false; warp.statUp = warp.tex; }
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, warp.dynTex);
  if (warp.dynUp !== false || warp.dynSize !== warp.dynCv.width) { // only when the canvas held something (warpRender)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // premultiplied, so its soft edges filter without a dark fringe
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, warp.dynCv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); warp.dynSize = warp.dynCv.width;
  }
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, typeof fxGl !== "undefined" && fxGl.tex ? fxGl.tex : warp.dynTex); // the hits (aspira-fxgl.js)
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(u("tex"), 0); gl.uniform1i(u("dyn"), 1); gl.uniform1i(u("fxt"), 2);
  hullUniforms(gl, u, warp.cv.height); // the towers' outlines: no beam under one (aspira-fog.js)
}
