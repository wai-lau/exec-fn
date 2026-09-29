/* One Exec turn, streamed: the reveal, the frames, and how a reply is laid out.
 *
 * The frames are the sidecar's own vocabulary, relayed verbatim by
 * /api/cc/query: session / text / thinking / tool / tool_result / limits /
 * done / busy / error. The container puts the board in front of Wai's words
 * (exec_context.wrap), so only her words are sent.
 *
 * Layout: an assistant bubble opens up front to carry the cursor, and anything
 * that is not prose (a tool call, a thought) CLOSES it -- an empty one is
 * dropped, one holding prose is settled -- so the transcript keeps real order
 * and two messages never run together. The cursor rides whatever line is last
 * until the turn ends. Exec's own card tools leave a receipt about the card
 * instead of a tool line (exec-toolout.js).
 *
 * Shared global scope; loaded after exec-term.js, before exec-bubble.js.
 */
'use strict';

// Chat pace: four times /tarot's 1.25. A reading is listened to; this is read.
const EXEC_TYPE_SPEED = 5;
const EXEC_CARD_TOOL = 'mcp__exec__';

function execVoiceOn() {
  return !!(window.execVoice && execVoice.isOn() && execVoice.ready());
}

/** The reveal for one bubble. SILENT = twGuess at SPEED 5; SPOKEN = twAudio,
 *  the same weights rescaled to the measured utterance. With the voice on,
 *  push() only buffers: the reveal begins when the utterance does, or the text
 *  would finish before it had been read out. */
function execTyper(body, cur) {
  const tw = { buffered: '', displayed: '', serverDone: false, cancelled: false };
  let typing = null;

  function render(shown) {
    // Only diagrams whose closing fence has arrived: a half-written one flickers.
    execRender(body, shown, execClosedSvgCount(shown));
    (body.lastElementChild || body).appendChild(cur);
    if (execAtBottom()) execTermEl.scrollTop = execTermEl.scrollHeight;
  }
  function startGuess() {
    if (!typing) {
      typing = new Promise((resolve) => {
        twGuess(tw, render, { speed: EXEC_TYPE_SPEED, onDone: resolve }).start();
      });
    }
    return typing;
  }
  function push(text) {
    tw.buffered = text;
    if (!execVoiceOn()) startGuess();
  }
  /** Speak finished prose, pacing the reveal to it when THIS utterance is next
   *  to play. Queued behind other speech, or a dead controller, takes the
   *  guessed pace: its audio may be a minute away. */
  function speakAndPace(text) {
    tw.serverDone = true;
    if (!text || !window.execVoice) { startGuess(); return; }
    const queuedBehind = execVoice.isSpeaking();
    const ctl = execVoice.speak(text);
    if (ctl.ok && !queuedBehind && !typing) {
      typing = new Promise((resolve) => {
        twAudio(tw, render, ctl, { speed: EXEC_TYPE_SPEED, onDone: resolve }).start();
      });
    } else {
      startGuess();
    }
  }
  function done() { tw.serverDone = true; return startGuess(); }
  function cancel() { tw.cancelled = true; }
  return { push, speakAndPace, done, cancel };
}

/** The SSE body as parsed frames. A chunk can split a frame (even mid-UTF-8),
 *  so the decoder streams and the tail carries; a bad line is dropped. */
async function* execFrames(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const step = await reader.read();
    if (step.done) return;
    buf += dec.decode(step.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { yield JSON.parse(line.slice(6)); } catch { /* dropped */ }
    }
  }
}

/** The turn/time footnote -- only when a tool ran or the wait wants explaining. */
function execDoneLine(data) {
  const bits = [];
  if (data.turns > 1) bits.push(data.turns + ' turns');
  if (data.ms != null && data.ms >= 15000) bits.push((data.ms / 1000).toFixed(1) + 's');
  return bits.length ? '[ ' + bits.join(' · ') + ' ]' : null;
}

/** Hang the footnote on the END of the reply, not on a row of its own. */
function execAppendReceipt(body, text) {
  if (!body) { execAddMsg('sys', text); return; }
  const span = document.createElement('span');
  span.className = 'exec-receipt';
  span.textContent = text;
  const last = body.lastElementChild;
  if (last && /^(P|H[1-6]|BLOCKQUOTE)$/.test(last.tagName)) last.appendChild(span);
  else body.appendChild(span);
}

/** A turn's open bubble and the last settled one. `close()` is idempotent: a
 *  turn fires several non-prose frames in a row, and the second must not act
 *  on a bubble the first already closed. */
