/* Pasted images on /cc: downscale on the way in, thumbnails above the composer,
 * and the rendered row in the transcript.
 *
 * Split out of cc.js at the 500-line cap. Loaded BEFORE it, same global scope,
 * so these read `pending` and call syncInputH() by bare name -- both live in
 * cc.js and are only ever touched from a user action, long after it has run.
 */
'use strict';

/** Downscale a pasted image before it ever leaves the browser.
 *
 * Claude downsamples anything over ~1568px anyway, so full-resolution upload
 * buys nothing and costs everything: a raw phone photo is 3-4MB crossing a
 * 1967MB box that has already been OOM-killed once tonight. Resized, the same
 * photo arrives ~200KB. JPEG unless the source has alpha worth keeping. */
function shrink(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1568;
      let { width: w, height: h } = img;
      const scale = Math.min(1, MAX / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const png = file.type === 'image/png' || file.type === 'image/gif';
      const mt = png ? 'image/png' : 'image/jpeg';
      const dataUrl = cv.toDataURL(mt, 0.85);
      resolve({ media_type: mt, data: dataUrl.split(',')[1], url: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function thumbStrip() {
  let el = document.getElementById('cc-thumbs');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cc-thumbs';
    document.getElementById('input-bar').prepend(el);
  }
  el.innerHTML = '';
  pending.forEach((im, i) => {
    const w = document.createElement('span');
    w.className = 'cc-thumb';
    const g = document.createElement('img');
    g.src = im.url; g.alt = 'pasted image';
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '×'; x.title = 'remove';
    x.addEventListener('click', () => { pending.splice(i, 1); thumbStrip(); syncInputH(); });
    w.appendChild(g); w.appendChild(x);
    el.appendChild(w);
  });
  el.hidden = !pending.length;
  syncInputH();
}

function addImages(div, images) {
  if (!images || !images.length) return;
  const row = document.createElement('div');
  row.className = 'cc-imgs';
  for (const im of images) {
    const g = document.createElement('img');
    g.src = im.url || `data:${im.media_type};base64,${im.data}`;
    g.alt = 'image';
    row.appendChild(g);
  }
  div.appendChild(row);
}
