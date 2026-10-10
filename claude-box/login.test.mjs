// node --test claude-box/login.test.mjs -- the name is the containment.
//
// The CLI is a FAKE (written below): a real `claude auth login` would need a
// person to approve in a browser. It prints its link the way the real one does
// (inside an OSC 8 hyperlink, then the paste prompt) and accepts one code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE = "S".repeat(43);
const GOOD = "g".repeat(48);
const URL_ = `https://claude.com/cai/oauth/authorize?code=true&state=${STATE}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-login-"));
const fake = path.join(dir, "claude");
fs.writeFileSync(fake, `#!/usr/bin/env node
process.stdout.write("Opening browser to sign in\\u2026\\nIf the browser didn't open, visit: "
  + "\\x1b]8;;${URL_}\\x1b\\\\${URL_}\\x1b]8;;\\x1b\\\\\\nPaste code here if prompted > ");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  if (!buf.includes("\\n")) return;
  const ok = buf.trim() === "${GOOD}#${STATE}";
  process.stdout.write(ok ? "Login successful.\\n" : "Login failed: Request failed with status code 400\\n");
  process.exit(ok ? 0 : 1);
});
`, { mode: 0o755 });
process.env.CC_CLAUDE_BIN = fake;
const { codeFor, finishLogin, loginUrlIn, pendingLogin, startLogin } = await import("./login.mjs");

test("the link is cut out of the OSC 8 wrapper, not run on into its copy", () => {
  const out = `visit: \x1b]8;;${URL_}\x1b\\${URL_}\x1b]8;;\x1b\\\nPaste code here > `;
  assert.equal(loginUrlIn(out), URL_);
  assert.equal(loginUrlIn("no link yet"), null);
});

test("only a code-shaped message is taken as the code", () => {
  assert.deepEqual(codeFor(`  ${GOOD}#${STATE}\n`, STATE), { code: `${GOOD}#${STATE}` });
  assert.deepEqual(codeFor(GOOD, STATE), { code: `${GOOD}#${STATE}` });   // bare: state added
  assert.deepEqual(codeFor(`${GOOD}#${"T".repeat(43)}`, STATE), { stale: true });
  for (const words of ["yes", "what is on my board today?", "done", "a".repeat(20), `${GOOD} please`]) {
    assert.equal(codeFor(words, STATE), null, words);
  }
  assert.equal(codeFor(GOOD, null), null);
});

test("a good code signs in and ends the wait", async () => {
  const url = await startLogin(process.env);
  assert.equal(url, URL_);
  assert.equal(await startLogin(process.env), url, "a second failure rejoins the same sign-in");
  assert.equal(pendingLogin().state, STATE);
  assert.deepEqual(await finishLogin(codeFor(GOOD, STATE).code), { ok: true });
  assert.equal(pendingLogin(), null);
});

test("a bad code fails with the CLI's own words, and the sign-in is over", async () => {
  await startLogin(process.env);
  const r = await finishLogin(`${"b".repeat(48)}#${STATE}`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /status code 400/);
  assert.equal(pendingLogin(), null);
  assert.deepEqual(await finishLogin(GOOD), { ok: false, detail: "no sign-in is waiting" });
});
