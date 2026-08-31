// ── breakdown groups (master spine + draggable sub-step blocks) ────────────────
const SUB_X = 42;        // px from group-left where sub-cards start: just right of
                         // the 40px master spine (2px gap), not overlapping it
const SUBGAP = 2;        // px gap between side-by-side overlapping sub-lanes
const DEFAULT_SUB = 15;  // fallback minutes for a step with no est_min

// The CURRENT step the spine view highlights: the active (first-open) step — what
// to do next. Falls back to the first not-done step, then the last node (all done).
function currentStep(c, subs) {
  const active = c.nudge && c.nudge.active_node;
  return subs.find(n => n.id === active && !n.done)
      || subs.find(n => !n.done)
      || subs[subs.length - 1];
}

// Every node that occupies time on the timeline: the prep steps PLUS the atomic
// event block (is_event_start, est = the card's work minutes), which tiles last.
function timelineNodes(c) {
  const g = c.nudge && c.nudge.graph;
  if (!g || !g.nodes) return [];
  return g.nodes;
}
// A breakdown earns the spine treatment only with >=2 real steps; a single step
// stays an ordinary block.
function hasBreakdown(c) { return timelineNodes(c).length >= 2; }
function findNode(card, nid) {
  const g = card.nudge && card.nudge.graph;
  return g && g.nodes ? g.nodes.find(n => n.id === nid) : null;
}
// Plan order = back-scheduled deadline, then creation order. Default offsets tile
// the sub-cards sequentially from the master start by their own estimates.
function orderedSubs(c) {
  return timelineNodes(c).slice().sort((a, b) =>
    (a.deadline || '').localeCompare(b.deadline || '') ||
    (a.created_at || '').localeCompare(b.created_at || '') ||
    a.id.localeCompare(b.id));
}
function fmtClock(min) {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? 'am' : 'pm';
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, '0')}${ap}`;
}

// Persist a single field on one card without clobbering the rest: refetch the
// authoritative rd.json, mutate, PATCH. Used for sub-step time/size/done.
async function patchCard(cid, mutate) {
  const rd = await (await fetch('/api/rd')).json();
  const cards = rd.cards || [];
  const card = cards.find(x => x.id === cid);
  if (!card) return;
  mutate(card);
  // Merge-patch contract: send only the one card we touched, not the whole
  // board snapshot — the server shallow-merges by id, so a stale full-array
  // PATCH would otherwise clobber other cards' server-owned nudge state.
  await fetch('/api/rd', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cards: [card]})});
}
// Lock every still-default sub-step to an explicit offset so editing one never
// shifts the others (a default start = the running sum of prior steps' estimates,
// so a resize would otherwise drag every later default step with it).
function freezeOffsets(c) {
  timelineNodes(c).forEach(nd => { if (nd.tl_offset == null && nd._off != null) nd.tl_offset = nd._off; });
}
// One write for the whole breakdown: persist the master start/duration plus every
// step's (now explicit) offset and the edited step's est_min / done.
function persistLayout(c, edited) {
  patchCard(c.id, card => {
    if (c.dir_start_min != null) card.dir_start_min = c.dir_start_min;
    if (c.estimated_time != null) card.estimated_time = c.estimated_time;
    timelineNodes(c).forEach(local => {
      const m = findNode(card, local.id);
      if (m && local.tl_offset != null) m.tl_offset = local.tl_offset;
    });
    if (edited) {
      const m = findNode(card, edited.id);
      if (m) {
        if (edited.est_min != null) m.est_min = edited.est_min;
        if (edited.done != null) m.done = edited.done;
      }
    }
  });
}

function subMeta(startMin, dur, color) {
  const meta = document.createElement('div');
  meta.className = 'dir-sub-meta';
  meta.style.color = color;
  meta.textContent = `${fmtClock(startMin)} · ${durLabel(dur)}`;
  return meta;
}

// Click a task -> mark done (grey out) and reveal the next open step; clicking a
// done task un-marks it. persistLayout writes the done flag (freezing offsets)
// via the merge-patch. The whole card drags via the spine, so tasks are click-only.
function wireTaskDone(c, nd, el, track) {
  el.addEventListener('click', e => {
    e.stopPropagation();
    nd.done = !nd.done;
    freezeOffsets(c);
    redrawCards(track);
    persistLayout(c, {id: nd.id, done: nd.done});
  });
}

// One task block in the spine view. A DONE step sits greyed at its real time slot;
// the CURRENT step is stretched down to the group bottom so the active work "takes
// up the whole task time". style = {bg, border, titleC, metaC}.
function renderTaskBlock(c, nd, track, masterStart, groupStart, contH, current, style) {
  const {bg, border, titleC, metaC} = style;
  const isEvent = !!nd.is_event_start;
  const startPx = Math.max(0, (masterStart + nd._off - groupStart) * TL_PX);
  const el = document.createElement('div');
  el.className = 'dir-sub dir-task' + (nd.done ? ' done' : '') + (bg ? '' : ' plain') + (isEvent ? ' event' : '');
  el.dataset.nid = nd.id;
  el.style.cssText = `${bg}${border}`;
  el.style.left = SUB_X + 'px';
  el.style.right = '0';
  el.style.top = startPx + 'px';
  // current step fills to the group bottom; a done step keeps its own duration
  const h = (nd === current) ? (contH - startPx) : (nd._dur * TL_PX - 3);
  el.style.height = Math.max(13, h) + 'px';
  if (isEvent) el.style.borderStyle = 'dashed';

  const lab = document.createElement('div');
  lab.className = 'dir-sub-title';
  lab.style.color = titleC;
  lab.textContent = nd.label;
  el.appendChild(lab);
  if (h >= 28) el.appendChild(subMeta(masterStart + nd._off, nd._dur, metaC));
  wireTaskDone(c, nd, el, track);
  return el;
}

// A today card with a breakdown: a thin vertical spine (master; tap → card,
// drag → move the group) plus the CURRENT step stretched to fill the whole card
// time, with any DONE steps greyed above it at their real slots. Sub starts are
// offsets from the master start, so moving the spine carries them all
// (saveStartTime only writes dir_start_min).
function createGroup(c, track) {
  const masterStart = c.dir_start_min != null ? c.dir_start_min : TL_START;
  const subs = orderedSubs(c);
  let acc = 0;
  subs.forEach(nd => {
    nd._dur = Math.max(10, nd.est_min || DEFAULT_SUB);
    nd._off = (nd.tl_offset != null) ? nd.tl_offset : acc;
    acc += nd._dur;
  });
  // The master snaps to the exact bounds of its sub-steps (grows AND shrinks) —
  // no longer floored at the card's own estimated_time.
  const minOff = Math.min(...subs.map(n => n._off));
  const maxEnd = Math.max(...subs.map(n => n._off + n._dur));
  const groupStart = masterStart + minOff;
  c._startMin = groupStart;
  c._durMin = maxEnd - minOff;

  const {bg, border, dark} = cardStyle(c);
  const titleC = bg ? (dark ? 'inherit' : 'rgba(0,0,0,0.85)') : 'hsl(var(--green-hsl) / 0.8)';
  const metaC  = bg ? (dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)') : 'hsl(var(--green-hsl) / 0.45)';

  const container = document.createElement('div');
  container.className = 'dir-group';
  container.dataset.id = c.id;
  container.style.top = ((groupStart - TL_START) * TL_PX + 3) + 'px';
  container.style.height = Math.max(20, c._durMin * TL_PX - 6) + 'px';

  const contH = Math.max(20, c._durMin * TL_PX - 6);

  // Spine is ALWAYS shown (thin bar, left): tap opens the card, drag moves the
  // whole group (its sub-offsets ride on dir_start_min).
  const spine = document.createElement('div');
  spine.className = 'dir-spine' + (bg ? '' : ' plain');
  spine.style.cssText = `${bg}${border}`;
  const spineTitle = document.createElement('div');
  spineTitle.className = 'dir-spine-title';
  spineTitle.style.color = titleC;
  spineTitle.textContent = c.title;
  spine.appendChild(spineTitle);
  container.appendChild(spine);

  const groupOpts = {
    ghostSrc: container, liftEl: container, spanMin: c._durMin,
    onTodayCommit(snapped) {
      const delta = snapped - c._startMin;
      c.dir_start_min = masterStart + delta;
      redrawCards(track);
      saveStartTime(c.id, c.dir_start_min);
    },
    onClick() { openCardDialog(c.id, () => load(weekStart), 'hq'); },
  };
  attachBlockDrag(spine, null, (x, y, gx, gy) => startTimelineDrag(c, track, groupOpts, x, y, gx, gy));

  // Task blocks: every DONE step greyed at its real slot + the CURRENT step
  // stretched to fill the rest of the time. Future (not-yet-open) steps stay
  // hidden under the current block. Tap a task to mark it done / undo.
  const current = currentStep(c, subs);
  const style = {bg, border, titleC, metaC};
  subs.forEach(nd => {
    if (nd.done || nd === current)
      container.appendChild(
        renderTaskBlock(c, nd, track, masterStart, groupStart, contH, current, style));
  });

  return container;
}

