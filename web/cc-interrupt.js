/* /cc — send while a run is in flight: the new message INTERRUPTS the old one.
 *
 * The page used to drop the keystroke entirely (`if (streaming) return`), which
 * is the wrong half of the terminal idiom it copies: a terminal lets you type
 * over a running job, and a run that has gone the wrong way is exactly when you
 * most want to say something. Sending now stops the turn in flight and starts
 * the new one.
 *
 * There is NO interrupt endpoint, and none is needed: the sidecar already
 * aborts a run whose caller hangs up (`req.on("close")` -> AbortController, in
 * server.mjs — it was written so a browser that navigates away cannot leave a
 * CLI subprocess resident against MAX_CONCURRENT 1). Aborting the fetch here
 * hangs up through the whole chain: fetch -> Starlette cancels the streaming
 * generator -> httpx closes the upstream stream -> node sees `close` -> the SDK
 * query is aborted. One mechanism, already load-bearing, now reused.
 *
 * The slot is freed at the FAR end of that chain, so the new run cannot just be
 * fired: it would race the decrement and come back `busy`, i.e. the interrupt
 * would eat the message that caused it. `ccInterrupt()` therefore waits for the
 * sidecar to actually report itself free before returning.
 */

let _ccAbort = null;        // AbortController of the run in flight, else null
let _ccEnded = null;        // resolves when that run's handler has unwound
let _ccEndedResolve = null;
let _ccInterrupted = false;

/** Arm a run. Returns the signal `streamResponse` hands to fetch(). */
function ccRunBegin() {
  _ccAbort = new AbortController();
  _ccInterrupted = false;
  _ccEnded = new Promise((resolve) => { _ccEndedResolve = resolve; });
  return _ccAbort.signal;
}

/** The run's handler has unwound (settled, errored or aborted). */
function ccRunEnd() {
  _ccAbort = null;
  if (_ccEndedResolve) _ccEndedResolve();
  _ccEndedResolve = null;
}

/** Stop the run in flight, and do not return until the next one can start.
 *
 * Waits on two different things, in order, because they are two different ends
 * of the chain: our own handler unwinding (so `streaming` is false and the
 * transcript is settled before a new bubble opens), then the SIDECAR reporting
 * its slot free. Gives up waiting after `ms` rather than swallowing the
 * message -- a sidecar that never frees the slot answers `busy`, which the page
 * already renders as a line. */
async function ccInterrupt(ms) {
  if (!_ccAbort) return false;
  _ccInterrupted = true;
  _ccAbort.abort();
  await _ccEnded;
  await ccAwaitFree(ms || 4000);
  return true;
}

/** Poll the sidecar until it reports no run in flight. */
async function ccAwaitFree(ms) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch('/api/cc/health', { cache: 'no-store' });
      const d = await r.json();
      if (!d.busy) return true;
    } catch { /* unreachable: let the send itself report that */ }
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** What a failed turn says. An abort is not an error -- it is the thing Wai
 *  just asked for -- so it gets its own quiet line and the partial reply above
 *  it is left standing, the way a terminal leaves the output of a job it was
 *  told to stop. */
function ccStopNote(err) {
  if (_ccInterrupted || (err && err.name === 'AbortError')) return '[ interrupted ]';
  return '[ ' + ((err && err.message) || 'error') + ' ]';
}
