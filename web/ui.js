/* global cardStyle, CARD_CATS */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// effects the token's real consumer applies — reproduced on the swatch fill
// (nav backdrop runs blur(14px) under .exec-nav)
const TOKEN_FX = {
  'scrim-hsl': {
    style: 'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
    label: 'blur(14px)',
  },
};

// canonical 4 card variations and their alpha
const SIZES = ['wisp', 'idea', 'plan', 'commitment'];
const SIZE_ALPHA = { wisp: 0.15, idea: 0.25, plan: 0.8, commitment: 1 };
function nearestSize(a) {
  let best = SIZES[0], bd = Infinity;
  for (const s of SIZES) { const d = Math.abs(SIZE_ALPHA[s] - a); if (d < bd) { bd = d; best = s; } }
  return best;
}

// (alpha, count) pairs for an -hsl token; drop the invisible 0 step
function tokenAlphaPairs(t) {
  const ac = t.alphaCounts || [];
  const pairs = (t.alphas || []).map((a, i) => ({ a, n: ac[i] })).filter(x => x.a > 0);
  return pairs.length ? pairs : [{ a: 1, n: t.count }];
}

// one color = one table: columns are card sizes (wisp..commitment) or, for
// non-card colors, the used alpha steps; rows are swatch/opacity/count/effects
function groupHtml(col) {
  let swatches, opac, counts;
  const card = col.hasCard;
  if (card) {
    // card colors: count per size = non-card usages mapped onto it (all 4)
    const mapped = { wisp: 0, idea: 0, plan: 0, commitment: 0 };
    for (const p of col.alphaPairs) mapped[nearestSize(p.a)] += (p.n || 0);
    swatches = col.segs;
    opac = SIZES.map(s => SIZE_ALPHA[s]);
    counts = SIZES.map(s => mapped[s]);
  } else {
    swatches = col.alphaPairs.map(p => `background:hsl(${col.value} / ${p.a});${col.fxStyle}`);
    opac = col.alphaPairs.map(p => p.a);
    counts = col.alphaPairs.map(p => p.n);
  }
  // usage sites per column: non-card = that alpha's sites; card = sites of
  // the accent alphas that map onto that size
  const ms = mergedSites(col);
  let colSites;
  if (card) {
    colSites = SIZES.map(s => {
      const acc = {};
      for (const a of Object.keys(ms)) {
        if (nearestSize(parseFloat(a)) !== s) continue;
        for (const [l, c] of Object.entries(ms[a])) acc[l] = (acc[l] || 0) + c;
      }
      return acc;
    });
  } else {
    colSites = col.alphaPairs.map(p => ms[`${p.a}`] || {});
  }
  // pad every table to 4 columns (empty trailing cells) so they all line up
  while (swatches.length < 4) { swatches.push(null); opac.push(null); counts.push(null); }
  while (colSites.length < 4) colSites.push({});
  // no header / row labels — the note + each color's description cover them
  const swRow = `<tr>${swatches.map(s => s == null ? '<td></td>' :
    `<td><div class="clr-sw"><div class="clr-fill" style="${esc(s)}"></div></div></td>`).join('')}</tr>`;
  const opRow = `<tr>${opac.map(o =>
    `<td>${o != null ? esc(String(o)) : ''}</td>`).join('')}</tr>`;
  // card colors show mapped additions (+N×), non-card the raw count (×N)
  const cntRow = `<tr>${counts.map(c => c == null ? '<td></td>' :
    `<td><span class="clr-cnt">${card ? `+${c}&times;` : `&times;${c}`}</span></td>`).join('')}</tr>`;
  // effect sits in the column it applies to (the token's first/only shade)
  const fxRow = `<tr>${[0, 1, 2, 3].map(i =>
    `<td class="clr-fx">${i === 0 && col.fxLabel ? esc(col.fxLabel) : ''}</td>`).join('')}</tr>`;
  // one column of usage sites per variation (most-used to least)
  const useRow = `<tr>${colSites.map(sm =>
    `<td class="clr-usecell">${siteListHtml(sm)}</td>`).join('')}</tr>`;
  return `<div class="clr-group">
    <div class="clr-title">${esc(col.name)}</div>
    ${col.use ? `<div class="clr-guse">${esc(col.use)}</div>` : ''}
    <table class="clr-tbl">${swRow}${opRow}${cntRow}${fxRow}${useRow}</table>
  </div>`;
}

