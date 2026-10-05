// /aspira - the WAVE LIST bottom-left (split from aspira-ui.js at its 500-line
// cap): one row per wave still alive and the next ones - Roman number, the
// enemies as one icon each sized by HP (tessellating when long), the name.
// UI only; loaded before aspira-ui.js, whose updateHud calls updateWaveList.
const WAVE_ROWS = 10, WAVE_DEAD_A = 0.18, WAVE_ICON = [5, 18], WAVE_SPAN = 110, WAVE_SPAN_PHONE = 95, SWARM_MIN = 4, WAVE_ROW_H = 22, WAVE_BOSS_PX = 22; // WAVE_ROW_H: every row's height (owner: consistent) // SWARM_MIN: the smallest tessellated diamond box (px); a boss's icon, always the biggest // the upcoming-wave icons' size range (px); rows up to this many never overlap

// the enemy itself (owner): the same polygon the board draws (poly() in
// aspira-draw.js), as a small inline SVG in the type's colour
// gap: px between this icon and the next (negative overlaps them); dy: a
// vertical nudge (px); x, y: an absolute spot inside a lattice band (CSS lengths)
function enemyIcon(type, px, gap, dy, x, y, dim) {
  const d = ENEMIES[type], n = d.pointy ? d.sides * 2 : d.sides, pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n, r = d.pointy && i % 2 ? 3.6 : 8;
    pts.push((10 + Math.cos(a) * r).toFixed(1) + "," + (10 + Math.sin(a) * r).toFixed(1));
  }
  return '<svg class="asp-eicon" viewBox="0 0 20 20"' + (px ? ' style="width:' + px.toFixed(2) + 'px;height:' + px.toFixed(2) + 'px;margin-right:' + (gap ?? 1).toFixed(2) + 'px' + (dy ? ';transform:translateY(' + dy.toFixed(2) + 'px)' : "") + (x != null ? ';position:absolute;left:' + x + ';top:' + y : "") + (dim ? ';opacity:' + WAVE_DEAD_A : "") + '"' : "") + ' aria-label="' + type + '"><polygon points="' + pts.join(" ") + '"/></svg>';
}

// one wave-list row's icons, LEFT-ALIGNED in a band `span` x WAVE_ROW_H: one
// line if it fits at natural size (never for a swarm, owner: at least 2 rows);
// else 2 rows zigzagging; else 3 - columns alternating two icons (top, bottom)
// and one (middle). In 2 and 3 rows the VERTICAL step EQUALS the horizontal one
// (owner), TESS_STEP of an icon so diagonal neighbours just clear each other;
// icons shrink only as far as the row's height and width force, down to
// SWARM_MIN px, and columns squeeze (overlap) past that.
const TESS_STEP = 0.72;
function waveBand(type, count, px, span, alive) {
  // alive (a live wave): that many icons solid, the rest faded to WAVE_DEAD_A (owner)
  const H = WAVE_ROW_H, fade = k => alive != null && k >= alive;
  const place = (pts, b) => '<span class="asp-band" style="width:' + span + "px;height:" + H + 'px">' +
    pts.map(([x, y], k) => enemyIcon(type, b, 0, 0, x.toFixed(2) + "px", y.toFixed(2) + "px", fade(k))).join("") + "</span>";
  if (type !== "swarm" && count * (px + 2) - 2 <= span) return place(Array.from({ length: count }, (_, k) => [k * (px + 2), (H - px) / 2]), px);
  // rows R: R-1 vertical steps of the same size as the column step
  const lattice = R => {
    const cols = R === 2 ? count : Math.ceil(count * 2 / 3);
    let b = Math.min(px, (H - 1) / ((R - 1) * TESS_STEP + 1)); // fits the height
    const fitW = cols > 1 ? span / ((cols - 1) * TESS_STEP + 1) : b;
    const fits = fitW >= b;
    b = Math.max(SWARM_MIN, Math.min(b, fitW));
    const st = cols > 1 ? Math.min(b * TESS_STEP, (span - b) / (cols - 1)) : 0, top = (H - (R - 1) * st - b) / 2, pts = [];
    if (R === 2) for (let k = 0; k < count; k++) pts.push([k * st, top + (k % 2) * st]);
    else { let left = count; for (let c = 0; left > 0; c++) for (const r of c % 2 ? [1] : [0, 2]) { if (left-- <= 0) break; pts.push([c * st, top + r * st]); } }
    return { fits, html: place(pts, b), b };
  };
  const two = lattice(2);
  if (two.fits) return two.html; // 2 rows whenever they fit the width; 3 only past that
  return lattice(3).html;
}

// wave n -> how many of its enemies are still alive or yet to spawn (only waves with any)
function liveWaves() {
  const m = new Map(), add = (n, v) => m.set(n, (m.get(n) || 0) + v);
  for (const e of G.enemies) if (!e.dead && !e.bossKin) add(e.n, 1);
  for (const w of G.spawns) add(w.n, w.list.length - w.idx);
  return m;
}

