// Confine every path-taking tool to the sandbox directory.
//
// The mount namespace already decides what exists at all (§7b): /exec-fn and
// the docker socket are not in it. This is the layer INSIDE that: it keeps the
// agent within /srv/cc-sandbox rather than merely within the namespace, which
// matters because the namespace also contains /home/cc-agent -- and that holds
// .claude/.credentials.json, the OAuth subscription token.
//
// TWO checks, both required, in the same shape archive-tools.mjs uses:
//
//   1. A deterministic character allowlist on the raw string. Cheap, and it
//      refuses the shapes that make the second check hard to reason about
//      (NUL, a URL scheme, a home-relative "~").
//   2. The RESOLVED path must still sit under the sandbox root.
//
// The second is the one that survives a future edit to the first, and it is not
// optional: the agent has Write, so a pure string test is defeated by
// `ln -s /home/cc-agent/.claude/.credentials.json ./notes.txt` followed by a
// Read of ./notes.txt -- a path that is textually inside the sandbox the whole
// time. realpath() is what collapses that back to where it really points.
//
// A path that does not exist yet (Write creating a file) has no realpath, so the
// deepest EXISTING ancestor is resolved instead and the remainder appended. That
// is the honest reading: a new file lands wherever its parent directory really
// is, and it is the parent that can be a symlink out.
import fs from "node:fs";
import path from "node:path";

// Anything outside this is refused. Deliberately strict: no NUL, no "~" (the
// shell expands it, node does not, so it would resolve to a literal directory
// named "~" and read as containment when it is confusion), no "://".
const SPELLING = /^[^\0]{1,4096}$/;
const REJECT = [/\0/, /^~/, /:\/\//];

// tool -> the input keys naming a path. A tool absent from this map takes no
// path and is not this module's business.
export const PATH_INPUTS = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["path"],
  Grep: ["path"],
};

/** Resolve as far as the filesystem actually goes, then append the rest.
 *  Never throws: an unresolvable path returns the lexically-resolved form,
 *  which the caller still prefix-checks. */
function resolveDeepest(abs) {
  let cur = abs;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;   // hit the root without resolving
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** True when `p` is the root itself or lives under it. Compares path SEGMENTS,
 *  never a bare string prefix: "/srv/cc-sandbox-evil" starts with
 *  "/srv/cc-sandbox" as text while being a different directory entirely. */
export function isInside(root, p) {
  if (p === root) return true;
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Decide one path. Returns { ok } or { ok: false, reason }. */
export function checkPath(root, raw) {
  if (typeof raw !== "string" || !SPELLING.test(raw)) {
    return { ok: false, reason: "path is not a plain string" };
  }
  for (const bad of REJECT) {
    if (bad.test(raw)) return { ok: false, reason: `path may not match ${bad}` };
  }
  // Relative paths are resolved against the sandbox, which is also the cwd.
  const abs = path.resolve(root, raw);
  const real = resolveDeepest(abs);
  if (!isInside(root, real)) {
    return { ok: false, reason: `resolves to ${real}, outside the sandbox` };
  }
  return { ok: true };
}

/** Decide a whole tool call. `input` is the SDK's tool input object.
 *  A tool that takes no path is always { ok: true } -- this module only
 *  answers the path question, never the "is this tool allowed" one. */
export function checkToolPaths(root, toolName, input) {
  const keys = PATH_INPUTS[toolName];
  if (!keys) return { ok: true };
  for (const key of keys) {
    const raw = input?.[key];
    // An absent optional path (Grep/Glob default to cwd) is fine; the cwd IS
    // the sandbox. An absent REQUIRED one is the SDK's error to raise, not
    // ours to guess at.
    if (raw === undefined || raw === null) continue;
    const r = checkPath(root, raw);
    if (!r.ok) return { ok: false, reason: `${toolName}.${key}: ${r.reason}` };
  }
  return { ok: true };
}
