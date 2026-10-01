/* Attachments in the Exec panel: what Wai pastes or drops on it.
 *
 * Two kinds. A PICTURE is downscaled in the browser and rides in the prompt as
 * an image block. ANY OTHER FILE (a PDF, a CSV, a text file) is sent as bare
 * base64 and written into the agent's sandbox by the sidecar
 * (claude-box/uploads.mjs), which appends `[attached: uploads/...]` to the
 * message so the agent opens it with Read. Both wait above the composer as a
 * thumbnail or a named chip until the message is sent.
 *
 * Shared global scope; reads and writes `execPending` (exec-term.js).
 */
'use strict';

const EXEC_MAX_ATTACH = 4;
// Raw bytes; base64 is 4/3 of this, under the container's 6MB per-file cap.
const EXEC_MAX_FILE_BYTES = 4.5 * 1024 * 1024;

/** Downscale a pasted image before it ever leaves the browser.
 *
 * Claude downsamples anything over ~1568px anyway, so full-resolution upload
 * buys nothing and costs everything: a raw phone photo is 3-4MB crossing a
 * 1967MB box. Resized, the same photo arrives ~200KB. JPEG unless the source
 * has alpha worth keeping. */
function execShrink(file) {
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

/** A non-image file as {file: true, name, data}. */
function execReadFile(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve({ file: true, name: file.name, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

const EXEC_RASTER = /^image\/(png|jpeg|gif|webp)$/;

/** Queue dropped or pasted files above the composer. A picture is shrunk; a
 *  file too big to send says so instead of vanishing. */
async function execAttach(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (execPending.length >= EXEC_MAX_ATTACH) {
      execAddMsg('sys warn', '[ at most ' + EXEC_MAX_ATTACH + ' attachments per message ]');
      break;
    }
    const pic = EXEC_RASTER.test(f.type);
    if (!pic && f.size > EXEC_MAX_FILE_BYTES) {
      execAddMsg('sys warn', '[ too big to send: ' + f.name + ' ]');
      continue;
    }
    const item = pic ? await execShrink(f) : await execReadFile(f);
    if (item) execPending.push(item);
  }
  execThumbStrip();
}

function execThumbStrip() {
  let el = document.getElementById('exec-thumbs');
  if (!el) {
    el = document.createElement('div');
    el.id = 'exec-thumbs';
    document.getElementById('exec-input-area').prepend(el);
  }
  el.innerHTML = '';
  execPending.forEach((it, i) => {
    const w = document.createElement('span');
    w.className = it.file ? 'exec-thumb exec-thumb-file' : 'exec-thumb';
    if (it.file) {
      w.textContent = it.name;
    } else {
      const g = document.createElement('img');
      g.src = it.url; g.alt = 'pasted image';
      w.appendChild(g);
    }
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '×'; x.title = 'remove';
    x.addEventListener('click', () => { execPending.splice(i, 1); execThumbStrip(); });
    w.appendChild(x);
    el.appendChild(w);
  });
  el.hidden = !execPending.length;
}

function execAddImages(div, images) {
  if (!images || !images.length) return;
  const row = document.createElement('div');
  row.className = 'exec-imgs';
  for (const im of images) {
    const g = document.createElement('img');
    g.src = im.url || `data:${im.media_type};base64,${im.data}`;
    g.alt = 'image';
    row.appendChild(g);
  }
  div.appendChild(row);
}

/** The sidecar's `[attached: uploads/<stamp>-name, ...]` tail (uploads.mjs
 *  uploadNote), split off a user message: {text, names}. The stamp prefix is
 *  the sidecar's, not the file's, so the chip shows the name Wai dropped. */
const EXEC_ATTACHED_RE = /\s*\[attached: ([^\]]+)\]\s*$/;
function execSplitAttached(text) {
  const m = text.match(EXEC_ATTACHED_RE);
  if (!m) return { text: text, names: [] };
  const names = m[1].split(/,\s*/).map((p) => p.replace(/^uploads\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-)?/, ''));
  return { text: text.slice(0, m.index), names: names };
}

/** Named chips under a user message, one per attached file. */
function execAddFileChips(div, names) {
  if (!names || !names.length) return;
  const row = document.createElement('div');
  row.className = 'exec-files';
  for (const n of names) {
    const c = document.createElement('span');
    c.className = 'exec-file';
    c.textContent = n;
    row.appendChild(c);
  }
  div.appendChild(row);
}
