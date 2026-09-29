/* The Exec panel's transcript: what a message looks like, how the conversation
 * replays, and what sending does.
 *
 * Since 2026-09-29 the panel IS the agent page -- /cc folded into it, so
 * everything that page could do (tool lines with folded output, SVG diagrams,
 * pasted images, slash commands and the conversation picker, interrupt by
 * sending, the status bar) lives here, on top of what only the panel does
 * (nudges and monitor comments, answer buttons, card receipts).
 *
 * Shared global scope, like the rest of the exec-*.js family: loaded after the
 * modules it calls (exec-svg, exec-images, exec-toolout, exec-commands,
 * exec-sessions, exec-interrupt, exec-status) and before exec-stream.js and
 * exec-bubble.js, which call into it. exec-bubble.js sets `execTermEl` when it
 * builds the panel; nothing here runs before a user action or that build.
 */
'use strict';

let execTermEl = null;      // #exec-term, set by exec-bubble.js
let execPending = [];       // images pasted, not yet sent
let execStreaming = false;  // a turn is in flight
let execSending = false;    // mid-interrupt: a second send must not double-fire

function execAtBottom() {
  return execTermEl.scrollHeight - execTermEl.scrollTop - execTermEl.clientHeight < 60;
}

function execClamp(s, n) {
  n = n || 4000;
  return s.length > n ? s.slice(0, n) + ' …' : s;
}

/** Markdown with diagrams swapped in. `closed` limits the swap to blocks whose
 *  fence has arrived (the reveal passes it; a settled body does not). */
function execRender(body, text, closed) {
  body.innerHTML = mdHtml(text);
  execRenderSvgBlocks(body, closed);
}

/** One transcript line. `extra` is {cardId, images}.
 *
 * A trailing [a | b | c] row on an assistant reply or a nudge is stripped here
 * and rendered by exec-choices.js as buttons under the message; a reply names
 * its card IN the row (`[card=... | a | b]`), a nudge carries it in its payload,
 * and the payload's wins -- it is the one the server chose. */
function execAddMsg(role, text, extra) {
  extra = extra || {};
  const stick = execAtBottom();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  let cardId = extra.cardId;
  const parseable = role === 'probe' || role === 'assistant';
  const choices = parseable && window.execChoices ? execChoices.parse(text) : null;
  if (choices) { cardId = cardId || choices.cardId; text = choices.clean; }
  if (role === 'user' || role === 'assistant' || role === 'probe') {
    // Exec turns get a clickable replay glyph (execVoice.mark, see exec-voice.js).
    if (role !== 'user' && window.execVoice) div.appendChild(execVoice.mark(role, text));
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (role === 'user') execRenderUserBody(body, text);
    else execRender(body, text);
    execAddImages(body, extra.images);
    div.appendChild(body);
  } else {
    div.textContent = text;
  }
  execTermEl.appendChild(div);
  if (choices) execAttachChoices(div, choices, cardId);
  if (stick || role === 'user') execTermEl.scrollTop = execTermEl.scrollHeight;
  return div;
}

function execAttachChoices(div, choices, cardId) {
  execChoices.attach(execTermEl, div, choices.opts, execSendText, cardId,
                     function (t) { execAddMsg('sys', t); }, choices.clean);
}

/** A tool call: ONE line, its output folded under it (exec-toolout.js). */
function execAddToolMsg(name, arg) {
  const stick = execAtBottom();
  const div = document.createElement('div');
  div.className = 'msg tool';
  const body = document.createElement('div');
  body.className = 'msg-body';
  const b = document.createElement('b');
  b.textContent = name || 'tool';
  body.appendChild(b);
  if (arg) body.appendChild(document.createTextNode(' ' + arg));
  div.appendChild(body);
  execTermEl.appendChild(div);
  if (stick) execTermEl.scrollTop = execTermEl.scrollHeight;
  return div;
}

/** The field that says what a call DOES, not a JSON dump. `query` and `url`
 *  first: WebSearch has neither of the older keys, and WebFetch's `prompt` is
 *  the instruction to the fetcher, not the thing fetched. */
