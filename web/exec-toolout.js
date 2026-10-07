/* Exec panel — a tool result, folded into the call that produced it.
 *
 * A tool call is ONE line. Its output hangs under it, collapsed, and the `+`
 * already in the gutter is the affordance: it flips to `-` while the block is
 * open. The whole line is the hit target, not the marker glyph alone -- a 1ch
 * pseudo-element is not a thumb, and this page is driven from a phone.
 *
 * Open, the block shows at most 20 lines and scrolls inside itself (`20lh`,
 * measured against the block's own line-height in exec-term.css), so a 500-line `ls`
 * or a fetched page cannot bury the reply under it. That cap used to be the
 * block's whole story: every result rendered expanded, and a turn with four
 * fetches pushed the answer several screens down.
 *
 * Pairing is FIFO, not by id: the sidecar's frames carry no `tool_use_id`
 * (server.mjs flattens `tool_use`/`tool_result` blocks to name+text), and a
 * turn's results arrive in the order its calls were made. A result with no
 * waiting call falls back to a standalone block, open, rather than vanishing.
 */

let _execToolQueue = [];

/** Remember a tool line as awaiting its result. Returns the line (so the caller
 *  can still park the cursor on it). A card tool queues `{cardTool, input}`
 *  instead: it has no line until its receipt. */
function execQueueTool(div) {
  _execToolQueue.push(div);
  return div;
}

/** The call this result belongs to, or null. Consumed even when the result is
 *  empty and nothing gets rendered -- a call left in the queue would pair the
 *  NEXT result with the wrong line. */
function execTakeTool() {
  return _execToolQueue.shift() || null;
}

/** Every turn starts with an empty queue: a call whose result never arrived
 *  (an aborted run, an error frame) must not swallow the next turn's first. */
function execResetTools() {
  _execToolQueue = [];
}

/** Hang `out` under `tool` as its folded block. */
function execFold(tool, out) {
  tool.after(out);
  out.hidden = true;
  tool.classList.add('exec-fold');
  tool.addEventListener('click', () => {
    out.hidden = !out.hidden;
    tool.classList.toggle('open', !out.hidden);
  });
}

/** Fold a tool_result frame under the call that produced it.
 *
 * Returns the line the blinking cursor should ride -- the TOOL line while the
 * block is folded away, since a cursor inside a hidden block reads as a page
 * that stopped. The call is consumed either way.
 *
 * An EMPTY result still folds, saying so. It used to render nothing at all,
 * which left the tool line without the `exec-fold` class or its click handler --
 * so tapping it did nothing, with no way to tell an empty result from a broken
 * page. That is how WebFetch read as unexpandable. */
function execToolOut(data) {
  const tool = execTakeTool();
  // One of Exec's own card tools: not a line with output but a receipt about
  // the card, built from the result (execCardReceipt, exec-term.js).
  if (tool && tool.cardTool) {
    let res = {};
    try { res = JSON.parse(data.text) || {}; } catch { /* not JSON: generic receipt */ }
    return execAddActMsg(execCardReceipt(tool.cardTool, tool.input || {}, res));
  }
  const t = (data.text || '').trim();
  const out = execAddMsg('out' + (data.isError ? ' err' : ''), t ? execClamp(t) : '[ no output ]');
  if (!tool) return out;
  execFold(tool, out);
  return tool;
}

/** End of turn: any call still waiting never got a result (an interrupt, an
 *  error frame, a result the sidecar could not render). Say that under the
 *  line instead of leaving it inert. */
function execFinishTools() {
  for (const tool of _execToolQueue) {
    if (tool.cardTool || tool.classList.contains('exec-fold')) continue;
    execFold(tool, execAddMsg('out', '[ no result returned ]'));
  }
  _execToolQueue = [];
}

/** A replayed `action` row (api/exec_panel.py): the same line it was live --
 *  a card receipt for Exec's own tools, else a tool line with its output
 *  folded under it. A call with no recorded result folds that note instead. */
function execReplayAction(m) {
  const name = m.name || '';
  if (name.indexOf(EXEC_CARD_TOOL) === 0) {
    let res = {};
    try { res = JSON.parse(m.result) || {}; } catch { /* not JSON: generic receipt */ }
    execAddActMsg(execCardReceipt(name.slice(EXEC_CARD_TOOL.length), m.input || {}, res));
    return;
  }
  const tool = execAddToolMsg(name, execSummarize(m.input));
  const t = (m.result || '').trim();
  const text = m.result == null ? '[ no result returned ]' : (t ? execClamp(t) : '[ no output ]');
  execFold(tool, execAddMsg('out' + (m.isError ? ' err' : ''), text));
}
