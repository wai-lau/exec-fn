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
.cg-cols { display:flex; gap:34px; align-items:flex-start; position:relative; z-index:1; }
.cg-col { display:flex; flex-direction:column; gap:16px; }
.cg-node { width:150px; box-sizing:border-box; border:1px solid color-mix(in srgb, currentColor 45%, transparent); border-radius:5px; padding:6px 8px; background:color-mix(in srgb, currentColor 7%, transparent); }
.cg-node.active { border-color:currentColor; border-width:2px; padding:5px 7px; }
.cg-node.done { opacity:0.5; }
.cg-label { font-size:11px; line-height:1.35; outline:none; word-break:break-word; white-space:normal; cursor:text; }
.cg-label:focus { box-shadow:0 0 0 1px color-mix(in srgb, currentColor 50%, transparent); border-radius:2px; }
.cg-node.done .cg-label { text-decoration:line-through; }
.cg-meta { font-size:9px; opacity:0.55; margin-top:3px; }
.cg-node.active .cg-meta { opacity:0.95; }
.cg-btns { display:flex; gap:9px; margin-top:5px; }
.cg-mini { background:none; border:none; color:inherit; cursor:pointer; font-family:inherit; font-size:0.62rem; opacity:0.5; padding:0; }
.cg-mini:hover { opacity:1; }
.cg-edge { stroke:currentColor; stroke-opacity:0.32; fill:none; stroke-width:1.3; }
.cg-arrow { fill:currentColor; fill-opacity:0.32; }
.cg-hint { font-size:0.55rem; opacity:0.4; margin-top:5px; }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const SVGNS = 'http://www.w3.org/2000/svg';

  function fmtDeadline(iso) {
    if (!iso) return '';
    const d = new Date(iso.indexOf('T') >= 0 ? iso : iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
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
      if (n.done) continue;
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

  window.renderCardGraph = function (container, card, onChange) {
    const n = card.nudge;
    if (!n || !n.graph || !n.graph.nodes) { container.innerHTML = ''; return; }

    function recompute() {
      n.active_node = firstOpen(n.graph.nodes, n.graph.edges);
      if (typeof onChange === 'function') onChange();
    }

    function removeNode(id) {
      const edges = n.graph.edges;
      const pres = edges.filter(e => e.to === id).map(e => e.from);
      const deps = edges.filter(e => e.from === id).map(e => e.to);
      n.graph.edges = edges.filter(e => e.from !== id && e.to !== id);
      pres.forEach(p => deps.forEach(d2 => {
        if (!n.graph.edges.some(e => e.from === p && e.to === d2)) n.graph.edges.push({ from: p, to: d2 });
      }));
      n.graph.nodes = n.graph.nodes.filter(x => x.id !== id);
      recompute(); draw();
    }

    function addAfter(afterId) {
      const id = 'ui-' + Date.now().toString(36) + '-' + n.graph.nodes.length;
      n.graph.nodes.push({ id, label: 'new step', done: false, depth: 0, created_at: '', est_min: 5 });
      n.graph.edges.push({ from: afterId, to: id });
      recompute(); draw(id);
    }

    function nodeEl(node) {
      const box = document.createElement('div');
      box.className = 'cg-node' + (node.done ? ' done' : '') + (node.id === n.active_node ? ' active' : '');
      box.dataset.id = node.id;

      const label = document.createElement('div');
      label.className = 'cg-label';
      label.contentEditable = 'true';
      label.textContent = node.label;
      label.addEventListener('keydown', e => {
        e.stopPropagation();                       // don't trigger the dialog's enter-to-save
        if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
      });
      label.addEventListener('blur', () => {
        const v = label.textContent.trim();
        if (v && v !== node.label) { node.label = v; if (typeof onChange === 'function') onChange(); }
        else label.textContent = node.label;
      });

      const meta = document.createElement('div');
      meta.className = 'cg-meta';
      const dl = fmtDeadline(node.deadline);
      meta.textContent = [dl ? 'by ' + dl : '', node.est_min ? node.est_min + 'm' : ''].filter(Boolean).join('  ·  ');

      const btns = document.createElement('div');
      btns.className = 'cg-btns';
      const mk = (txt, fn) => { const b = document.createElement('button'); b.className = 'cg-mini'; b.textContent = txt; b.addEventListener('click', fn); return b; };
      btns.append(
        mk(node.done ? 'undo' : 'done', () => { node.done = !node.done; recompute(); draw(); }),
        mk('+ after', () => addAfter(node.id)),
        mk('delete', () => removeNode(node.id)),
      );

      box.append(label, meta);
      if (meta.textContent) meta.style.display = ''; else meta.style.display = 'none';
      box.append(btns);
      return box;
    }

    function draw(focusId) {
      const nodes = n.graph.nodes, edges = n.graph.edges;
      const depth = layerOf(nodes, edges);
      const maxL = Math.max(0, ...nodes.map(x => depth[x.id]));

      container.innerHTML = '<div class="cg-wrap"><div class="cg-scroll"><div class="cg-canvas">' +
        '<svg class="cg-edges"></svg><div class="cg-cols"></div></div></div>' +
        '<div class="cg-hint">click a step to rename · done / + after / delete</div></div>';
      const cols = container.querySelector('.cg-cols');
      const elById = {};
      for (let L = 0; L <= maxL; L++) {
        const col = document.createElement('div');
        col.className = 'cg-col';
        nodes.filter(x => depth[x.id] === L).forEach(x => { const e = nodeEl(x); elById[x.id] = e; col.appendChild(e); });
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
        const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
        const mx = (x1 + x2) / 2;
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('class', 'cg-edge');
        path.setAttribute('marker-end', 'url(#cg-arr)');
        path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        svg.appendChild(path);
      });

      // Autoscroll to the next unfinished step (or a freshly added node).
      const scroll = container.querySelector('.cg-scroll');
      const target = (focusId && elById[focusId]) || elById[n.active_node];
      if (target) {
        scroll.scrollTo({
          left: Math.max(0, target.offsetLeft - scroll.clientWidth / 2 + target.offsetWidth / 2),
          top: Math.max(0, target.offsetTop - scroll.clientHeight / 2 + target.offsetHeight / 2),
        });
      }
      if (focusId && elById[focusId]) {
        const lbl = elById[focusId].querySelector('.cg-label');
        lbl.focus();
        const r = document.createRange(); r.selectNodeContents(lbl);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    }

    draw();
  };
})();
