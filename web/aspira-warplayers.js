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
    if (key !== warp.statKey || now - (warp.statAt || 0) >= WARP_STAT_MS) { // THE BOARD, now and then, on the main canvas
      warp.statKey = key; warp.statAt = now; warp.statNew = true;
      ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy); ctx.save(); drawSceneBase(); ctx.restore();
    }
    warp.texCam = { ...cam };
    const D = Math.max(64, Math.round(S * WARP_DYN_K)), d = warp.dynCv ||= document.createElement("canvas");
    if (d.width !== D || d.height !== D) { d.width = D; d.height = D; }
    ctx = warp.dynCtx ||= d.getContext("2d");
    warpTexCamFor(D); // the same board, D px across: the layers line up in the shader's 0..1
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, D, D);
    ctx.lineJoin = "round"; ctx.lineCap = "round"; // (as drawLanes leaves them for what follows, in 2D)
    ctx.setTransform(cam.k, 0, 0, cam.k, cam.ox, cam.oy); ctx.save(); drawSceneTop(); ctx.restore();
  } finally { ctx = main; Object.assign(cam, view); }
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
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // premultiplied, so its soft edges filter without a dark fringe
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, warp.dynCv);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, typeof fxGl !== "undefined" && fxGl.tex ? fxGl.tex : warp.dynTex); // the hits (aspira-fxgl.js)
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(u("tex"), 0); gl.uniform1i(u("dyn"), 1); gl.uniform1i(u("fxt"), 2);
}
