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

/** Fold a tool_result frame under the call that produced it.
 *
 * Returns the line the blinking cursor should ride -- the TOOL line while the
 * block is folded away, since a cursor inside a hidden block reads as a page
 * that stopped -- or null when the result was empty and nothing was rendered.
 * The call is consumed either way. */
function ccToolOut(data) {
  const tool = ccTakeTool();
  const t = (data.text || '').trim();
  if (!t) return null;
  const out = addMsg('out' + (data.isError ? ' err' : ''), clamp(t));
  if (!tool) return out;
  tool.after(out);
  out.hidden = true;
  tool.classList.add('cc-fold');
  tool.addEventListener('click', () => {
    out.hidden = !out.hidden;
    tool.classList.toggle('open', !out.hidden);
  });
  return tool;
}
