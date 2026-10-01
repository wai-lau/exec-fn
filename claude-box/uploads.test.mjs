// node --test claude-box/uploads.test.mjs -- the name is the containment.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeName, saveUploads, uploadNote } from "./uploads.mjs";

test("names cannot climb out or hide", () => {
  for (const evil of ["../../etc/passwd", "..", "/etc/shadow", "a/../../b", "..\\..\\x", ".bashrc"]) {
    const n = safeName(evil);
    assert.ok(!n.includes("/") && !n.includes("\\") && !n.startsWith("."), `${evil} -> ${n}`);
  }
  assert.equal(safeName("report final.pdf"), "report_final.pdf");
  assert.equal(safeName(""), "file");
});

test("valid files are written under uploads/, bad ones skipped", () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "up-"));
  const ok = Buffer.from("hello").toString("base64");
  const saved = saveUploads(box, [
    { name: "../../x.txt", data: ok },
    { name: "bad.bin", data: "not base64!!" },
    { name: "note.md", data: ok },
  ]);
  assert.equal(saved.length, 2);
  for (const rel of saved) {
    assert.match(rel, /^uploads\/[^/]+$/);
    assert.equal(fs.readFileSync(path.join(box, rel), "utf8"), "hello");
  }
  assert.equal(uploadNote(saved), `\n\n[attached: ${saved.join(", ")}]`);
  assert.equal(uploadNote([]), "");
});
