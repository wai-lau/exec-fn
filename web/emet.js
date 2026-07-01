// emet MCP test harness -- owner-only. Wraps recall/scope/ask over the
// same-origin JSON routes (api/routes_emet.py), which proxy the home-box MCP.
// Vanilla; results built as DOM (textContent) so observation prose can't inject.
'use strict';

async function postJSON(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function offlineNote(out) {
  out.replaceChildren(el('div', 'emet-offline', 'emet home box offline'));
}

function nodeCard(node) {
  const card = el('div', 'emet-node');
  const head = el('div', 'emet-node-head');
  head.appendChild(el('span', 'emet-node-label', node.label || node.id));
  head.appendChild(el('span', 'emet-node-id', node.id));
  card.appendChild(head);
  const obs = node.observations || [];
  if (!obs.length) {
    card.appendChild(el('div', 'emet-empty', 'no public observations'));
    return card;
  }
  const ul = el('ul', 'emet-obs');
  for (const o of obs) {
    const li = el('li');
    li.appendChild(el('span', 'emet-priv', 'p' + o.privacy));
    li.appendChild(el('span', 'emet-obs-text', o.text));
    ul.appendChild(li);
  }
  card.appendChild(ul);
  return card;
}

function renderNodes(out, data, emptyMsg) {
  out.replaceChildren();
  if (data.unreachable) { offlineNote(out); return; }
  if (data.error === 'not_found') {
    out.appendChild(el('div', 'emet-empty', 'node not found'));
    return;
  }
  if ('matched' in data && data.matched === null) {
    out.appendChild(el('div', 'emet-empty', 'no match for that topic'));
    return;
  }
  if (data.matched) out.appendChild(el('div', 'emet-matched', 'matched: ' + data.matched));
  const nodes = data.nodes || [];
  if (!nodes.length) {
    out.appendChild(el('div', 'emet-empty', emptyMsg || 'nothing returned'));
  } else {
    for (const n of nodes) out.appendChild(nodeCard(n));
  }
  if (data.truncated) out.appendChild(el('div', 'emet-capped', 'results capped'));
}

function renderAsk(out, data) {
  out.replaceChildren();
  if (data.unreachable) { offlineNote(out); return; }
  const status = data.status || 'ok';
  // class stays kebab-case (stylelint); the badge still shows the raw status.
  out.appendChild(el('span', 'emet-badge badge-' + status.replace(/_/g, '-'), status));
  if (status === 'llm_offline') {
    out.appendChild(el('div', 'emet-note', 'home GPU busy with TTS -- local LLM offline; try again later'));
  } else if (status === 'no_context') {
    out.appendChild(el('div', 'emet-empty', 'no matching context for that question'));
  } else if (data.answer) {
    out.appendChild(el('div', 'emet-answer', data.answer));
  } else {
    out.appendChild(el('div', 'emet-empty', 'no answer'));
  }
}

function wire(formId, handler) {
  const form = document.getElementById(formId);
  const out = document.getElementById(form.dataset.out);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.replaceChildren(el('div', 'emet-empty', '...'));
    try {
      await handler(form, out);
    } catch (err) {
      out.replaceChildren(el('div', 'emet-offline', 'request failed'));
    }
  });
}

wire('form-recall', async (form, out) => {
  const data = await postJSON('/api/emet/recall', { topic: form.topic.value.trim() });
  renderNodes(out, data, 'no nodes');
});

wire('form-scope', async (form, out) => {
  const data = await postJSON('/api/emet/scope', {
    node_id: form.node_id.value.trim(),
    hops: parseInt(form.hops.value, 10) || 1,
  });
  renderNodes(out, data, 'no neighbours');
});

wire('form-ask', async (form, out) => {
  const data = await postJSON('/api/emet/ask', {
    question: form.question.value.trim(),
    topic: form.topic.value.trim(),
  });
  renderAsk(out, data);
});
