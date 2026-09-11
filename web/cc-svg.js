/* /cc — render the SVG diagrams Claude writes, safely.
 *
 * Claude cannot produce raster images, but it writes clean SVG, so a ```svg
 * fenced block is the one way a picture can come BACK from the model. This file
 * turns those blocks into rendered diagrams.
 *
 * Loaded before cc.js and shares its global scope (the hq-*.js / tarot-*.js
 * idiom) — cc.js was already at 468 of the 500-line cap.
 *
 * THE SANITISER IS NOT OPTIONAL. The markdown path uses innerHTML, so raw SVG
 * would execute: <script> runs, on* handlers fire, <foreignObject> smuggles in
 * arbitrary HTML, and an external href both leaks that the page was opened and
 * gives an attacker a fetch. "The model wrote it" is not a safety argument —
 * model output is steered by whatever Wai pastes in, including text inside a
 * screenshot. So this is an ALLOWLIST: anything not named here is dropped,
 * which fails closed when the SVG spec grows a new element. */

const CC_SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'marker', 'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'filter',
  'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feBlend',
  'feColorMatrix', 'feFlood', 'feComposite',
]);

// Deliberately absent: script, foreignObject (arbitrary HTML), image and a
// (external fetch / navigation), animate* (not needed for a diagram).

const CC_SVG_MAX_BYTES = 256 * 1024;
const CC_SVG_MAX_NODES = 3000;

function ccSvgCleanAttrs(el) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
    // Internal refs (#marker, #gradient) are how markers and gradients work at
    // all; anything else is a fetch or a navigation.
    if (name === 'href' || name === 'xlink:href') {
      if (!value.trim().startsWith('#')) el.removeAttribute(attr.name);
      continue;
    }
    // url() in a style can point off-origin; the other two are legacy script
    // vectors that cost nothing to exclude.
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) {
      el.removeAttribute(attr.name);
    }
  }
}

/** Parse, strip, and return a safe <svg> element — or null if it cannot be
 *  made safe. Null means "leave the code block alone", never "render anyway". */
function ccSanitizeSvg(src) {
  if (!src || src.length > CC_SVG_MAX_BYTES) return null;
  let doc;
  try {
    doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  } catch {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;

  let seen = 0;
  const walk = (node) => {
    for (const child of Array.from(node.children)) {
      if (++seen > CC_SVG_MAX_NODES) { child.remove(); continue; }
      if (!CC_SVG_TAGS.has(child.nodeName)) { child.remove(); continue; }
      ccSvgCleanAttrs(child);
      walk(child);
    }
  };
  ccSvgCleanAttrs(svg);
  walk(svg);

  // Scale to the column instead of its authored pixel width — a 620px diagram
  // would otherwise force a horizontal scroll on a 430px phone. viewBox is what
  // preserves the aspect ratio once the fixed width is gone.
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg;
}

/** Replace every ```svg code block under `root` with the rendered diagram.
 *
 * The source is kept in a collapsed <details> rather than thrown away: a
 * diagram is often something to tweak, and losing the markup would mean asking
 * the model to produce it again. */
function ccRenderSvgBlocks(root) {
  if (!root) return;
  for (const code of Array.from(root.querySelectorAll('code'))) {
    const cls = code.className || '';
    const looksSvg = /language-(svg|xml)/.test(cls) ||
      code.textContent.trim().startsWith('<svg');
    if (!looksSvg) continue;
    const svg = ccSanitizeSvg(code.textContent.trim());
    if (!svg) continue;   // unparseable or unsafe: leave the code block visible

    const pre = code.closest('pre') || code;
    const wrap = document.createElement('div');
    wrap.className = 'cc-svg';
    wrap.appendChild(document.importNode(svg, true));

    const det = document.createElement('details');
    det.className = 'cc-svg-src';
    const sum = document.createElement('summary');
    sum.textContent = 'svg source';
    det.appendChild(sum);
    const keep = document.createElement('pre');
    const kc = document.createElement('code');
    kc.textContent = code.textContent;
    keep.appendChild(kc);
    det.appendChild(keep);

    pre.replaceWith(wrap);
    wrap.after(det);
  }
}
