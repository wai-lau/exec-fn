// The seal: a 5x5 character face, deterministic from a public key.
//
// fp = SHA-256(raw 32-byte public key). Bytes 0-15 pick the 16 border cells
// from the 32 ASCII punctuation marks (256/32 = 8, so no modulo bias); byte 16
// picks a matched eye pair (16 of them), byte 17 a mouth (8). Interior:
//   row 1: blank blank blank
//   row 2: eye   blank eye
//   row 3: blank mouth blank
// Rendered with a space between cells so the grid reads square.
//
// EVERY glyph here is single-width in the monospace face: each non-ASCII one
// is in web/fonts/noodle-seal.woff2 (advance == 'M', checked by
// tests/test_noodle_glyphs.py) -- no emoji, no variation selectors.
//
// ONE implementation: the vote page and the results page both render seals
// here, so a seal can never differ between the two.

var ND_BORDER = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
var ND_EYES = [
  ['^', '^'], ['°', '°'], ['>', '<'], ['·', '·'],
  ['•', '•'], ['◕', '◕'], ['ᵔ', 'ᵔ'], ['◉', '◉'],
  ['⊙', '⊙'], ['o', 'o'], ['x', 'x'], ['T', 'T'],
  ['=', '='], ['*', '*'], ['ʘ', 'ʘ'], ['ˆ', 'ˆ'],
];
var ND_MOUTHS = ['ω', '▽', '_', '‿', 'ᴗ', '∀', 'ᵕ', 'д'];

function ndSealFromFp(fp) {
  var b = [];
  for (var i = 0; i < 16; i++) b.push(ND_BORDER[fp[i] % 32]);
  var eye = ND_EYES[fp[16] % ND_EYES.length];
  var mouth = ND_MOUTHS[fp[17] % ND_MOUTHS.length];
  var rows = [
    [b[0], b[1], b[2], b[3], b[4]],
    [b[5], ' ', ' ', ' ', b[6]],
    [b[7], eye[0], ' ', eye[1], b[8]],
    [b[9], ' ', mouth, ' ', b[10]],
    [b[11], b[12], b[13], b[14], b[15]],
  ];
  return rows.map(function (r) { return r.join(' '); }).join('\n');
}

function ndB64ToBytes(s) {
  var bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// pub: base64 raw public key -> Promise<string> (the 5-line seal)
async function ndSeal(pub) {
  if (!pub) return '';
  var fp = new Uint8Array(await crypto.subtle.digest('SHA-256', ndB64ToBytes(pub)));
  return ndSealFromFp(fp);
}

// Press down, settle, land at a slight random angle and offset, like wax.
// The final pose is a CSS var so each stamping lands a little differently.
function ndStamp(el, text) {
  el.textContent = text;
  el.style.setProperty('--seal-rot', ((Math.random() * 8) - 4).toFixed(1) + 'deg');
  el.style.setProperty('--seal-dx', ((Math.random() * 4) - 2).toFixed(1) + 'px');
  el.style.setProperty('--seal-dy', ((Math.random() * 4) - 2).toFixed(1) + 'px');
  el.classList.remove('stamp');
  void el.offsetWidth; // restart the animation
  el.classList.add('stamp');
}

var NoodleSeal = { fromFp: ndSealFromFp, seal: ndSeal, stamp: ndStamp,
  b64ToBytes: ndB64ToBytes, EYES: ND_EYES, MOUTHS: ND_MOUTHS, BORDER: ND_BORDER };
if (typeof window !== 'undefined') window.NoodleSeal = NoodleSeal;