// token -> alpha-string -> {site label: count}, from /api/ui/usage
let SITES = {};

// merge usage sites across every -hsl token that shares this color:
// { alpha-string: { site label: count } }
function mergedSites(col) {
  const ts = {};
  for (const nm of col.hslNames || []) {
    const s = SITES[nm];
    if (!s) continue;
    for (const a of Object.keys(s)) {
      ts[a] = ts[a] || {};
      for (const [lbl, c] of Object.entries(s[a])) ts[a][lbl] = (ts[a][lbl] || 0) + c;
    }
  }
  return ts;
}

// vertical site list for one column, most-used to least — collapsed by default
// behind a "> [ show usage ]" toggle (native <details>).
function siteListHtml(siteMap) {
  const entries = Object.entries(siteMap || {}).sort((x, y) => y[1] - x[1]);
  if (!entries.length) return '';
  const items = entries.map(([lbl, n]) =>
    `<li>${esc(lbl)} <span class="clr-cnt">&times;${n}</span></li>`).join('');
  return `<details class="clr-usedet"><summary>[ show usage ]</summary>` +
    `<ul class="clr-uselist">${items}</ul></details>`;
}

// Gibson-voiced blurbs for the four card categories
const CAT_DESC = {
  Self: `Your own wiring. Self-work as card-fills, wisp to commitment.`,
  Social: `The others—debts and signals as card-fills, wisp to commitment.`,
  Interfacing: `Jacked into the world's systems. Errands and admin as card-fills, wisp to commitment.`,
  Hobby: `Off-grid hours. Making and play as card-fills, wisp to commitment.`,
};

// Category card colors — the --card-* tokens, grouped one entry per
// category; segments are the wisp/idea/plan/commitment fills.
function categoryTokens(tokenMap, friendlyMap) {
  if (typeof cardStyle !== 'function') return [];
  return CARD_CATS.map(cat => {
    const segs = SIZES.map(sz => cardStyle({ category: cat, size: sz }).bg);
    const key = cat.toLowerCase();
    const h = tokenMap[`cat-${key}-h`], s = tokenMap[`cat-${key}-s`], l = tokenMap[`cat-${key}-l`];
    return {
      name: `${cat} cards`,
      cssVar: false,
      // friendly name authored on the --cat-*-l knob (last decl on its line)
      friendly: friendlyMap[`cat-${key}-l`] || '',
      value: `${h} ${s} ${l}`,
      use: CAT_DESC[cat] || `${cat} card fills by size`,
      segs,
      hue: parseFloat(h),
    };
  });
}

function parsePalette(css) {
  const root = css.match(/:root\s*\{([^}]*)\}/);
  if (!root) return [];
  const tokens = [];
  for (const line of root[1].split('\n')) {
    // matchAll, not match — the --cat-* knobs sit two declarations per line
    for (const tok of line.matchAll(/--([\w-]+):\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/g)) {
      const comment = tok[3] || '';
      // leading [Friendly Name] in the comment = the color's human name
      const nm = comment.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
      tokens.push({
        name: tok[1],
        value: tok[2].trim(),
        friendly: nm ? nm[1] : '',
        use: nm ? nm[2].trim() : comment,
      });
    }
  }
  return tokens;
}

// sort key: chromatic by hue ascending from red (hue 0); near-gray tokens
// (saturation under 15%) trail at the end, light to dark
function hueKey(t) {
  if (t.hue != null) return [0, t.hue];
  const m = t.value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) return [2, 0];
  const h = +m[1], s = +m[2], l = +m[3];
  if (s < 15) return [1, 100 - l];
  return [0, h];
}

// Hide the category machinery (--cat-* knobs, --card-* variants — shown
// grouped via categoryTokens) and anything with zero usage.
function visibleTokens(tokens, usage) {
  const counts = usage.counts || {};
  const alphas = usage.alphas || {};
  const alphaCounts = usage.alpha_counts || {};
  return tokens
    .filter(t => !t.name.startsWith('cat-') && !t.name.startsWith('card-') && !isScaleName(t.name))
    .map(t => ({
      ...t, count: counts[t.name] || 0,
      alphas: alphas[t.name] || [], alphaCounts: alphaCounts[t.name] || [],
    }))
    .filter(t => t.count > 0);
}

