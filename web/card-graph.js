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
.cg-canvas { position:relative; width:max-content; }
.cg-edges { position:absolute; top:0; left:0; overflow:visible; pointer-events:none; z-index:0; }
.cg-cols { display:flex; gap:40px; align-items:flex-start; position:relative; z-index:1; padding-right:24px; }
.cg-col { display:flex; flex-direction:column; gap:16px; }
.cg-node { position:relative; width:150px; box-sizing:border-box; border:1px solid color-mix(in srgb, currentColor 45%, transparent); border-radius:5px; padding:6px 8px; background:color-mix(in srgb, currentColor 7%, transparent); }
.cg-node.active { border-color:currentColor; border-width:2px; padding:5px 7px; }
.cg-node.done { opacity:0.5; }
.cg-node.event { background:color-mix(in srgb, currentColor 16%, transparent); border-style:dashed; }
.cg-node.event .cg-label { font-weight:600; }
.cg-label { font-size:11px; line-height:1.35; outline:none; word-break:break-word; white-space:normal; cursor:text; }
.cg-label:focus { box-shadow:0 0 0 1px color-mix(in srgb, currentColor 50%, transparent); border-radius:2px; }
.cg-node.done .cg-label { text-decoration:line-through; }
.cg-meta { font-size:9px; opacity:0.55; margin-top:3px; display:flex; align-items:center; gap:2px; flex-wrap:nowrap; }
.cg-est-unit { display:inline-flex; align-items:center; white-space:nowrap; }
.cg-meta input { font:inherit; font-size:9px; color:inherit; background:color-mix(in srgb, currentColor 10%, transparent); border:1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius:2px; padding:0 2px; box-sizing:border-box; }
.cg-meta input:focus { outline:1px solid color-mix(in srgb, currentColor 55%, transparent); }
.cg-time { width:calc(7ch + 8px); text-align:center; }
.cg-est { width:30px; text-align:right; -moz-appearance:textfield; }
.cg-est::-webkit-outer-spin-button, .cg-est::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.cg-node.active .cg-meta { opacity:0.95; }
.cg-ctl { position:absolute; top:50%; left:100%; margin-left:6px; transform:translateY(-50%); display:flex; flex-direction:column; gap:8px; line-height:1; z-index:2; }
.cg-ic { background:none; border:none; color:inherit; cursor:pointer; font-family:inherit; font-size:0.78rem; opacity:0.4; padding:0; }
.cg-ic:hover { opacity:1; }
.cg-edge { stroke:currentColor; stroke-opacity:0.32; fill:none; stroke-width:1.3; }
.cg-arrow { fill:currentColor; fill-opacity:0.32; }
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
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
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
      const mk = (txt, title, fn) => { const b = document.createElement('button'); b.className = 'cg-ic'; b.textContent = txt; b.title = title; b.addEventListener('click', fn); return b; };
      ctl.append(
        mk('✓', node.done ? 'mark not done' : 'mark done', () => { node.done = !node.done; ctx.recompute(); ctx.draw(); }),
        mk('✕', 'delete step', () => ctx.removeNode(node.id)),
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
      const dur = node.est_min ? ' · ' + node.est_min + 'm' : '';
      meta.textContent = t ? 'starts ' + t + dur : (node.est_min ? node.est_min + 'm' : '');
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
        meta.append(ti, document.createTextNode(' · '));
      } else {
        const t = startTime(node);
        if (t) meta.append(document.createTextNode(t + '  ·  '));
      }
      // editable estimate (minutes)
      const di = document.createElement('input');
      di.className = 'cg-est';
      di.type = 'number';
      di.min = '1';
      di.value = node.est_min || '';
      di.title = 'minutes';
      di.addEventListener('mousedown', e => e.stopPropagation());
      di.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); di.blur(); } });
      di.addEventListener('blur', () => {
        const v = parseInt(di.value);
        if (!v || v < 1) { di.value = node.est_min || ''; return; }
        if (masterStartOf(card) != null) freezeOffsets(card);   // keep the others put
        node.est_min = v;
        node._dur = Math.max(10, v);
        if (typeof onChange === 'function') onChange();
      });
      const estUnit = document.createElement('span');
      estUnit.className = 'cg-est-unit';
      estUnit.append(di, document.createTextNode('m'));
      meta.append(estUnit);
    }

    box.appendChild(label);
    if (meta.childNodes.length) box.appendChild(meta);
    return box;
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
      '<div class="cg-hint">click a step to rename · ✓ done · ✕ delete · add steps via chat</div></div>';
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
    edges.forEach(e => {
      const a = elById[e.from], b = elById[e.to];
      if (!a || !b) return;
      const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
      // stop short of the target's left edge so the arrowhead sits in the gap,
      // not hidden under the HTML node (which paints above the edge svg).
      const x2 = b.offsetLeft - 7, y2 = b.offsetTop + b.offsetHeight / 2;
      const mx = (x1 + x2) / 2;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('class', 'cg-edge');
      path.setAttribute('marker-end', 'url(#cg-arr)');
      path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      svg.appendChild(path);
    });

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
