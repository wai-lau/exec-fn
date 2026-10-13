// /aspira - the WAVE LIST bottom-left (split from aspira-ui.js at its 500-line
// cap): one row per wave still alive and the next ones - Roman number, the
// enemies as one icon each sized by HP (tessellating when long), the name.
// UI only; loaded before aspira-ui.js, whose updateHud calls updateWaveList.
const WAVE_ROWS = 10, WAVE_DEAD_A = 0.18, WAVE_ICON = [5, 18], WAVE_SPAN = 110, WAVE_SPAN_PHONE = 95, SWARM_MIN = 4, WAVE_ROW_H = 22, WAVE_BOSS_PX = 22; // WAVE_ROW_H: every row's height (owner: consistent) // SWARM_MIN: the smallest tessellated diamond box (px); a boss's icon, always the biggest // the upcoming-wave icons' size range (px); rows up to this many never overlap
// the list's headings: the boxed live waves, then the rest (owner, 2026-10-09)
const WAVE_HEAD = { now: "warped in", next: "warping in..." }; // (owner: "replace upcoming waves with: warping in...")

// the enemy itself (owner): the same polygon the board draws (poly() in
// aspira-draw.js), as a small inline SVG in the type's colour
// gap: px between this icon and the next (negative overlaps them); dy: a
// vertical nudge (px); x, y: an absolute spot inside a lattice band (CSS lengths)
function enemyIcon(type, px, gap, dy, x, y, dim) {
  const d = ENEMIES[type], n = d.pointy ? d.sides * 2 : d.sides, pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n, r = d.pointy && i % 2 ? 8 * (d.pointy === true ? 0.45 : d.pointy) : 8;
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
    const hp = enemyHp(w.type, n) * (boss ? (BOSS_HP[arcanaOf(n).id] || 1) * BOSS_LANE_HP : 1);
    return { n, w, boss, hp, alive: live.get(n), cur: n === G.wave || live.has(n) }; // highlighted: every wave still ALIVE, and the current one (owner)
  };
  // after a boss, until "challenge" is tapped, the beaten boss's row goes too (owner, 2026-10-12): only the button and what is coming
  for (const n of [...new Set([...live.keys(), ...(G.wave > 0 && !afterBoss() ? [G.wave] : [])])].sort((a, b) => a - b)) {
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
  // the list's two HEADINGS (owner, 2026-10-09: "move upcoming waves to below the rectangle and above
  // it show current wave"): the one above the list names the boxed live waves; "upcoming waves" then
  // heads the rest INSIDE the grid, a full-width cell padded with three hidden ones so the columns'
  // nth-child rules still count four cells a row
  // The incoming wave's COUNTDOWN rides the "warping in..." heading (owner, 2026-10-09: "left align" -
  // the rows sit flush under the headings; the countdown had a column of its own left of them).
  // None while a boss is up or next (a boss waits for a clear field)
  const curRows = rows.filter(r => r.cur).length;
  const eta = G.started && !bossUp() && !bossNext() ? ' <span class="asp-eta">' + Math.ceil(Math.max(0, G.nextIn)) + "s</span>" : "";
  const lab = $("asp-wavelabel"), chal = afterBoss(); // after a boss: the CHALLENGE button where the countdown was (aspira-waves.js)
  const labHtml = chal ? "" : curRows ? WAVE_HEAD.now : WAVE_HEAD.next + eta; // (the CHALLENGE button sits under the core - placeChallenge)
  if (lab.dataset.h !== labHtml) { lab.dataset.h = labHtml; lab.innerHTML = labHtml; }
  const btn = $("asp-challenge"), label = chal ? "Challenge " + arcanaOf(G.wave + STAR_EVERY).name : ""; // (owner, 2026-10-12: back from "PROCEED", capital C)
  btn.hidden = !chal; btn.onclick ||= () => challengeNext();
  if (btn.textContent !== label) btn.textContent = label;
  let note = "", i = 0;
  for (const { n, w, boss, hp, alive } of rows) {
    if (curRows && i++ === curRows) note += '<span class="asp-wavelabel asp-wavesub">' + WAVE_HEAD.next + eta + "</span>" + "<i hidden></i>".repeat(3);
    // rows LEFT-ALIGNED at their natural size (owner: not justified); a row too
    // long for the fixed width `span` TESSELLATES into 2, then 3 staggered rows
    // (waveBand), overlapping only past that. The box is always `span` wide, so
    // the name column never moves. A boss sits centred between two lines.
    const px = Math.min(pxOf(hp, boss), WAVE_ROW_H);
    let icons = boss
      ? '<span class="asp-bline"></span>' + enemyIcon(w.type, px, 2).repeat(w.count - 1) + enemyIcon(w.type, px, 0) + '<span class="asp-bline"></span>'
      : waveBand(w.type, w.count, px, span, alive);
    // NO wave numbers (owner, 2026-10-06); the first column is empty and takes no room since the
    // countdown moved to the heading, the ":" column is empty
    note += "<span></span><span></span>" +
      '<span class="asp-dots e-' + ENEMIES[w.type].color + (boss ? " e-boss" : "") + '" style="width:' + span + 'px">' + icons + "</span>" +
      "<span>" + (boss ? "<b>" + arcanaOf(n).name + "</b>" : w.type) + "</span>"; // boss names BOLD (owner)
  }
  // the waves still ALIVE (and the current one) sit at the top: ONE rounded green box round them all
  // (owner, 2026-10-09: "replace the current wave highlight with a single rounded green rectangle";
  // was a white band on each row). Placed on the grid's rows but out of the flow, and LAST so the
  // columns' nth-child rules still count four cells a row
  if (curRows) note += '<i class="asp-curbox" style="grid-row:1 / ' + (curRows + 1) + '"></i>';
  if (note !== lastNote) { $("asp-wavenote").innerHTML = note; lastNote = note; } // innerHTML re-reads normalised, so compare the source
}
// the CHALLENGE button UNDER THE CORE, centred on it (owner, 2026-10-12: "move the challenge button under the core, centered
// horizontally"): below the core's life rings, followed every frame (the camera moves), in 2D and 3D alike
const CHALLENGE_BELOW = 16; // world units under the life rings / the lowest slot
function placeChallenge() {
  const btn = $("asp-challenge");
  if (btn.hidden) return;
  // under the core AND clear of the build slots round it (a slot under the button could not be tapped)
  const wy = Math.max(CY + CORE_R + LIFE_GAP * LIFE_RINGS, ...CELLS.map(c => c.y + CELL_S * TOWER_K)) + CHALLENGE_BELOW, root = $("asp").getBoundingClientRect();
  let x, y;
  if (q3d() && typeof warp !== "undefined" && warp.ent && warp.p) {
    const c0 = { k: cam.k, ox: cam.ox, oy: cam.oy }; // projected as warp3d does: under the texture camera (warpRes)
    cam.k *= warpRes(); cam.ox *= warpRes(); cam.oy *= warpRes();
    let P; try { P = warpProject(CX, wy, 0); } finally { Object.assign(cam, c0); }
    const r = warp.ent.getBoundingClientRect();
    x = r.left + P.x * r.width / warp.ent.width; y = r.top + P.y * r.height / warp.ent.height;
  } else {
    const r = cv.getBoundingClientRect(), k = r.width / cv.width;
    x = r.left + (CX * cam.k + cam.ox) * k; y = r.top + (wy * cam.k + cam.oy) * k;
  }
  btn.style.left = (x - root.left) + "px"; btn.style.top = (y - root.top) + "px";
}