// collapse tokens with the same H S L into one color (max 4 variations). The
// card-size fills are the canonical variations; a non-card -hsl token sharing
// the value keeps its (alpha, count) pairs only to map counts onto the sizes.
function buildColumns(tokens) {
  const byVal = new Map();
  for (const t of tokens) {
    const isHsl = t.name.endsWith('-hsl');
    const isCard = !!t.segs;
    const name = t.friendly || (t.cssVar === false ? t.name : '--' + t.name);
    const fx = TOKEN_FX[t.name] || {};
    const cur = byVal.get(t.value);
    if (!cur) {
      byVal.set(t.value, {
        name, value: t.value, isHsl, hasCard: isCard,
        hslNames: isHsl ? [t.name] : [],
        segs: isCard ? t.segs : null,
        alphaPairs: isHsl ? tokenAlphaPairs(t) : [],
        fxLabel: fx.label || '', fxStyle: fx.style || '',
        use: t.use || '',
      });
      continue;
    }
    cur.use = [cur.use, t.use].filter(Boolean).join(' ');
    if (isCard && !cur.hasCard) { cur.hasCard = true; cur.segs = t.segs; }
    if (isHsl) { cur.alphaPairs = cur.alphaPairs.concat(tokenAlphaPairs(t)); cur.hslNames.push(t.name); }
    if (!cur.isHsl && isHsl) { cur.name = name; cur.isHsl = true; cur.fxLabel = fx.label || ''; cur.fxStyle = fx.style || ''; }
  }
  // consolidate each color's alpha steps: sum duplicate alphas (from merged
  // tokens) and order ascending by opacity
  for (const col of byVal.values()) {
    if (!col.alphaPairs.length) continue;
    const m = new Map();
    for (const p of col.alphaPairs) m.set(p.a, (m.get(p.a) || 0) + (p.n || 0));
    col.alphaPairs = [...m.entries()].map(([a, n]) => ({ a, n })).sort((x, y) => x.a - y.a);
  }
  return [...byVal.values()];
}

