/* Files Wai drops into the Exec panel that are not pictures (a PDF, a CSV, a
 * text file). Images ride in the prompt as image blocks (imageBlocks in
 * server.mjs); anything else is WRITTEN INTO THE SANDBOX and the prompt says
 * where, so the agent opens it with Read -- which already handles PDFs, text
 * and notebooks, and is already confined to the sandbox (sandbox-paths.mjs).
 * Nothing new is granted: a file Wai hands over lands where the agent could
 * already write.
 *
 * Containment is enforced on the NAME, twice, the same idea as
 * archive-tools.mjs: the name is reduced to [A-Za-z0-9._-] (no separators, no
 * leading dots, so `..` cannot be spelled), and the resolved path must still
 * sit directly in the uploads directory. `wx` refuses to overwrite.
 */

import fs from "node:fs";
import path from "node:path";

export const MAX_FILES = Number(process.env.CC_MAX_FILES || 4);
// base64 length, ~4.5MB of file: the whole body (files + images) must stay
// under readBody's 24MB and nginx's 25m.
export const MAX_FILE_B64 = Number(process.env.CC_MAX_FILE_B64 || 6 * 1024 * 1024);

/** A safe file name: basename only, odd characters to `_`, no leading dots. */
export function safeName(name) {
  const base = String(name || "").split(/[\\/]/).pop();
  const clean = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(-80);
  return clean || "file";
}

/** Write the valid entries of `list` ([{name, data}], data bare base64) into
 *  <sandbox>/uploads/ and return their sandbox-relative paths. A bad entry is
 *  skipped, never fatal: losing one file beats losing the message. */
export function saveUploads(sandbox, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const dir = path.join(sandbox, "uploads");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const saved = [];
  for (const f of list.slice(0, MAX_FILES)) {
    const data = typeof f?.data === "string" ? f.data : "";
    if (!data || data.length > MAX_FILE_B64 || !/^[A-Za-z0-9+/=]+$/.test(data)) continue;
    const name = `${stamp}-${safeName(f.name)}`;
    const full = path.join(dir, name);
    if (path.dirname(full) !== dir) continue;
    try {
      fs.writeFileSync(full, Buffer.from(data, "base64"), { mode: 0o600, flag: "wx" });
      saved.push(`uploads/${name}`);
    } catch {
      /* unwritable or a name collision in the same millisecond: skip it */
    }
  }
  return saved;
}

/** The line appended to Wai's message. The panel parses this exact shape back
 *  into chips (exec-bubble-msg.js), so change both together. */
export function uploadNote(paths) {
  return paths.length ? `\n\n[attached: ${paths.join(", ")}]` : "";
}
