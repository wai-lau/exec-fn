// The seal: a 5-wide, 6-tall character face, deterministic from a public key.
//
// fp = SHA-256(raw 32-byte public key). Bytes 0-17 pick the 18 border cells
// from the 32 ASCII punctuation marks (256/32 = 8, so no modulo bias); byte 18
// picks a matched eye pair (16 of them), byte 19 a mouth (8), bytes 20-23 the
// ink. Interior:
//   row 1: blank blank blank
//   row 2: eye   blank eye
//   row 3: blank mouth blank
//   row 4: blank blank blank
// Rendered with a space between cells.
//
// EVERY glyph here is single-width in the monospace face: each non-ASCII one
// is in web/fonts/noodle-seal.woff2 (advance == 'M', checked by
// tests/test_noodle_glyphs.py) -- no emoji, no variation selectors.
//
// ONE implementation: the voter's own seal and every seal in the roster are
// rendered here, so a seal can never differ between the two.

var ND_BORDER = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
var ND_EYES = [
  ['^', '^'], ['°', '°'], ['>', '<'], ['·', '·'],
  ['•', '•'], ['◕', '◕'], ['ᵔ', 'ᵔ'], ['◉', '◉'],
  ['⊙', '⊙'], ['o', 'o'], ['x', 'x'], ['T', 'T'],
  ['=', '='], ['*', '*'], ['ʘ', 'ʘ'], ['ˆ', 'ˆ'],
];
var ND_MOUTHS = ['ω', '▽', '_', '‿', 'ᴗ', '∀', 'ᵕ', 'д'];

// The ink is NOT a palette colour: any hue at all, from the key. Only the
// lightness has a floor, so every seal stays readable on the black page (at
// 62% even pure blue reads clearly; hue alone decides nothing about
// brightness, so the floor is on lightness, not hue). The value is the
// channel triple the page-local --seal-hsl token takes (noodle.css).
var ND_INK_L = [62, 82];   // lightness %, min..max
var ND_INK_S = [60, 100];  // saturation %, min..max

function ndInk(fp) {
  var hue = ((fp[20] << 8) | fp[21]) % 360;
  var sat = ND_INK_S[0] + fp[22] % (ND_INK_S[1] - ND_INK_S[0] + 1);
  var light = ND_INK_L[0] + fp[23] % (ND_INK_L[1] - ND_INK_L[0] + 1);
  return hue + ' ' + sat + '% ' + light + '%';
}

// -> {text, ink}
function ndSealFromFp(fp) {
  var b = [];
  for (var i = 0; i < 18; i++) b.push(ND_BORDER[fp[i] % 32]);
  var eye = ND_EYES[fp[18] % ND_EYES.length];
  var mouth = ND_MOUTHS[fp[19] % ND_MOUTHS.length];
  var F = function (c) { return { face: c }; };   // eyes + mouth: drawn bold
  var rows = [
    [b[0], b[1], b[2], b[3], b[4]],
    [b[5], ' ', ' ', ' ', b[6]],
    [b[7], F(eye[0]), ' ', F(eye[1]), b[8]],
    [b[9], ' ', F(mouth), ' ', b[10]],
    [b[11], ' ', ' ', ' ', b[12]],
    [b[13], b[14], b[15], b[16], b[17]],
  ];
  var esc = function (c) { return c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  return {
    text: rows.map(function (r) {
      return r.map(function (c) { return c.face || c; }).join(' ');
    }).join('\n'),
    // the same grid as markup, the face in <b>: the border stays regular
    html: rows.map(function (r) {
      return r.map(function (c) { return c.face ? '<b>' + esc(c.face) + '</b>' : esc(c); }).join(' ');
    }).join('\n'),
    ink: ndInk(fp),
  };
}

// Put a seal on an element: its text and its ink.
function ndPaint(el, seal) {
  el.innerHTML = seal ? seal.html : '';   // our own escaped markup (ndSealFromFp)
  if (seal) el.style.setProperty('--seal-hsl', seal.ink);
  else el.style.removeProperty('--seal-hsl');
  el.classList.toggle('inked', !!seal);
}

function ndB64ToBytes(s) {
  var bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// pub: base64 raw public key -> Promise<{text, hue}|null>
async function ndSeal(pub) {
  if (!pub) return null;
  var fp = new Uint8Array(await crypto.subtle.digest('SHA-256', ndB64ToBytes(pub)));
  return ndSealFromFp(fp);
}

// Press down, settle, land at a slight random angle and offset, like wax.
// The final pose is a CSS var so each stamping lands a little differently.
function ndStamp(el, seal) {
  ndPaint(el, seal);
  el.style.setProperty('--seal-rot', ((Math.random() * 8) - 4).toFixed(1) + 'deg');
  el.style.setProperty('--seal-dx', ((Math.random() * 4) - 2).toFixed(1) + 'px');
  el.style.setProperty('--seal-dy', ((Math.random() * 4) - 2).toFixed(1) + 'px');
  el.classList.remove('stamp');
  void el.offsetWidth; // restart the animation
  el.classList.add('stamp');
}

var NoodleSeal = { fromFp: ndSealFromFp, seal: ndSeal, stamp: ndStamp, paint: ndPaint,
  b64ToBytes: ndB64ToBytes, EYES: ND_EYES, MOUTHS: ND_MOUTHS, BORDER: ND_BORDER };
if (typeof window !== 'undefined') window.NoodleSeal = NoodleSeal;
