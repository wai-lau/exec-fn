const LS_SPREAD = 'tarot.spread';
const LS_MESSAGES = 'tarot.messages';
const LS_SIG = 'tarot.significator';

const COURT_RANKS = ['page', 'knight', 'queen', 'king'];
const COURT_RANK_LABEL = {page: 'Page', knight: 'Knight', queen: 'Queen', king: 'King'};
const COURT_SUITS = ['cups', 'wands', 'swords', 'pentacles'];
const COURT_SUIT_LABEL = {cups: 'Cups', wands: 'Wands', swords: 'Swords', pentacles: 'Pentacles'};

function courtList() {
  const out = [];
  for (const rank of COURT_RANKS) {
    for (const suit of COURT_SUITS) {
      const id = `${rank}_of_${suit}`;
      const name = `${COURT_RANK_LABEL[rank]} of ${COURT_SUIT_LABEL[suit]}`;
      out.push({card_id: id, name, image: `/tarot/cards/${id}.jpg`});
    }
  }
  return out;
}

let spread = JSON.parse(localStorage.getItem(LS_SPREAD) || 'null');
let messages = JSON.parse(localStorage.getItem(LS_MESSAGES) || '[]');
let significator = JSON.parse(localStorage.getItem(LS_SIG) || 'null');
let spreadsMeta = null;
let streaming = false;

const terminal = document.getElementById('terminal');
const spreadEmpty = document.getElementById('spread-empty');
const sigCard = document.getElementById('sig-card');
const phaseDebug = document.getElementById('phase-debug');
const eventDebug = document.getElementById('event-debug');
const cardZoom = document.getElementById('card-zoom');
const cardZoomImg = cardZoom.querySelector('img');
const cardZoomLabel = cardZoom.querySelector('.zoom-label');

const FRAME_LABELS = {
  past_present_future:       { past:'Past',      present:'Present',  future:'Future'  },
  situation_obstacle_advice: { past:'Situation', present:'Obstacle', future:'Advice'  },
};
function framePosLabel(positionKey) {
  const frame = (spread && spread.frame) || 'past_present_future';
  return FRAME_LABELS[frame]?.[positionKey];
}

// Remove a trailing flip-invite ("When you're ready, turn the **Past**.") that
// the reader appended to the deal turn against the prompt's ban — the frontend
// prints the canonical invite itself in drawSpread.
function stripDealInvite(t) {
  return t.replace(
    /\n+\s*(when you'?re ready[,.]?\s*)?(go ahead and\s+)?turn the\s+\*{0,2}[\w][\w ]*\*{0,2}\s*[.?!]*\s*$/i,
    ''
  ).trimEnd();
}

function currentPhase() {
  if (!significator) return ['1', 'baseline'];
  if (!spread) return ['2', 'query'];
  const flipped = spread.cards.filter(c => c.flipped).length;
  const total = spread.cards.length;
  if (flipped === 0) return ['3', 'encounter'];
  if (flipped < total) {
    const last = spread.cards.filter(c => c.flipped).slice(-1)[0];
    const label = framePosLabel(last.position) || last.position;
    return [`4 (${flipped}/${total})`, label.toLowerCase()];
  }
  return ['5', 'interlinked'];
}

function renderPhaseDebug() {
  const [num, label] = currentPhase();
  phaseDebug.textContent = `phase ${num} — ${label}`;
}

function sigLocked() {
  return !!(spread && spread.cards && spread.cards.some(c => c.flipped));
}

function renderSigCard() {
  sigCard.classList.toggle('set', !!significator);
  if (significator) {
    sigCard.innerHTML = `<img src="${significator.image}" alt="${significator.name}">`;
  } else {
    sigCard.innerHTML = '';
  }
  renderPhaseDebug();
}
const renderSigSlot = renderSigCard;

marked.use({ breaks: true });
function renderText(raw) { return marked.parse(raw); }

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'assistant' || role === 'user') {
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = renderText(text);
    div.appendChild(body);
  } else {
    div.textContent = text;
  }
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
  return div;
}

function addStreamDiv() {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const cur = document.createElement('span');
  cur.className = 'reader-cursor';
  body.appendChild(cur);
  div.appendChild(body);
  terminal.appendChild(div);
  return {div, body, cur};
}