// ── Scale tokens (the non-colour design tokens: spacing / type / motion /
// layers, all in the same chrome.css :root). Each family renders as its own
// visual — a bar sized to the spacing value, sample text at the type token,
// a fill that animates at the duration — beside its live var() usage count, so
// the scale's shape and its bloat (unused / rare steps) read at a glance. ─────
function visRadius(t) { return `<i class="sc-rad" style="border-radius:${esc(t.value)}"></i>`; }
// font family: the typeface's own name, set IN that family (Iosevka / BitLight / …)
function visFont(t) {
  const fam = t.value.split(',')[0].replace(/['"]/g, '').trim();
  return `<span class="sc-txt" style="font-family:${esc(t.value)}">${esc(fam)}</span>`;
}
// size + weight self-label: the token's own name rendered at that value
function visFs(t) { return `<span class="sc-txt" style="font-size:${esc(t.value)}">--${esc(t.name)}</span>`; }
function visFw(t) { return `<span class="sc-txt" style="font-weight:${esc(t.value)}">--${esc(t.name)}</span>`; }
function visLh(t) { return `<span class="sc-para" style="line-height:${esc(t.value)}">console static<br>stacked into<br>a rhythm</span>`; }
function visTrack(t) { return `<span class="sc-txt" style="letter-spacing:${esc(t.value)}">--${esc(t.name)}</span>`; }
function visBlur(t) { return `<span class="sc-txt sc-blur" style="filter:blur(${esc(t.value)})">GRID</span>`; }

// prefix -> {title, unit, num (sort by numeric value), vis (row visual)}
const SCALE_FAMS = [
  { title: 'Radius', pfx: 'radius-', num: true, vis: visRadius, hideUnused: true },
  { title: 'Font family', pfx: 'font-', num: false, vis: visFont },
  { title: 'Font size', pfx: 'fs-', num: true, vis: visFs, selfLabel: true },
  { title: 'Font weight', pfx: 'fw-', num: true, vis: visFw, selfLabel: true },
  { title: 'Line height', pfx: 'lh-', num: true, vis: visLh },
  { title: 'Tracking', pfx: 'tracking-', num: true, vis: visTrack, selfLabel: true },
  { title: 'Blur', pfx: 'blur', num: true, vis: visBlur },
];
const SCALE_PFX = SCALE_FAMS.map(f => f.pfx);
// structural tokens that live in the same :root but aren't rendered on the
// board — spacing + z-layers (dropped as families), plus doc-* (folded back
// into the palette colours). Hidden here so they don't leak into the colour
// board as broken numeric/alias "colours".
const HIDDEN_PFX = ['space-', 'z-', 'doc-'];
function isScaleName(n) { return SCALE_PFX.some(p => n.startsWith(p)) || HIDDEN_PFX.some(p => n.startsWith(p)); }

// merge every alpha bucket of a token's usage sites into one {label:count}.
// scale tokens carry a single "*" bucket; -hsl colours carry per-alpha buckets.
function flatSites(token) {
  const buckets = SITES[token] || {};
  const out = {};
  for (const k of Object.keys(buckets)) {
    for (const [lbl, n] of Object.entries(buckets[k])) out[lbl] = (out[lbl] || 0) + n;
  }
  return out;
}

// scale tokens off the parsed :root, tagged with their var() counts; the zero
// anchors (--space-0/--radius-0) are the scale's origin, not a visible step.
function scaleTokensOf(parsed, usage) {
  const counts = usage.counts || {};
  return parsed
    .filter(t => isScaleName(t.name) && t.name !== 'space-0' && t.name !== 'radius-0')
    .map(t => ({ name: t.name, value: t.value, count: counts[t.name] || 0 }));
}

// one family = one table in the SAME format as the colour tables: 4 columns
// (one per token, padded to 4), rows = visual / --name / value / ×count / usage
// sites. No "Scale" header, no step count — it reads as more of the colour board.
function scaleTableHtml(fam, toks) {
  const cells = toks.slice(0, 4);
  const pad = 4 - cells.length;
  const td = (inner, cls) => `<td${cls ? ` class="${cls}"` : ''}>${inner}</td>`;
  const empties = (cls) => td('', cls).repeat(pad);
  const row = (fn, cls) => `<tr>${cells.map(fn).join('')}${empties(cls)}</tr>`;
  return `<div class="clr-group">
    <div class="clr-title">${esc(fam.title)}</div>
    <table class="clr-tbl">
      ${row(t => td(`<div class="sc-vis">${fam.vis(t)}</div>`))}
      ${fam.selfLabel ? '' : row(t => td(`<span class="sc-name">--${esc(t.name)}</span>`))}
      ${row(t => td(`<span class="sc-val">${esc(t.value)}</span>`))}
      ${row(t => td(`<span class="clr-cnt">&times;${t.count || 0}</span>`))}
      ${row(t => td(siteListHtml(flatSites(t.name)), 'clr-usecell'), 'clr-usecell')}
    </table>
  </div>`;
}

// all scale families as colour-style tables (concatenated, no section wrapper).
function scaleGroupsHtml(parsed, usage) {
  const toks = scaleTokensOf(parsed, usage);
  return SCALE_FAMS.map(fam => {
    let rows = toks.filter(t => t.name.startsWith(fam.pfx));
    if (fam.hideUnused) rows = rows.filter(t => (t.count || 0) > 0);
    if (fam.num) rows = rows.slice().sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
    if (!rows.length) return '';
    return scaleTableHtml(fam, rows);
  }).join('');
}

async function loadColors() {
  const board = document.getElementById('clr-board');
  try {
    const [cssRes, usageRes] = await Promise.all([
      fetch('/chrome.css'),
      fetch('/api/ui/usage'),
    ]);
    const css = await cssRes.text();
    const usage = usageRes.ok ? await usageRes.json() : { counts: {}, alphas: {} };
    SITES = usage.sites || {};
    const parsed = parsePalette(css);
    const tokenMap = Object.fromEntries(parsed.map(t => [t.name, t.value]));
    const friendlyMap = Object.fromEntries(parsed.map(t => [t.name, t.friendly]));
    const tokens = [...visibleTokens(parsed, usage), ...categoryTokens(tokenMap, friendlyMap)]
      .sort((a, b) => {
        const ka = hueKey(a), kb = hueKey(b);
        return ka[0] - kb[0] || ka[1] - kb[1];
      });
    if (!tokens.length) { board.innerHTML = '<div class="clr-empty">no :root palette found in chrome.css</div>'; return; }
    // one table per color (merged by value, hue-ordered), then the non-colour
    // scale-token families as tables in the identical format — one board.
    board.innerHTML =
      `<div class="clr-board">${buildColumns(tokens).map(groupHtml).join('')}` +
      `${scaleGroupsHtml(parsed, usage)}</div>`;
  } catch (e) {
    board.innerHTML = `<div class="clr-empty">failed to load palette: ${esc(e.message)}</div>`;
  }
}

loadColors();
