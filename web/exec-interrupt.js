/* Exec panel — send while a run is in flight: the new message INTERRUPTS the old one.
 *
 * The page used to drop the keystroke entirely (`if (streaming) return`), which
 * is the wrong half of the terminal idiom it copies: a terminal lets you type
 * over a running job, and a run that has gone the wrong way is exactly when you
 * most want to say something. Sending now stops the turn in flight and starts
 * the new one.
 *
 * Stopping is an explicit request, POST /api/cc/interrupt -> the sidecar's
 * /interrupt. It used to be the HANGUP: aborting the fetch closed the chain and
 * the sidecar aborted any run whose caller left. That also meant a phone
 * backgrounding the page killed Exec mid-answer, so since 2026-10-14 a run
 * outlives its caller (exec-resync.js picks the reply back up) and only this
 * request stops one. The fetch is still aborted, so the old turn's handler
 * unwinds and leaves its partial reply standing.
 *
 * The slot is freed at the FAR end of that chain, so the new run cannot just be
 * fired: it would race the decrement and come back `busy`, i.e. the interrupt
 * would eat the message that caused it. `execInterrupt()` therefore waits for the
 * sidecar to actually report itself free before returning.
 */

let _execAbort = null;        // AbortController of the run in flight, else null
let _execEnded = null;        // resolves when that run's handler has unwound
let _execEndedResolve = null;
let _execInterrupted = false;
let _execLost = false;        // the stream died under the run (exec-resync.js)

/** Arm a run. Returns the signal `streamResponse` hands to fetch(). */
function execRunBegin() {
  _execAbort = new AbortController();
  _execInterrupted = false;
  _execLost = false;
  _execEnded = new Promise((resolve) => { _execEndedResolve = resolve; });
  return _execAbort.signal;
}

/** The run's handler has unwound (settled, errored or aborted). */
function execRunEnd() {
  _execAbort = null;
  if (_execEndedResolve) _execEndedResolve();
  _execEndedResolve = null;
}

/** The run in flight, as an identity to compare against later, else null. */
function execRunCurrent() { return _execAbort; }

/** Give up on a stream that died without erroring (exec-resync.js's watchdog).
 *  Only the page stops waiting: the sidecar's run goes on, and is replayed. */
function execRunLose(run) {
  if (!run || _execAbort !== run) return;
  _execLost = true;
  _execAbort.abort();
}

/** A failed turn LOST its connection, rather than being told to stop: the reply
 *  is still coming on the sidecar, so the page should pick it up, not print an
 *  error. Only the page aborts, so an AbortError is an interrupt or a loss. */
function execRunWasLost(err) {
  if (_execInterrupted) return false;
  return _execLost || !(err && err.name === 'AbortError');
}

/** Stop the run in flight, and do not return until the next one can start.
 *
 * Waits on two different things, in order, because they are two different ends
 * of the chain: our own handler unwinding (so `streaming` is false and the
 * transcript is settled before a new bubble opens), then the SIDECAR reporting
 * its slot free. Gives up waiting after `ms` rather than swallowing the
 * message -- a sidecar that never frees the slot answers `busy`, which the page
 * already renders as a line. */
async function execInterrupt(ms) {
  if (!_execAbort) return false;
  _execInterrupted = true;
  const stop = fetch('/api/cc/interrupt', { method: 'POST' }).catch(() => {});
  _execAbort.abort();
  await _execEnded;
  await stop;
  await execAwaitFree(ms || 4000);
  return true;
}

/** Poll the sidecar until it reports no run in flight; false after `ms`.
 *  `every` is the poll gap: 150ms for an interrupt someone is waiting on. */
async function execAwaitFree(ms, every) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch('/api/cc/health', { cache: 'no-store' });
      const d = await r.json();
      if (!d.busy) return true;
    } catch { /* unreachable: let the send itself report that */ }
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, every || 150));
  }
}

/** What a failed turn says. An abort is not an error -- it is the thing Wai
 *  just asked for -- so it gets its own quiet line and the partial reply above
 *  it is left standing, the way a terminal leaves the output of a job it was
 *  told to stop. */
function execStopNote(err) {
  if (_execLost) return '[ connection dropped — send again ]';
  if (_execInterrupted || (err && err.name === 'AbortError')) return '[ interrupted ]';
  return '[ ' + ((err && err.message) || 'error') + ' ]';
}
