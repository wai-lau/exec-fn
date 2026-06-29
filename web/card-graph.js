/* Card breakdown graph — layered DAG for card.nudge.graph.
   HTML nodes (full wrapping text, inline-editable labels) over an SVG edge
   overlay. Used inside the card dialog (card-dialog.js); mutates card.nudge in
   place, persisted by the dialog's save (PATCH /api/rd). Theme: currentColor, so
   the dialog's category tint (cd-dark/cd-bright) applies automatically. */
(function () {
  const css = `
.cg-wrap { margin-top:4px; }
.cg-scroll { overflow:auto; max-height:300px; border:1px solid color-mix(in srgb, currentColor 25%, transparent); padding:8px; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, currentColor 45%, transparent) transparent; }
.cg-scroll::-webkit-scrollbar { width:8px; height:8px; }
.cg-scroll::-webkit-scrollbar-track { background:transparent; }
.cg-scroll::-webkit-scrollbar-thumb { background:color-mix(in srgb, currentColor 45%, transparent); border-radius:2px; }
.cg-canvas { position:relative; width:100%; box-sizing:border-box; }
.cg-edges { position:absolute; top:0; left:0; overflow:visible; pointer-events:none; z-index:0; }
.cg-cols { display:flex; flex-direction:column; gap:30px; align-items:stretch; position:relative; z-index:1; padding:36px 8px 24px 34px; }
.cg-col { display:flex; flex-direction:row; gap:40px; align-items:flex-start; }
.cg-node { position:relative; flex:1; box-sizing:border-box; border:1px solid color-mix(in srgb, currentColor 45%, transparent); border-radius:5px; padding:6px 8px; background:color-mix(in srgb, currentColor 7%, transparent); }
.cg-node.active { border-color:currentColor; border-width:2px; padding:5px 7px; }
.cg-node.done { opacity:0.5; }
.cg-node.event { background:color-mix(in srgb, currentColor 16%, transparent); border-style:dashed; }
.cg-node.event .cg-label { font-weight:600; }
.cg-label { font-size:11px; line-height:1.35; outline:none; word-break:break-word; white-space:normal; cursor:text; }
.cg-label:focus { box-shadow:0 0 0 1px color-mix(in srgb, currentColor 50%, transparent); border-radius:2px; }
.cg-node.done .cg-label { text-decoration:line-through; }
.cg-meta { font-size:11px; opacity:0.55; margin-top:3px; display:flex; align-items:center; gap:2px; flex-wrap:nowrap; }
.cg-est-unit { display:inline-flex; align-items:center; white-space:nowrap; }
/* scope under .cd-box so the width rules beat .cd-box input width:100% (equal
   specificity + later source would otherwise win). Font is intentionally left to
   .cd-box input (16px) so the time/est boxes match the dialog's other inputs. */
.cd-box .cg-meta input { color:inherit; background:color-mix(in srgb, currentColor 10%, transparent); border:1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius:2px; padding:0 2px; box-sizing:border-box; }
.cg-meta input:focus { outline:1px solid color-mix(in srgb, currentColor 55%, transparent); }
.cd-box .cg-time { width:8ch; text-align:center; }
.cd-box .cg-est { width:4ch; text-align:right; -moz-appearance:textfield; }
.cg-est::-webkit-outer-spin-button, .cg-est::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.cg-node.active .cg-meta { opacity:0.95; }
.cg-ctl { position:absolute; top:50%; right:100%; margin-right:6px; transform:translateY(-50%); display:flex; flex-direction:column; gap:8px; line-height:1; z-index:2; }
.cg-circ { width:18px; height:18px; padding:0; border-radius:50%; border:1px solid color-mix(in srgb, currentColor 50%, transparent); background:color-mix(in srgb, currentColor 20%, transparent); color:inherit; font-family:inherit; font-size:13px; line-height:1; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:0.5; }
.cg-circ:hover { opacity:1; border-color:currentColor; }
.cg-edge { stroke:currentColor; stroke-opacity:0.32; fill:none; stroke-width:1.3; }
.cg-arrow { fill:currentColor; fill-opacity:0.32; }
.cg-add { position:absolute; transform:translate(-50%,-50%); z-index:3; }
.cg-hint { font-size:0.55rem; opacity:0.4; margin-top:5px; }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const SVGNS = 'http://www.w3.org/2000/svg';

  function startTime(node) {
    // When to start this step so it finishes by its deadline — the actionable
    // time (and when its nudge fires). For a travel step that's the depart time.
    if (!node.deadline) return '';
    const d = new Date(node.deadline.indexOf('T') >= 0 ? node.deadline : node.deadline + 'T00:00:00');
    if (isNaN(d)) return '';
    d.setMinutes(d.getMinutes() - (node.est_min || 0));
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
  }

  // A placed-today card's master start (dir_start_min). null otherwise — then the
  // step time stays the read-only deadline-derived value, estimate still editable.
  function masterStartOf(card) { return card.dir_start_min != null ? card.dir_start_min : null; }
  function workNodesOf(card) {
    const g = card.nudge && card.nudge.graph;
    return g && g.nodes ? g.nodes.filter(x => !x.is_event_start) : [];
  }
  // Same plan order + sequential default tiling as the HQ timeline, so the
  // dialog and the timeline agree on each step's start (offset from the master).
  function computeOffsets(card) {
    let acc = 0;
    workNodesOf(card).slice()
      .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || '') ||
        (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))
      .forEach(nd => {
        nd._dur = Math.max(10, nd.est_min || 15);
        nd._off = (nd.tl_offset != null) ? nd.tl_offset : acc;
        acc += nd._dur;
      });
  }
  // Lock every still-default step to an explicit offset so editing one step's time
  // or estimate never shifts the others (matches the timeline's freeze).
  function freezeOffsets(card) {
    computeOffsets(card);
    workNodesOf(card).forEach(nd => { if (nd.tl_offset == null) nd.tl_offset = nd._off; });
  }
  function parseClock(s) {
    if (!s) return null;
    const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = parseInt(m[1]);
    const mm = m[2] ? parseInt(m[2]) : 0;
    if (h > 23 || mm > 59) return null;
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return h * 60 + mm;
  }
  function fmtClock(min) {
    const v = ((min % 1440) + 1440) % 1440;
    const h = Math.floor(v / 60), mm = v % 60, ap = h < 12 ? 'am' : 'pm';
    let hh = h % 12; if (hh === 0) hh = 12;
    return `${hh}:${String(mm).padStart(2, '0')}${ap}`;
  }

  function prereqMap(edges) {
    const m = {};
    edges.forEach(e => (m[e.to] = m[e.to] || []).push(e.from));
    return m;
  }

  function firstOpen(nodes, edges) {
    const byId = {};
    nodes.forEach(n => { byId[n.id] = n; });
    const pre = prereqMap(edges);
    for (const n of nodes) {
      if (n.done) continue;   // the event block can be active — its start nudge
      if ((pre[n.id] || []).every(p => !byId[p] || byId[p].done)) return n.id;
    }
    return null;
  }

  function layerOf(nodes, edges) {
    const pre = prereqMap(edges);
    const depth = {};
    function d(id, seen) {
      if (id in depth) return depth[id];
      if (seen.has(id)) return 0;
      seen.add(id);
      const ps = pre[id] || [];
      depth[id] = ps.length ? Math.max(...ps.map(p => d(p, seen))) + 1 : 0;
      return depth[id];
    }
    nodes.forEach(n => d(n.id, new Set()));
    return depth;
  }

  // One step's box. ctx bundles the shared render state + the mutating callbacks
  // (recompute/draw/removeNode) so this can live outside renderCardGraph.
  function cgNodeEl(ctx, node) {
    const { n, card, onChange } = ctx;
    const box = document.createElement('div');
    box.className = 'cg-node' + (node.done ? ' done' : '') +
      (node.id === n.active_node ? ' active' : '') + (node.is_event_start ? ' event' : '');
    box.dataset.id = node.id;

    const label = document.createElement('div');
    label.className = 'cg-label';
    label.textContent = node.label;

    // The event anchor is fixed — no rename, no controls.
    if (!node.is_event_start) {
      const ctl = document.createElement('div');
      ctl.className = 'cg-ctl';
      const mk = (txt, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'cg-circ'; b.textContent = txt; b.title = title;
        b.addEventListener('mousedown', e => e.stopPropagation());
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        return b;
      };
      ctl.append(
        mk('✕', 'delete step', () => ctx.removeNode(node.id)),
        mk('+', 'insert a step after', () => {
          const succ = (ctx.n.graph.edges.find(e => e.from === node.id) || {}).to;
          if (succ) insertStep(ctx, node.id, succ);
        }),
      );
      label.contentEditable = 'true';
      label.addEventListener('keydown', e => {
        e.stopPropagation();                     // don't trigger the dialog's enter-to-save
        if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
      });
      label.addEventListener('blur', () => {
        const v = label.textContent.trim();
        if (v && v !== node.label) { node.label = v; if (typeof onChange === 'function') onChange(); }
        else label.textContent = node.label;
      });
      box.appendChild(ctl);
    }

    const meta = document.createElement('div');
    meta.className = 'cg-meta';
    if (node.is_event_start) {
      const t = startTime(node);
      meta.textContent = t ? 'starts ' + t : (node.est_min || '');
    } else {
      const master = masterStartOf(card);
      if (master != null) {
        // editable start time, stored as an offset from the master (dir_start_min)
        const ti = document.createElement('input');
        ti.className = 'cg-time';
        ti.value = fmtClock(master + (node._off || 0));
        ti.title = 'start time';
        ti.addEventListener('mousedown', e => e.stopPropagation());
        ti.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ti.blur(); } });
        ti.addEventListener('blur', () => {
          const mins = parseClock(ti.value);
          if (mins == null) { ti.value = fmtClock(master + (node._off || 0)); return; }
          let abs = mins; if (abs < 270) abs += 1440;   // before 4:30am = after-midnight slot (matches timeline day)
          freezeOffsets(card);
          node.tl_offset = abs - master;
          node._off = node.tl_offset;
          ti.value = fmtClock(master + node._off);
          if (typeof onChange === 'function') onChange();
        });
        meta.append(ti);
      } else {
        const t = startTime(node);
        if (t) meta.append(document.createTextNode(t));
      }
      // editable estimate (minutes)
      const di = document.createElement('input');
      di.className = 'cg-est';
      di.type = 'text';
      di.value = node.est_min || '';
      di.title = 'estimate — accepts 20, 10m, 2h, 1h30m';
      di.addEventListener('mousedown', e => e.stopPropagation());
      di.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); di.blur(); } });
      di.addEventListener('blur', () => {
        const v = parseDuration(di.value);
        if (!v || v < 1) { di.value = node.est_min || ''; return; }
        if (masterStartOf(card) != null) freezeOffsets(card);   // keep the others put
        node.est_min = v;
        node._dur = Math.max(10, v);
        di.value = v;                       // normalize "2h" -> 120 in the field
        if (typeof onChange === 'function') onChange();
      });
      const estUnit = document.createElement('span');
      estUnit.className = 'cg-est-unit';
      estUnit.append(di);
      meta.append(estUnit);
    }

    box.appendChild(label);
    if (meta.childNodes.length) box.appendChild(meta);
    return box;
  }

  // Insert a fresh step into the chain. fromId null = insert before `toId` (new
  // head); otherwise splice the fromId->toId edge into fromId->new->toId. The
  // chain stays linear. The new step is `active` and inline-renamable.
  let _stepSeq = 0;
  function insertStep(ctx, fromId, toId) {
    const g = ctx.n.graph;
    const nn = {
      id: 'n' + Date.now().toString(36) + (_stepSeq++),
      label: 'new step', done: false, depth: 0, est_min: 10,
      created_at: new Date().toISOString(),
    };
    g.nodes.push(nn);
    if (fromId != null) {
      const e = g.edges.find(x => x.from === fromId && x.to === toId);
      if (e) e.to = nn.id; else g.edges.push({ from: fromId, to: nn.id });
      g.edges.push({ from: nn.id, to: toId });
    } else {
      g.edges.push({ from: nn.id, to: toId });
    }
    ctx.recompute();   // active_node + persist via onChange
    ctx.draw();
  }

  // Lay out the layered DAG (HTML nodes + SVG edges) into ctx.container.
  function cgDraw(ctx) {
    const { n, card, container } = ctx;
    computeOffsets(card);   // refresh each step's default/explicit timeline offset
    const nodes = n.graph.nodes, edges = n.graph.edges;
    const depth = layerOf(nodes, edges);
    const maxL = Math.max(0, ...nodes.map(x => depth[x.id]));

    container.innerHTML = '<div class="cg-wrap"><div class="cg-scroll"><div class="cg-canvas">' +
      '<svg class="cg-edges"></svg><div class="cg-cols"></div></div></div>' +
      '<div class="cg-hint">click a step to rename · ✕ delete · + insert a step</div></div>';
    const cols = container.querySelector('.cg-cols');
    const elById = {};
    for (let L = 0; L <= maxL; L++) {
      const col = document.createElement('div');
      col.className = 'cg-col';
      nodes.filter(x => depth[x.id] === L).forEach(x => { const e = cgNodeEl(ctx, x); elById[x.id] = e; col.appendChild(e); });
      cols.appendChild(col);
    }

    // edges: right-center of `from` -> left-center of `to`, measured post-layout
    const canvas = container.querySelector('.cg-canvas');
    const svg = container.querySelector('.cg-edges');
    svg.setAttribute('width', canvas.scrollWidth);
    svg.setAttribute('height', canvas.scrollHeight);
    svg.innerHTML = '<defs><marker id="cg-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path class="cg-arrow" d="M0,0 L8,4 L0,8 z"/></marker></defs>';
    // A "+" button at (x,y) over the canvas: click to insert a step there.
    const addInsert = (x, y, fromId, toId, title) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cg-circ cg-add';
      btn.textContent = '+';
      btn.title = title || 'insert a step here';
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.addEventListener('mousedown', ev => ev.stopPropagation());
      btn.addEventListener('click', ev => { ev.stopPropagation(); insertStep(ctx, fromId, toId); });
      canvas.appendChild(btn);
    };
    edges.forEach(e => {
      const a = elById[e.from], b = elById[e.to];
      if (!a || !b) return;
      // top-down: bottom-center of `from` -> top-center of `to`. Stop short of
      // the target's top edge so the arrowhead sits in the gap, not hidden under
      // the HTML node (which paints above the edge svg).
      const x1 = a.offsetLeft + a.offsetWidth / 2, y1 = a.offsetTop + a.offsetHeight;
      const x2 = b.offsetLeft + b.offsetWidth / 2, y2 = b.offsetTop - 7;
      const my = (y1 + y2) / 2;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('class', 'cg-edge');
      path.setAttribute('marker-end', 'url(#cg-arr)');
      path.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
      svg.appendChild(path);
    });

    // Entry arrow pointing into the head step (the chain's start), with a "+"
    // above it to insert a step before the start. Per-step inserts live in each
    // node's left control stack (✕ over +). Head = the node nothing points to.
    const incoming = new Set(edges.map(e => e.to));
    const head = nodes.find(x => !x.is_event_start && !incoming.has(x.id));
    if (head && elById[head.id]) {
      const h = elById[head.id];
      const hx = h.offsetLeft + h.offsetWidth / 2, hy = h.offsetTop;
      const ep = document.createElementNS(SVGNS, 'path');
      ep.setAttribute('class', 'cg-edge');
      ep.setAttribute('marker-end', 'url(#cg-arr)');
      ep.setAttribute('d', `M${hx},${hy - 30} L${hx},${hy - 7}`);
      svg.appendChild(ep);
      addInsert(hx, hy - 30, null, head.id, 'insert a step before the start');
    }

    // Autoscroll to the next unfinished (active) step.
    const scroll = container.querySelector('.cg-scroll');
    const target = elById[n.active_node];
    if (target) {
      scroll.scrollTo({
        left: Math.max(0, target.offsetLeft - scroll.clientWidth / 2 + target.offsetWidth / 2),
        top: Math.max(0, target.offsetTop - scroll.clientHeight / 2 + target.offsetHeight / 2),
      });
    }
  }

  window.renderCardGraph = function (container, card, onChange) {
    const n = card.nudge;
    if (!n || !n.graph || !n.graph.nodes) { container.innerHTML = ''; return; }
    const ctx = { n, card, container, onChange };
    ctx.recompute = () => {
      n.active_node = firstOpen(n.graph.nodes, n.graph.edges);
      if (typeof onChange === 'function') onChange();
    };
    ctx.removeNode = (id) => {
      const edges = n.graph.edges;
      const pres = edges.filter(e => e.to === id).map(e => e.from);
      const deps = edges.filter(e => e.from === id).map(e => e.to);
      n.graph.edges = edges.filter(e => e.from !== id && e.to !== id);
      pres.forEach(p => deps.forEach(d2 => {
        if (!n.graph.edges.some(e => e.from === p && e.to === d2)) n.graph.edges.push({ from: p, to: d2 });
      }));
      n.graph.nodes = n.graph.nodes.filter(x => x.id !== id);
      ctx.recompute(); cgDraw(ctx);
    };
    ctx.draw = () => cgDraw(ctx);
    cgDraw(ctx);
  };
})();