async function loadSpreadsMeta() {
  if (spreadsMeta) return spreadsMeta;
  const r = await fetch('/api/tarot/spreads');
  spreadsMeta = await r.json();
  return spreadsMeta;
}

const spreadGrid = document.getElementById('spread-grid');
const SPREAD_GRID_COLUMN = {past: 3, present: 4, future: 5};

function clearSpreadCards() {
  for (const el of spreadGrid.querySelectorAll('.tarot-card')) el.remove();
}

function nextPosition() {
  if (!spread || !spread.cards) return null;
  const next = spread.cards.find(c => !c.flipped);
  return next ? next.position : null;
}

function updateInputBarVisibility() {
  // input stays visible at all times — including while the reader speaks and
  // during the card-turning phase. The streaming send-guard still blocks
  // submits mid-stream.
  const wasHidden = document.body.classList.contains('no-input');
  document.body.classList.remove('no-input');
  // while the reader speaks, no card should beckon to be flipped
  document.body.classList.toggle('reader-speaking', streaming);
  if (wasHidden) {
    // input just reappeared: re-pin scroll to the last line and grab focus
    requestAnimationFrame(() => { terminal.scrollTop = terminal.scrollHeight; });
    focusInput();
  }
}

function renderSpread() {
  updateInputBarVisibility();
  clearSpreadCards();
  if (!spread || !spread.cards) {
    spreadEmpty.style.display = '';
    return;
  }
  spreadEmpty.style.display = 'none';
  const meta = spreadsMeta && spreadsMeta[spread.type];
  if (!meta) return;
  const posByKey = Object.fromEntries(meta.positions.map(p => [p.key, p]));
  const nextKey = nextPosition();
  for (const card of spread.cards) {
    const pos = posByKey[card.position];
    if (!pos) continue;
    const isNext = !card.flipped && card.position === nextKey;
    const isLocked = !card.flipped && !isNext;
    const el = document.createElement('div');
    el.className = 'tarot-card';
    el.dataset.position = card.position;
    el.dataset.cardId = card.card_id;
    el.dataset.flipped = card.flipped ? 'true' : 'false';
    el.dataset.reversed = card.reversed ? 'true' : 'false';
    el.dataset.next = isNext ? 'true' : 'false';
    el.dataset.locked = isLocked ? 'true' : 'false';
    el.style.gridColumn = SPREAD_GRID_COLUMN[card.position] || 'auto';
    const rot = (pos.rotate || 0) + ((card.flipped && card.reversed) ? 180 : 0);
    if (rot) el.style.transform = `rotate(${rot}deg)`;

    const back = document.createElement('img');
    back.className = 'back'; back.src = '/tarot/card_back.jpg?v=6'; back.alt = '';
    el.appendChild(back);
    const face = document.createElement('img');
    face.className = 'face'; face.src = card.image; face.alt = card.name;
    el.appendChild(face);

    const label = document.createElement('div');
    label.className = 'card-label';
    const posLabel = framePosLabel(card.position) || pos.label;
    label.innerHTML = `<span>${posLabel}</span><span class="card-name">${card.name}${card.reversed ? ' (rev)' : ''}</span>`;
    el.appendChild(label);

    if (isNext || card.flipped) el.addEventListener('click', () => flipCard(card.position));
    spreadGrid.appendChild(el);
  }
  renderPhaseDebug();
}

