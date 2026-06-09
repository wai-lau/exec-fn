/* Card breakdown graph — SVG layered DAG for card.nudge.graph.
   Used inside the card dialog (card-dialog.js). Mutates card.nudge in place;
   the dialog's save persists via PATCH /api/rd. Theme: currentColor, so the
   dialog's category tint (cd-dark/cd-bright) applies automatically. */
(function () {
  const css = `
.cg-wrap { margin-top:4px; }
.cg-scroll { overflow:auto; max-height:190px; border:1px solid rgba(127,127,127,0.25); padding:6px; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, currentColor 45%, transparent) transparent; }
.cg-scroll::-webkit-scrollbar { width:8px; height:8px; }
.cg-scroll::-webkit-scrollbar-track { background:transparent; }
.cg-scroll::-webkit-scrollbar-thumb { background:color-mix(in srgb, currentColor 45%, transparent); border-radius:2px; }
.cg-svg { display:block; }
.cg-node { cursor:pointer; }
.cg-node rect { fill:rgba(127,127,127,0.08); stroke:currentColor; stroke-opacity:0.45; stroke-width:1; rx:5; }
.cg-node text { fill:currentColor; fill-opacity:0.8; font-size:11px; font-family:inherit; }
.cg-node text.cg-meta { fill-opacity:0.6; font-size:9px; }
.cg-node.active text.cg-meta { fill-opacity:0.95; }
.cg-node.done rect { stroke-opacity:0.18; }
.cg-node.done text { fill-opacity:0.32; text-decoration:line-through; }
.cg-node.active rect { stroke-opacity:1; stroke-width:2; }
.cg-node.active text { fill-opacity:1; }
.cg-node.sel rect { stroke-dasharray:4 3; stroke-opacity:1; }
.cg-edge { stroke:currentColor; stroke-opacity:0.3; fill:none; stroke-width:1.2; }
.cg-arrow { fill:currentColor; fill-opacity:0.3; }
.cg-edit { display:flex; gap:6px; margin-top:6px; align-items:center; }
.cg-edit input { flex:1; min-width:0; }
.cg-btn { background:none; border:1px solid currentColor; color:inherit; opacity:0.65; font-family:inherit; font-size:0.65rem; padding:2px 8px; cursor:pointer; white-space:nowrap; }
.cg-btn:hover { opacity:1; }
.cg-hint { font-size:0.55rem; opacity:0.4; margin-top:4px; }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const COL_W = 158, ROW_H = 50, NODE_W = 132, NODE_H = 38, PAD = 8;

  function fmtDeadline(iso) {
    if (!iso) return '';
    var d = new Date(iso.indexOf('T') >= 0 ? iso : iso + 'T00:00:00');
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
      if (seen.has(id)) return 0;            // cycle guard
      seen.add(id);
      const ps = pre[id] || [];
      depth[id] = ps.length ? Math.max(...ps.map(p => d(p, seen))) + 1 : 0;
      return depth[id];
    }
    nodes.forEach(n => d(n.id, new Set()));
    return depth;
  }

  function trunc(s, max) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  window.renderCardGraph = function (container, card, onChange) {
    const n = card.nudge;
    if (!n || !n.graph || !n.graph.nodes) { container.innerHTML = ''; return; }
    let selId = null;

    function mutateAndRedraw() {
      n.active_node = firstOpen(n.graph.nodes, n.graph.edges);
      if (typeof onChange === 'function') onChange();
      draw();
    }

    function removeNode(id) {
      const edges = n.graph.edges;
      const pres = edges.filter(e => e.to === id).map(e => e.from);
      const deps = edges.filter(e => e.from === id).map(e => e.to);
      n.graph.edges = edges.filter(e => e.from !== id && e.to !== id);
      // bridge: every prereq -> every dependent (skip dupes)
      pres.forEach(p => deps.forEach(d2 => {
        if (!n.graph.edges.some(e => e.from === p && e.to === d2)) {
          n.graph.edges.push({ from: p, to: d2 });
        }
      }));
      n.graph.nodes = n.graph.nodes.filter(x => x.id !== id);
      if (selId === id) selId = null;
      mutateAndRedraw();
    }

    function addNode(afterId) {
      const id = 'ui-' + Date.now().toString(36) + '-' + n.graph.nodes.length;
      const node = { id, label: 'new step', done: false, depth: 0, created_at: '' };
      if (afterId) {
        n.graph.edges.push({ from: afterId, to: id });
      } else {
        // no selection: append as the final step (after all current sinks)
        const sinks = n.graph.nodes
          .filter(x => !n.graph.edges.some(e => e.from === x.id))
          .map(x => x.id);
        sinks.forEach(s => n.graph.edges.push({ from: s, to: id }));
      }
      n.graph.nodes.push(node);
      selId = id;
      mutateAndRedraw();
    }

    function draw() {
      const nodes = n.graph.nodes, edges = n.graph.edges;
      const depth = layerOf(nodes, edges);
      const cols = {};
      nodes.forEach(x => { (cols[depth[x.id]] = cols[depth[x.id]] || []).push(x); });
      const pos = {};
      Object.keys(cols).forEach(L => {
        cols[L].forEach((x, i) => {
          pos[x.id] = { x: PAD + L * COL_W, y: PAD + i * ROW_H };
        });
      });
      const maxL = Math.max(0, ...Object.keys(cols).map(Number));
      const maxRows = Math.max(1, ...Object.values(cols).map(a => a.length));
      const w = PAD * 2 + maxL * COL_W + NODE_W;
      const h = PAD * 2 + maxRows * ROW_H;

      let svg = `<svg class="cg-svg" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
      svg += `<defs><marker id="cg-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path class="cg-arrow" d="M0,0 L8,4 L0,8 z"/></marker></defs>`;
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
        const x2 = b.x, y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        svg += `<path class="cg-edge" marker-end="url(#cg-arr)" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      });
      nodes.forEach(x => {
        const p = pos[x.id];
        const cls = ['cg-node', x.done ? 'done' : '', x.id === n.active_node ? 'active' : '', x.id === selId ? 'sel' : ''].join(' ');
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const dl = fmtDeadline(x.deadline);
        const meta = [dl ? 'by ' + dl : '', x.est_min ? x.est_min + 'm' : ''].filter(Boolean).join('  ');
        svg += `<g class="${cls}" data-id="${x.id}">`;
        svg += `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="5"/>`;
        svg += `<text x="${p.x + 8}" y="${p.y + 15}">${esc(trunc(x.label, 18))}</text>`;
        if (meta) svg += `<text class="cg-meta" x="${p.x + 8}" y="${p.y + 29}">${esc(meta)}</text>`;
        svg += `<title>${esc(x.label)}${dl ? ' — by ' + dl : ''}</title></g>`;
      });
      svg += '</svg>';

      const sel = nodes.find(x => x.id === selId);
      container.innerHTML = `
<div class="cg-wrap">
  <div class="cg-scroll">${svg}</div>
  ${sel ? `
  <div class="cg-edit">
    <input id="cg-label" type="text" value="${sel.label.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
    <button class="cg-btn" id="cg-done">${sel.done ? 'undone' : 'done'}</button>
    <button class="cg-btn" id="cg-add-after">+after</button>
    <button class="cg-btn" id="cg-del">del</button>
  </div>` : `
  <div class="cg-edit"><button class="cg-btn" id="cg-add">+ step</button></div>`}
  <div class="cg-hint">click a step to edit · bold border = next up · saved on save</div>
</div>`;

      container.querySelectorAll('.cg-node').forEach(g => {
        g.addEventListener('click', () => {
          selId = selId === g.dataset.id ? null : g.dataset.id;
          draw();
        });
      });
      const lbl = container.querySelector('#cg-label');
      if (lbl) {
        lbl.addEventListener('change', () => {
          const node = n.graph.nodes.find(x => x.id === selId);
          if (node && lbl.value.trim()) { node.label = lbl.value.trim(); draw(); }
        });
      }
      const bind = (id, fn) => {
        const el = container.querySelector(id);
        if (el) el.addEventListener('click', fn);
      };
      bind('#cg-done', () => {
        const node = n.graph.nodes.find(x => x.id === selId);
        if (node) { node.done = !node.done; mutateAndRedraw(); }
      });
      bind('#cg-del', () => removeNode(selId));
      bind('#cg-add-after', () => addNode(selId));
      bind('#cg-add', () => addNode(null));
    }

    draw();
  };
})();
