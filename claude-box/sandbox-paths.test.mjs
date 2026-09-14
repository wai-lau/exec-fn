// Escape attempts against the sandbox path gate. Run: node --test claude-box/
//
// Real directories and real symlinks in a temp tree, not mocks: the whole point
// of the second check is what the FILESYSTEM says a path resolves to, and a
// mocked realpath would test the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkPath, checkToolPaths, isInside } from "./sandbox-paths.mjs";

// A stand-in for the real layout: a sandbox, a secret beside it (the shape of
// /home/cc-agent/.claude/.credentials.json), and a sibling whose name shares a
// string prefix with the sandbox.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sbx-")));
const ROOT = path.join(tmp, "cc-sandbox");
const SECRET_DIR = path.join(tmp, "home");
const SECRET = path.join(SECRET_DIR, "credentials.json");
const SIBLING = path.join(tmp, "cc-sandbox-evil");

fs.mkdirSync(ROOT);
fs.mkdirSync(SECRET_DIR);
fs.mkdirSync(SIBLING);
fs.writeFileSync(SECRET, '{"token":"sk-not-a-real-one"}');
fs.writeFileSync(path.join(ROOT, "notes.txt"), "hello");
fs.mkdirSync(path.join(ROOT, "sub"));

const ok = (p) => checkPath(ROOT, p).ok;

test("an ordinary file inside the sandbox is allowed", () => {
  assert.ok(ok("notes.txt"));
  assert.ok(ok("./notes.txt"));
  assert.ok(ok("sub"));
  assert.ok(ok(path.join(ROOT, "notes.txt")));
  assert.ok(ok(ROOT), "the sandbox root itself is inside the sandbox");
});

test("a file that does not exist yet is allowed (Write creating one)", () => {
  assert.ok(ok("new-file.txt"));
  assert.ok(ok("sub/deeper/new.txt"));
});

test("dot-dot traversal is refused", () => {
  assert.ok(!ok(".."));
  assert.ok(!ok("../home/credentials.json"));
  assert.ok(!ok("sub/../../home/credentials.json"));
  assert.ok(!ok("./sub/./../../home"));
});

test("an absolute path outside is refused", () => {
  assert.ok(!ok(SECRET));
  assert.ok(!ok("/etc/passwd"));
  assert.ok(!ok("/home/cc-agent/.claude/.credentials.json"));
});

test("a SYMLINK inside the sandbox pointing out is refused", () => {
  // The case a string regex cannot see: textually inside the whole time.
  const link = path.join(ROOT, "innocent.txt");
  fs.symlinkSync(SECRET, link);
  assert.ok(link.startsWith(ROOT), "precondition: the path LOOKS contained");
  assert.ok(!ok("innocent.txt"), "resolved through the symlink, it is outside");
  assert.ok(!ok(link));
});

test("a new file under a symlinked DIRECTORY is refused", () => {
  // Write does not need its own file to exist -- but its parent decides where
  // it lands, and the parent can be the link.
  const linkdir = path.join(ROOT, "outbox");
  fs.symlinkSync(SECRET_DIR, linkdir);
  assert.ok(!ok("outbox/planted.txt"));
});

test("a sibling sharing a string prefix is refused", () => {
  // "/...cc-sandbox-evil".startsWith("/...cc-sandbox") is true as text, which
  // is why containment compares path segments instead.
  assert.ok(!ok(SIBLING));
  assert.ok(!ok(path.join(SIBLING, "x.txt")));
  assert.ok(!isInside(ROOT, SIBLING));
});

test("tilde and schemes are refused rather than resolved", () => {
  assert.ok(!ok("~"));
  assert.ok(!ok("~/.claude/.credentials.json"));
  assert.ok(!ok("file:///etc/passwd"));
  assert.ok(!ok("http://example.com/x"));
});

test("a non-string or NUL-bearing path is refused", () => {
  assert.ok(!checkPath(ROOT, undefined).ok);
  assert.ok(!checkPath(ROOT, null).ok);
  assert.ok(!checkPath(ROOT, 42).ok);
  assert.ok(!checkPath(ROOT, "note\0.txt").ok);
  assert.ok(!checkPath(ROOT, "").ok);
});

test("checkToolPaths gates each tool on its own input keys", () => {
  assert.ok(checkToolPaths(ROOT, "Read", { file_path: "notes.txt" }).ok);
  assert.ok(!checkToolPaths(ROOT, "Read", { file_path: SECRET }).ok);
  assert.ok(!checkToolPaths(ROOT, "Write", { file_path: "../escape" }).ok);
  assert.ok(!checkToolPaths(ROOT, "Edit", { file_path: "/etc/passwd" }).ok);
  assert.ok(!checkToolPaths(ROOT, "NotebookEdit", { notebook_path: SECRET }).ok);
  assert.ok(!checkToolPaths(ROOT, "Grep", { path: SECRET_DIR }).ok);
  assert.ok(!checkToolPaths(ROOT, "Glob", { path: ".." }).ok);
});

test("an omitted optional path is allowed (Grep/Glob default to cwd)", () => {
  assert.ok(checkToolPaths(ROOT, "Grep", { pattern: "x" }).ok);
  assert.ok(checkToolPaths(ROOT, "Glob", { pattern: "*.txt" }).ok);
});

test("a tool that takes no path is not this module's business", () => {
  // Bash is NOT gated here and must not appear gated: a regex over a shell
  // command is not a containment mechanism, and pretending otherwise would be
  // worse than the honest gap. Its containment is the mount namespace.
  assert.ok(checkToolPaths(ROOT, "Bash", { command: "cat /etc/passwd" }).ok);
  assert.ok(checkToolPaths(ROOT, "WebFetch", { url: "https://example.com" }).ok);
});

test("the denial says where it actually resolved to", () => {
  const r = checkToolPaths(ROOT, "Read", { file_path: "../home/credentials.json" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Read\.file_path/);
  assert.match(r.reason, /outside the sandbox/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
