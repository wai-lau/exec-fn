// The fake browser for smoke.mjs: just enough DOM for every /spire script to load and run, and a 2D canvas
// context that RECORDS what is drawn (rec.n calls, rec.ops by name, rec.texts) instead of drawing it.
// No WebGL (3D must fall back), no audio, a fetch that answers empty.

// a 2D context that counts every call; state (fillStyle, lineWidth...) just sticks
function recordingCtx(canvas) {
  const rec = { n: 0, ops: {}, texts: [] };
  const state = { canvas, globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1, font: "10px sans", shadowBlur: 0 };
  const special = {
    measureText: s => ({ width: String(s).length * 7, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return this; } }),
    isPointInPath: () => false, isPointInStroke: () => false, getLineDash: () => [],
  };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === "rec") return rec;
      if (k in special) return (...a) => { rec.n++; return special[k](...a); };
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      return (...a) => {
        rec.n++; rec.ops[k] = (rec.ops[k] || 0) + 1;
        if (k === "fillText" || k === "strokeText") rec.texts.push(String(a[0]));
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

class FakeEl {
  constructor(dom, tag = "div", id = "") {
    this._dom = dom; this.tagName = tag.toUpperCase(); this._id = ""; this.children = []; this.parentNode = null;
    this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" };
    this.dataset = {}; this.hidden = false; this.textContent = ""; this._html = ""; this.value = ""; this.disabled = false;
    this.width = 1280; this.height = 800; this.clientWidth = 1280; this.clientHeight = 800; this.offsetWidth = 1280; this.offsetHeight = 800;
    this.scrollTop = 0; this.scrollHeight = 0; this.attrs = {};
    const cls = new Set();
    this.classList = { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } };
    if (id) this.id = id;
  }
  get id() { return this._id; }
  set id(v) { this._id = String(v); if (this._id) this._dom.ids.set(this._id, this); }
  get className() { return this._cls || ""; }
  set className(v) { this._cls = v; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; for (const m of this._html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)) this.children.push(new FakeEl(this._dom, m[1], m[2])); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get rows() { return this.children; }
  get cells() { return this.children; }
  getContext(kind) {
    if (kind !== "2d") return null; // no WebGL: 3D must fall back
    return (this._ctx ||= recordingCtx(this));
  }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  append(...k) { for (const c of k) if (c instanceof FakeEl) { c.parentNode = this; this.children.push(c); } }
  appendChild(c) { this.append(c); return c; }
  prepend(...k) { this.append(...k); }
  before(...k) { for (const c of k) if (c instanceof FakeEl && c.id) this._dom.ids.set(c.id, c); }
  after(...k) { this.before(...k); }
  insertBefore(c) { this.append(c); return c; }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  remove() { if (this.id && this._dom.ids.get(this.id) === this) this._dom.ids.delete(this.id); }
  insertRow() { const r = new FakeEl(this._dom, "tr"); this.append(r); return r; }
  insertCell() { const c = new FakeEl(this._dom, "td"); this.append(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = v; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
  focus() {} blur() {} click() { if (this.onclick) this.onclick({ preventDefault() {}, stopPropagation() {} }); }
  closest() { return null; } matches() { return false; } contains() { return false; }
  querySelector(sel) { return this._dom.query(sel); }
  querySelectorAll() { return []; }
  getAnimations() { return []; }
  setPointerCapture() {} releasePointerCapture() {} scrollIntoView() {} animate() { return { finished: Promise.resolve(), cancel() {} }; }
}

export function makeDom(template, store = {}) {
  const dom = { ids: new Map(), sel: new Map() };
  // every id in the template exists up front (with its tag), so $("asp-ov") is the real overlay, hidden as written
  for (const m of template.matchAll(/<(\w+)([^>]*)\sid="([^"]+)"([^>]*)>/g)) {
    const el = new FakeEl(dom, m[1], m[3]);
    if (/\shidden(\s|>|$|=)/.test(m[2] + " " + m[4])) el.hidden = true;
  }
  const swatches = [...template.matchAll(/data-asp-sw="([^"]+)"/g)].map((m, i) => {
    const el = new FakeEl(dom, "span"); el.dataset.aspSw = m[1]; el._color = `rgb(${(i * 37) % 256}, ${(i * 71 + 40) % 256}, ${(i * 113 + 90) % 256})`; return el;
  });
  dom.byId = id => dom.ids.get(id) || null;
  dom.query = sel => {
    if (sel.startsWith("#")) return dom.ids.get(sel.slice(1)) || null;
    if (!dom.sel.has(sel)) dom.sel.set(sel, new FakeEl(dom, "div"));
    return dom.sel.get(sel);
  };
  const document = {
    getElementById: id => dom.byId(id),
    querySelector: sel => dom.query(sel),
    querySelectorAll: sel => (sel.includes("data-asp-sw") ? swatches : []),
    createElement: tag => new FakeEl(dom, tag),
    createElementNS: (ns, tag) => new FakeEl(dom, tag),
    createTextNode: t => ({ textContent: t }),
    addEventListener() {}, removeEventListener() {}, getAnimations: () => [],
    body: new FakeEl(dom, "body"), documentElement: new FakeEl(dom, "html"),
    hidden: false, visibilityState: "visible", fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
  };
  let raf = [], now = 1000;
  const anything = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : anything()), apply: () => anything(), construct: () => anything() });
  const globals = {
    document, console, performance: { now: () => now },
    requestAnimationFrame: cb => { raf.push(cb); return raf.length; }, cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, queueMicrotask: f => Promise.resolve().then(f),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    getComputedStyle: el => ({ color: (el && el._color) || "rgb(0, 0, 0)", getPropertyValue: () => "", gap: "0px", columnGap: "0px", rowGap: "0px", paddingLeft: "0px", paddingRight: "0px", fontSize: "16px" }),
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entries: [] }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    AudioContext: function () { return anything(); }, Audio: function () { return anything(); },
    navigator: { userAgent: "smoke", maxTouchPoints: 0, vibrate() {}, clipboard: { writeText: () => Promise.resolve() } },
    location: { search: "", hash: "", href: "http://smoke/spire", pathname: "/spire" },
    ResizeObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} },
    Image: class { set src(v) { this._src = v; } },
    Path2D: class { moveTo() {} lineTo() {} arc() {} closePath() {} rect() {} bezierCurveTo() {} quadraticCurveTo() {} ellipse() {} addPath() {} },
    CanvasRenderingContext2D: class {},
    DOMMatrix: class { constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); } }, URLSearchParams, TextEncoder, TextDecoder,
    addEventListener() {}, removeEventListener() {}, HTMLElement: FakeEl, Element: FakeEl,
  };
  globals.window = globals; globals.self = globals; globals.globalThis = globals;
  dom.globals = globals;
  dom.rafQueue = () => raf.length;
  dom.tick = dt => { now += dt; const q = raf; raf = []; for (const cb of q) cb(now); };
  Object.defineProperty(dom, "canvas2d", { get: () => dom.byId("asp-cv").getContext("2d") });
  return dom;
}
