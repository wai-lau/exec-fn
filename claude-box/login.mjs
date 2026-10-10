/**
 * Signing cc-agent back into its subscription FROM THE EXEC PANEL.
 *
 * The login dies on its own now and then: the CLI's OAuth refresh fails and
 * every turn after it is the one line "Failed to authenticate: OAuth session
 * expired and could not be refreshed" (2026-10-09). Fixing that used to mean an
 * ssh session as cc-agent, /login, and copying a 465-char URL out of a terminal
 * that HARD-wraps it -- and the wrapped copy is what claude.com rejected as
 * "Invalid request format".
 *
 * Now the panel does it. A turn that fails `authentication_failed` starts
 * `claude auth login` here, and its link goes into the reply as markdown. Wai
 * approves in the browser and pastes the code claude.com shows back into the
 * panel as an ordinary message. handleQuery hands that message here instead of
 * to the model -- the code never enters a transcript -- and the CLI, which still
 * holds the PKCE verifier, finishes the exchange and writes
 * ~/.claude/.credentials.json itself.
 *
 * The paste cannot be skipped: Claude's OAuth client redirects only to its own
 * callback page or to localhost on the machine that clicked, so the code has no
 * way back to this server on its own. Measured 2026-10-10: the CLI reads that
 * code from a piped stdin, no TTY needed.
 */

import { spawn } from "node:child_process";

const BIN = process.env.CC_CLAUDE_BIN || "/usr/bin/claude";
// The CLI holds the PKCE verifier only while it lives, so the link is good for
// exactly as long as the child is kept. Ten minutes covers a phone unlock and a
// slow approve; a child kept past that is a resident CLI in a 700M unit for
// nothing.
export const LOGIN_TTL_MS = 10 * 60 * 1000;
const URL_WAIT_MS = 20 * 1000;
const EXCHANGE_WAIT_MS = 30 * 1000;
// claude.com shows `code#state`, both base64url. 32 is a floor well under
// either half (48 and 43 measured) and well over any word Wai would send alone.
const CODE_RE = /^([A-Za-z0-9_-]{32,})(?:#([A-Za-z0-9_-]{32,}))?$/;

let pending = null;

/** The sign-in URL in the CLI's output, or null. The CLI prints it inside an
 *  OSC 8 hyperlink (ESC ]8;; URL ESC \ URL ...), so the match stops at the
 *  first escape or BEL, or it runs on into the visible copy of the link. */
export function loginUrlIn(output) {
  const m = String(output ?? "").match(/https:\/\/[^\s\x07\x1b]+/);
  return m ? m[0] : null;
}

/** `text` as the code for the sign-in whose state is `state`, or null when it
 *  is not one. A bare code is completed with the state (the CLI wants both). A
 *  code from ANOTHER link is still a code: `{stale:true}`, so it is answered,
 *  not handed to the model. */
export function codeFor(text, state) {
  const m = String(text ?? "").trim().match(CODE_RE);
  if (!m || !state) return null;
  if (m[2] && m[2] !== state) return { stale: true };
  return { code: `${m[1]}#${state}` };
}

/** The sign-in waiting for its code, or null. */
export function pendingLogin() {
  return pending && pending.url ? { url: pending.url, state: pending.state } : null;
}

/** The last line the CLI printed, for a failure message. */
function lastLine(out) {
  const lines = String(out).replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) || "no output").replace(/^.*>\s*/, "").slice(0, 200);
}

/** Begin a sign-in, or rejoin the one already waiting. Resolves to its URL.
 *
 *  `env` is the CHILD's environment, so the caller strips its own secrets
 *  first (server.mjs childEnv). */
export function startLogin(env) {
  if (pending) return pending.urlReady;
  const child = spawn(BIN, ["auth", "login", "--claudeai"], {
    // Nothing to open a browser with in the unit, and nothing an updater may
    // write to: both would only add noise to the output parsed below.
    env: { ...env, BROWSER: "/bin/true", DISABLE_AUTOUPDATER: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const p = { child, out: "", url: null, state: null };
  pending = p;
  // A write after the child has gone raises EPIPE on the stream, and an
  // unhandled stream error would take the whole sidecar down with it.
  child.stdin.on("error", () => {});
  // 'close', not 'exit': output can still be arriving after the process has
  // exited, and the failure message is read from the last of it.
  p.exited = new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));   // spawn failed
  });
  p.exited.then(() => {
    clearTimeout(p.ttl);
    if (pending === p) pending = null;
  });
  p.ttl = setTimeout(() => child.kill(), LOGIN_TTL_MS);
  p.urlReady = new Promise((resolve, reject) => {
    const give = setTimeout(() => {
      child.kill();
      reject(new Error("no sign-in link from the CLI"));
    }, URL_WAIT_MS);
    const onData = (d) => {
      p.out += d;
      const url = !p.url && loginUrlIn(p.out);
      if (!url) return;
      p.url = url;
      try { p.state = new URL(url).searchParams.get("state"); } catch { p.state = null; }
      clearTimeout(give);
      resolve(url);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    // A no-op once the link has resolved.
    p.exited.then((code) => {
      clearTimeout(give);
      reject(new Error(`sign-in exited ${code}: ${lastLine(p.out)}`));
    });
  });
  return p.urlReady;
}

/** Hand a pasted code to the waiting CLI. Resolves `{ok}` or `{ok:false, detail}`;
 *  never throws. Either way this sign-in is over -- a failed code needs a new
 *  link, because the CLI exits on the first bad exchange. */
export async function finishLogin(code) {
  const p = pending;
  if (!p) return { ok: false, detail: "no sign-in is waiting" };
  p.child.stdin.write(`${code}\n`);
  let timer;
  const status = await Promise.race([
    p.exited,
    new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), EXCHANGE_WAIT_MS); }),
  ]);
  clearTimeout(timer);
  if (status === "timeout") {
    p.child.kill();
    return { ok: false, detail: "the CLI did not answer" };
  }
  return status === 0 ? { ok: true } : { ok: false, detail: lastLine(p.out) };
}
