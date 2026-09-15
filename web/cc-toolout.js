/* /cc — a tool result, folded into the call that produced it.
 *
 * A tool call is ONE line. Its output hangs under it, collapsed, and the `+`
 * already in the gutter is the affordance: it flips to `-` while the block is
 * open. The whole line is the hit target, not the marker glyph alone -- a 1ch
 * pseudo-element is not a thumb, and this page is driven from a phone.
 *
 * Open, the block shows at most 20 lines and scrolls inside itself (`20lh`,
 * measured against the block's own line-height in cc.css), so a 500-line `ls`
 * or a fetched page cannot bury the reply under it. That cap used to be the
 * block's whole story: every result rendered expanded, and a turn with four
 * fetches pushed the answer several screens down.
 *
 * Pairing is FIFO, not by id: the sidecar's frames carry no `tool_use_id`
 * (server.mjs flattens `tool_use`/`tool_result` blocks to name+text), and a
 * turn's results arrive in the order its calls were made. A result with no
 * waiting call falls back to a standalone block, open, rather than vanishing.
 */

let _ccToolQueue = [];

/** Remember a tool line as awaiting its result. Returns the line (so the caller
 *  can still park the cursor on it). */
function ccQueueTool(div) {
  _ccToolQueue.push(div);
  return div;
}

/** The call this result belongs to, or null. Consumed even when the result is
 *  empty and nothing gets rendered -- a call left in the queue would pair the
 *  NEXT result with the wrong line. */
function ccTakeTool() {
  return _ccToolQueue.shift() || null;
}

/** Every turn starts with an empty queue: a call whose result never arrived
 *  (an aborted run, an error frame) must not swallow the next turn's first. */
function ccResetTools() {
  _ccToolQueue = [];
}

/** Hang `out` under `tool` as its folded block. */
function ccFold(tool, out) {
  tool.after(out);
  out.hidden = true;
  tool.classList.add('cc-fold');
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
 * which left the tool line without the `cc-fold` class or its click handler --
 * so tapping it did nothing, with no way to tell an empty result from a broken
 * page. That is how WebFetch read as unexpandable. */
function ccToolOut(data) {
  const tool = ccTakeTool();
  const t = (data.text || '').trim();
  const out = addMsg('out' + (data.isError ? ' err' : ''), t ? clamp(t) : '[ no output ]');
  if (!tool) return out;
  ccFold(tool, out);
  return tool;
}

/** End of turn: any call still waiting never got a result (an interrupt, an
 *  error frame, a result the sidecar could not render). Say that under the
 *  line instead of leaving it inert. */
function ccFinishTools() {
  for (const tool of _ccToolQueue) {
    if (tool.classList.contains('cc-fold')) continue;
    ccFold(tool, addMsg('out', '[ no result returned ]'));
  }
  _ccToolQueue = [];
}