function execSummarize(inp) {
  if (inp == null) return '';
  if (typeof inp === 'string') return execClamp(inp, 200);
  const key = inp.query || inp.url || inp.command || inp.file_path
    || inp.pattern || inp.path || inp.prompt;
  if (typeof key === 'string') return execClamp(key, 200);
  try { return execClamp(JSON.stringify(inp), 200); } catch { return ''; }
}

/** An Exec card tool's one-line receipt -- the thing Wai cares about is the
 *  card, not the call, so these never render as a tool line. */
function execCardReceipt(name, inp, res) {
  if (res.error) return '[ ' + name.replace(/_/g, ' ') + ' failed: ' + res.error + ' ]';
  if (name === 'create_card')   return '[ card added: ' + (res.title || inp.title || '') + ' ]';
  if (name === 'archive_card')  return '[ done: "' + (res.title || inp.id || '') + '"' + (res.next_occurrence ? ' -> next ' + res.next_occurrence : '') + ' ]';
  if (name === 'exile_card')    return '[ exiled: "' + (res.title || inp.id || '') + '" ]';
  if (name === 'update_card')   return '[ updated: ' + (res.title || inp.id || '') + ' ]';
  if (name === 'schedule_card') return '[ scheduled "' + (res.title || '') + '" -> ' + (res.scheduled_day || 'unscheduled') + ' ]';
  return '[ ' + name.replace(/_/g, ' ') + ': done ]';
}

/** Say so when the sidecar cannot answer, once, in the warn colour: a
 *  logged-out sidecar answers every run with "Not logged in", which reads as a
 *  broken panel unless something says otherwise. */
async function execAnnounceState() {
  try {
    const r = await fetch('/api/cc/health', { cache: 'no-store' });
    const d = await r.json();
    if (d.unreachable || !d.ok) execAddMsg('sys warn', '[ sidecar offline — sudo systemctl status cc-sidecar ]');
    else if (d.authed === false) execAddMsg('sys warn', '[ cc-agent not logged in — run: sudo -u cc-agent -H /usr/bin/claude, then /login ]');
  } catch {
    execAddMsg('sys warn', '[ sidecar unreachable ]');
  }
}

/** Replay the conversation: the sidecar thread with nudges and monitor
 *  comments interleaved by time (GET /api/cc/exec-history, api/exec_panel.py).
 *  Returns {monitorTotal}, or null when there is nothing to replay or the fetch
 *  failed -- the panel must still open. Tool calls are live-only: the sidecar
 *  transcript keeps text. */
async function execLoadHistory() {
  try {
    const r = await fetch('/api/cc/exec-history', { cache: 'no-store' });
    if (!r.ok) return null;
    const h = await r.json();
    for (const m of h.messages || []) {
      if (m.role === 'monitor') execAddMsg('probe', m.text, { cardId: m.card_id });
      else if (m.role === 'user') execAddMsg('user', execTsChip(m.ts) + m.text, { images: m.images });
      else execAddMsg('assistant', m.text);
    }
    execTermEl.scrollTop = execTermEl.scrollHeight;
    return { monitorTotal: h.monitorTotal || 0 };
  } catch {
    return null;
  }
}

function execTsChip(ts) {
  const d = ts ? new Date(ts) : null;
  return d && !isNaN(d) ? execFmtTs(d) + ' ' : '';
}

/** Typing, tapping an answer and the mic all end here, so a tapped answer IS
 *  the message Wai would have typed. A leading slash is a command first
 *  (exec-commands.js) -- images attached or not, since the SDK honours /clear
 *  silently and would drop the thread without the archive /new writes. Sending
 *  while a turn runs INTERRUPTS it (exec-interrupt.js). */
async function execSendText(text) {
  text = (text || '').trim();
  if (!text && !execPending.length) return;
  if (text.startsWith('/') && await execRunCommand(text)) return;
  const imgs = execPending.slice();
  execPending = [];
  execThumbStrip();
  // In the transcript BEFORE the interrupt it triggers: the wait is a few
  // hundred ms of round trips, and a line that appears nowhere reads as dropped.
  execAddMsg('user', execFmtTs() + ' ' + text, { images: imgs });
  if (execSending) return;
  execSending = true;
  if (execStreaming) await execInterrupt();
  execSending = false;
  await execStreamResponse(text, imgs);
}
