/* The Exec panel's message primitives — the pieces that need no panel state.
 *
 * Split out of exec-bubble.js for the 500-line cap. addMsg() stays there: it
 * reaches into the panel's closure (sendText, the unread counters, the choice
 * rows). These four do not, so they take the little they use and live here.
 *
 * Loaded before exec-bubble.js, same global scope — mdHtml() comes from
 * exec-bubble-assets.js the same way.
 */
'use strict';

// A tapped answer is sent behind a reference to the question it answers
// (exec-choices.answerRef) so several open questions can be answered in any
// order. It is addressed to the MODEL, so the panel shows only the human half
// — `re: "Packed yet?"` — and never the raw card id, which is noise to Wai and
// the one thing Exec itself is told never to print.
const EXEC_REF_RE = /^\[answering:(?: "([^"]*)")?(?: card=\S+?)?\]\s*/;

// Trailing space inside the chip, so the gap survives without touching the
// shared .msg-ts rule (which /mtg and /cc render too).
function execChip(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text + ' ';
  return s;
}

function execRenderUserBody(body, text) {
  const ts = text.match(/^(\[\S+ \S+ ET\])\s*/);
  if (ts) { body.appendChild(execChip('msg-ts', ts[1])); text = text.slice(ts[0].length); }
  const ref = text.match(EXEC_REF_RE);
  if (ref) {
    if (ref[1]) body.appendChild(execChip('msg-ref', 're: “' + ref[1] + '”'));
    text = text.slice(ref[0].length);
  }
  const rest = document.createElement('span');
  rest.innerHTML = mdHtml(text);
  body.appendChild(rest);
}

function execFmtTs() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
  return '[' + get('day') + '/' + get('month') + ' ' + get('hour') + ':' + get('minute') + ' ET]';
}