function updateWaveList() {
  // the waves still alive and the next ones, one per row (owner; waves are fixed, so they are
  // known): its Roman number : its enemies, ONE ICON EACH, sized by HP : name.
  // No count, no HP figure (owner) - the icons say both. Sizes run on a log
  // scale across the ten waves, WAVE_ICON[0] .. WAVE_ICON[1] px. A plain enemy
  // is named by type in lowercase, a boss by its arcana, its icon inverted as
  // on its own sky.
  // the list keeps every wave still ALIVE (an enemy alive or yet to spawn) and
  // the current one, then fills with upcoming waves to WAVE_ROWS (at least 3
  // upcoming) (owner). A live wave's icons: `alive` solid, the dead faded.
  const live = liveWaves(), rows = [];
  const rowOf = (n, w) => {
    const boss = w.type === "bonus";
    const hp = enemyHp(w.type, n) * (boss ? (BOSS_HP[arcanaOf(n).id] || 1) * laneTravel(laneMap(n).bonus) / meanTravel() : 1);
    return { n, w, boss, hp, alive: live.get(n), cur: n === G.wave || live.has(n) }; // highlighted: every wave still ALIVE, and the current one (owner)
  };
  for (const n of [...new Set([...live.keys(), ...(G.wave > 0 ? [G.wave] : [])])].sort((a, b) => a - b)) {
    if (G.planLog && G.planLog[n]) rows.push(rowOf(n, G.planLog[n]));
  }
  let prev = G.lastType;
  // nothing past the last boss (owner): the game is won at WIN_WAVE
  for (let i = 1; (rows.length < WAVE_ROWS || i <= 3) && G.wave + i <= WIN_WAVE; i++) {
    const n = G.wave + i, w = wavePlan(n, prev);
    if (w.type !== "bonus") prev = w.type; // the boss wave does not break the alternation
    rows.push(rowOf(n, w));
  }
  // the log scale spans the ORDINARY enemies only (owner: sizes did not read -
  // one boss's HP squeezed the rest into the middle); a boss is always WAVE_BOSS_PX
  const plain = rows.filter(r => !r.boss).map(r => r.hp);
  const lo = Math.log(Math.min(...plain)), hi = Math.log(Math.max(...plain));
  const pxOf = (hp, boss) => boss ? WAVE_BOSS_PX : Math.round(WAVE_ICON[0] + (WAVE_ICON[1] - WAVE_ICON[0]) * (hi > lo ? (Math.log(hp) - lo) / (hi - lo) : 0.5));
  // every row is the SAME FIXED width, wave after wave (owner): WAVE_SPAN, or
  // WAVE_SPAN_PHONE on a phone (to clear the build buttons)
  const span = matchMedia("(width < 700px)").matches ? WAVE_SPAN_PHONE : WAVE_SPAN;
  let note = "";
  for (const { n, w, boss, hp, alive, cur } of rows) {
    // rows LEFT-ALIGNED at their natural size (owner: not justified); a row too
    // long for the fixed width `span` TESSELLATES into 2, then 3 staggered rows
    // (waveBand), overlapping only past that. The box is always `span` wide, so
    // the name column never moves. A boss sits centred between two lines.
    const px = Math.min(pxOf(hp, boss), WAVE_ROW_H);
    let icons = boss
      ? '<span class="asp-bline"></span>' + enemyIcon(w.type, px, 2).repeat(w.count - 1) + enemyIcon(w.type, px, 0) + '<span class="asp-bline"></span>'
      : waveBand(w.type, w.count, px, span, alive);
    const c = cur ? ' class="asp-cur"' : ""; // a live wave: one unbroken light white band across its row (owner)
    // the INCOMING wave carries its countdown to its right, "15s" (owner; was a
    // "next wave in" line above the list): after the name, or on a phone (names
    // hidden) just right of the icons
    const eta = n === G.wave + 1 && G.started && !bossUp() ? Math.ceil(Math.max(0, G.nextIn)) + "s" : "";
    const etaHtml = eta ? '<span class="asp-eta">' + eta + "</span>" : "";
    note += "<span" + c + ">" + roman(n) + "</span><span" + c + ">:</span>" +
      '<span class="asp-dots e-' + ENEMIES[w.type].color + (boss ? " e-boss" : "") + (cur ? " asp-cur" : "") + '" style="width:' + span + 'px">' + icons + (eta ? '<span class="asp-eta asp-eta-ph">' + eta + "</span>" : "") + "</span>" +
      "<span" + c + ">" + (boss ? "<b>" + arcanaOf(n).name + "</b>" : w.type) + etaHtml + "</span>"; // boss names BOLD (owner)
  }
  if (note !== lastNote) { $("asp-wavenote").innerHTML = note; lastNote = note; } // innerHTML re-reads normalised, so compare the source
}