async function flipCard(positionKey) {
  if (!spread) return;
  const card = spread.cards.find(c => c.position === positionKey);
  if (!card) return;
  if (card.flipped) {
    // Already revealed → zoom it
    const meta = spreadsMeta && spreadsMeta[spread.type];
    const fallback = (meta && meta.positions.find(p => p.key === card.position)?.label) || card.position;
    const posLabel = framePosLabel(card.position) || fallback;
    openZoom(card.image, card.name + (card.reversed ? ' (reversed)' : ''), posLabel, card.reversed);
    return;
  }
  if (streaming) return;
  if (positionKey !== nextPosition()) return;
  const wasLocked = sigLocked();
  card.flipped = true;
  localStorage.setItem(LS_SPREAD, JSON.stringify(spread));
  renderSpread();
  if (!wasLocked) renderSigCard();
  const meta = spreadsMeta && spreadsMeta[spread.type];
  const fallback = (meta && meta.positions.find(p => p.key === card.position)?.label) || card.position;
  const posLabel = framePosLabel(card.position) || fallback;
  const orient = card.reversed ? 'reversed' : 'upright';
  openZoom(card.image, card.name + (card.reversed ? ' (reversed)' : ''), posLabel, card.reversed);
  // Fire the reader turn NOW — while the card is still maximized — so generation
  // + TTS overlap the time the querent spends looking at the card. The zoom is
  // dismissed by its own click listener (closeZoom), no longer gating this turn.
  await autoTrigger(`[turned **${posLabel}**: ${card.name}, ${orient}]`);
}

function openZoom(src, name, position, reversed) {
  cardZoomImg.src = src;
  cardZoomImg.alt = name;
  cardZoomImg.style.transform = reversed ? 'rotate(180deg)' : '';
  cardZoomLabel.innerHTML = `<strong>${name}</strong>${position ? `<br><span style="opacity:0.6">${position}</span>` : ''}`;
  cardZoom.classList.add('open');
  _msgInput.blur();
}

function closeZoom() {
  cardZoom.classList.remove('open');
  cardZoomImg.src = '';
  _msgInput.focus();
}

function addEventMsg(text) {
  if (text.startsWith('[opened /tarot')) {
    eventDebug.textContent = text;
    return;
  }
  const div = document.createElement('div');
  div.className = 'msg event';
  div.textContent = text;
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
}

async function autoTrigger(text, holdForGesture = null) {
  if (streaming) return;
  addEventMsg(text);
  messages.push({role: 'user', content: text});
  await streamResponse(holdForGesture);
}

async function drawSpread(type, frame = 'past_present_future') {
  if (spread) return;
  let drawn;
  try {
    const body = {spread_type: type};
    if (significator) body.significator_id = significator.card_id;
    const r = await fetch('/api/tarot/draw', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    drawn = await r.json();
  } catch (e) {
    alert('Draw failed: ' + e.message);
    return;
  }
  for (const c of drawn.cards) c.flipped = false;
  spread = drawn;
  spread.frame = frame;
  localStorage.setItem(LS_SPREAD, JSON.stringify(spread));
  await loadSpreadsMeta();
  renderSpread();
  renderSigSlot();
  const meta = spreadsMeta[spread.type];
  // Phase 3 is deterministic: record the deal as an event marker and print the
  // first-position flip invite ourselves. No model turn — the reader kept
  // duplicating this line against the prompt's hard ban, so the frontend owns it.
  const drewMarker = `[drew a ${meta?.label || spread.type} spread; ${spread.cards.length} cards face-down]`;
  addEventMsg(drewMarker);
  messages.push({role: 'user', content: drewMarker});
  const firstPos = spread.cards[0]?.position;
  const label = framePosLabel(firstPos) || firstPos;
  const invite = `When you're ready, turn the **${label}**.`;
  addMsg('assistant', invite);
  messages.push({role: 'assistant', content: invite});
  localStorage.setItem(LS_MESSAGES, JSON.stringify(messages));
  focusInput();
}


function filteredSpread() {
  const sig = significator ? {card_id: significator.card_id, name: significator.name} : null;
  if (!spread) return {type: null, revealed: [], face_down_positions: [], significator: sig};
  const revealed = spread.cards
    .filter(c => c.flipped)
    .map(c => ({position: c.position, card_id: c.card_id, name: c.name, reversed: c.reversed}));
  const face_down_positions = spread.cards.filter(c => !c.flipped).map(c => c.position);
  return {type: spread.type, revealed, face_down_positions, significator: sig};
}

async function sendMsg() {
  if (streaming) return;
  const input = document.getElementById('msg-input');
  const text = input.innerText.trim();
  if (!text) return;
  input.textContent = '';
  renderCaret();
  input.focus();
  addMsg('user', text);
  messages.push({role: 'user', content: text});
  await streamResponse();
}