function execBubbles() {
  const t = { div: null, body: null, cur: null, typer: null, text: '', last: null };
  t.open = function () {
    // The cursor may still be parked on a tool line; one cursor per turn.
    if (t.cur) t.cur.remove();
    const s = chatStreamDiv(execTermEl, { id: 'exec-bc', scroll: true });
    t.div = s.div; t.body = s.body; t.cur = s.cur;
    t.typer = execTyper(t.body, t.cur);
  };
  t.close = function () {
    if (!t.div) return;
    t.cur.remove();
    if (t.text) {
      // Settle it now and say it now: this prose is finished, and the voice
      // reading it is what fills the wait for the tool that closed it.
      execRender(t.body, t.text);
      if (window.execVoice) execVoice.speak(t.text);
      t.last = { div: t.div, body: t.body, text: t.text };
    } else {
      t.div.remove();
    }
    t.typer.cancel();
    t.div = null; t.typer = null; t.text = '';
  };
  t.park = function (el) { if (el && t.cur) el.appendChild(t.cur); };
  return t;
}

/** One frame. Returns the done-line when the frame is `done`. */
function execOnFrame(data, t) {
  execStatusOn(data);
  if (data.type === 'text') {
    if (!t.div) t.open();
    t.text += data.text;
    t.typer.push(t.text);
  } else if (data.type === 'thinking') {
    if (data.text) { t.close(); t.park(execAddMsg('think', data.text)); }
  } else if (data.type === 'tool') {
    t.close();
    if (data.name && data.name.indexOf(EXEC_CARD_TOOL) === 0) {
      execQueueTool({ cardTool: data.name.slice(EXEC_CARD_TOOL.length), input: data.input });
    } else {
      t.park(execQueueTool(execAddToolMsg(data.name, execSummarize(data.input))));
    }
  } else if (data.type === 'tool_result') {
    const line = execToolOut(data);
    if (line) { t.close(); t.park(line); }
  } else if (data.type === 'done') {
    return execDoneLine(data);
  } else if (data.type === 'busy') {
    t.close();
    execAddMsg('sys warn', '[ busy — one run at a time; send again shortly ]');
  } else if (data.type === 'error') {
    t.close();
    execAddMsg('sys warn', '[ ' + (data.detail || 'error') + ' ]');
  }
  return null;
}

/** The last prose bubble, settled: markdown, diagrams, and its answer row
 *  turned into buttons. */
function execSettle(t) {
  let last = t.last;
  t.cur.remove();   // wherever it is parked: the turn is over
  if (t.div) {
    if (!t.text) t.div.remove();
    else last = { div: t.div, body: t.body, text: t.text };
  }
  if (!last) return null;
  const ch = window.execChoices ? execChoices.parse(last.text) : null;
  execRender(last.body, ch && (ch.opts.length || ch.cardId) ? ch.clean : last.text);
  if (ch && (ch.opts.length || ch.cardId)) execAttachChoices(last.div, ch, ch.cardId);
  if (window.execVoice) last.div.insertBefore(execVoice.mark('assistant', last.text), last.div.firstChild);
  return last.body;
}

async function execStreamResponse(prompt, imgs) {
  execStreaming = true;
  execResetTools();
  const signal = execRunBegin();   // exec-interrupt.js
  const t = execBubbles();
  t.open();
  let receipt = null;
  try {
    const r = await fetch('/api/cc/query', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      // the wire wants bare base64, not the thumbnail's data: URL
      body: JSON.stringify({
        prompt: prompt,
        images: (imgs || []).map((i) => ({ media_type: i.media_type, data: i.data })),
      }),
    });
    if (!r.ok || !r.body) {
      let msg = 'request failed (' + r.status + ')';
      try { msg = (await r.json()).error || msg; } catch { /* non-JSON body */ }
      throw new Error(msg);
    }
    for await (const data of execFrames(r.body)) receipt = execOnFrame(data, t) || receipt;
    // The text is final HERE: speak before awaiting the reveal, never after,
    // or a long answer is read aloud to a screen that finished saying it.
    if (t.typer) { t.typer.speakAndPace(t.text); await t.typer.done(); }
    const settled = execSettle(t);
    execFinishTools();
    if (receipt) execAppendReceipt(settled, receipt);
  } catch (e) {
    if (t.typer) t.typer.cancel();
    t.cur.remove();
    if (t.div && !t.text) t.div.remove();
    execFinishTools();
    execAddMsg('sys warn', execStopNote(e));
  }
  execStreaming = false;
  execRunEnd();
  execTermEl.dispatchEvent(new CustomEvent('exec:reply-done'));
  if (window.execMicReplyDone) execMicReplyDone();
}
