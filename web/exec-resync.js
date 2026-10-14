/* Exec panel — a reply that outlives the page's connection to it.
 *
 * A run on the sidecar no longer stops when the page hangs up (2026-10-14).
 * The phone backgrounding Safari, the tab closing, the container reloading:
 * each dropped the stream, the sidecar aborted the run with it, and Exec
 * stopped mid-answer. Now the run finishes on its own and only an explicit
 * interrupt stops it (exec-interrupt.js).
 *
 * What the page loses is the rest of the STREAM, not the reply: the sidecar's
 * transcript has every word. So the page waits for the run to end and replays
 * the conversation from it (execLoadHistory). Text only, no narration: the
 * voice stops with the stream, and that is the agreed trade.
 *
 * Three ways in:
 * - the stream errors, or ends with no closing frame, AFTER the sidecar took
 *   the turn (execStreamResponse -> execResync);
 * - the page comes back to the foreground on a stream that is open but dead.
 *   iOS can suspend a page without the socket ever erroring, so the reader
 *   would wait forever. The watchdog asks the sidecar instead: a run that has
 *   ended while our stream never closed is lost;
 * - the page loads mid-answer, i.e. closed and reopened (execFollowRun, from
 *   exec-bubble.js's loadHistory).
 *
 * Shared global scope; loaded after exec-term.js, before exec-stream.js.
 */
'use strict';

const EXEC_RESYNC_POLL_MS = 1000;
// How long an ended run gets to deliver its closing frame down a live stream
// before that stream is called dead. Generous: the frame is milliseconds away.
const EXEC_RESYNC_GRACE_MS = 3000;
// A sidecar that never answers is not waited on forever: past this the replay
// runs anyway, and shows whatever the transcript has.
const EXEC_RESYNC_MAX_MS = 15 * 60 * 1000;
let execResyncing = false;
let execWatching = false;

const execSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** true / false, or null when the sidecar could not be asked. */
async function execSidecarBusy() {
  try {
    const r = await fetch('/api/cc/health', { cache: 'no-store' });
    return !!(await r.json()).busy;
  } catch {
    return null;
  }
}

/** Wait for the run to end, then replay the conversation over what is on
 *  screen. Waits out a turn of OURS too: a message sent meanwhile queues behind
 *  the run (cc_client waits for the slot), and a replay mid-stream would wipe
 *  it. When that turn ends, the transcript holds both. */
async function execResync(note) {
  if (execResyncing) return;
  execResyncing = true;
  execAddMsg('sys', note || '[ connection dropped — Exec is still answering; the reply lands here when it is done ]');
  const until = Date.now() + EXEC_RESYNC_MAX_MS;
  while (Date.now() < until) {
    if (!execStreaming && (await execSidecarBusy()) === false && !execStreaming) break;
    await execSleep(EXEC_RESYNC_POLL_MS);
  }
  while (execStreaming) await execSleep(EXEC_RESYNC_POLL_MS);
  await execLoadHistory(true);
  execResyncing = false;
}

/** Opened mid-answer: what the transcript has so far is on screen; the rest
 *  lands when the run ends. */
async function execFollowRun() {
  if (execStreaming || (await execSidecarBusy()) !== true) return;
  execResync('[ Exec is still answering — the reply lands here when it is done ]');
}

/** Back in the foreground with a turn still streaming: is the stream alive?
 *  Free twice, GRACE apart, with our stream still open = dead. Twice, because
 *  a turn of ours queued behind another run sees the slot free for up to half
 *  a second before it takes it. */
async function execWatchStream() {
  if (execWatching) return;
  execWatching = true;
  const run = execRunCurrent();
  while (run && execRunCurrent() === run && document.visibilityState === 'visible') {
    if ((await execSidecarBusy()) === false) {
      await execSleep(EXEC_RESYNC_GRACE_MS);
      if (execRunCurrent() === run && (await execSidecarBusy()) === false) {
        execRunLose(run);
        break;
      }
    }
    await execSleep(EXEC_RESYNC_POLL_MS * 2);
  }
  execWatching = false;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && execStreaming) execWatchStream();
});
