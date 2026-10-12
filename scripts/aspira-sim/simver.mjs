// SIM VERSION (owner, 2026-10-12: "make sure this bug doesnt happen again - track the version of each sim"): one short hash
// of everything a result depends on - the game files the run loads (ASPIRA_WEB or ../../web), every simulator script here,
// and ASPIRA_PATCH. pool.mjs prints it and stamps it on every row it writes, and RESUMES only rows of the same version
// (a re-run over an old out.jsonl silently reused stale games, 2026-10-12).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SIM_WEB = (process.env.ASPIRA_WEB || path.join(HERE, "..", "..", "web")) + "/";
function hashOf() {
  const h = crypto.createHash("sha1");
  for (const f of fs.readdirSync(SIM_WEB).filter(f => /^aspira-.*\.js$/.test(f)).sort()) h.update(f).update(fs.readFileSync(SIM_WEB + f));
  for (const f of fs.readdirSync(HERE).filter(f => f.endsWith(".mjs")).sort()) h.update(f).update(fs.readFileSync(path.join(HERE, f)));
  h.update("patch:" + (process.env.ASPIRA_PATCH || "") + (process.env.BV_PATCH ? fs.readFileSync(process.env.BV_PATCH, "utf8") : ""));
  return h.digest("hex").slice(0, 10);
}
export const SIM_VERSION = hashOf();
export const simBanner = () => `sim version ${SIM_VERSION} (web ${process.env.ASPIRA_WEB ? path.basename(SIM_WEB) : "repo"}${process.env.ASPIRA_PATCH || process.env.BV_PATCH ? ", PATCHED" : ""})`;

// HALF-PATCHED TIER TABLES (2026-10-12: a test raised SOL_BREACH_ARMOR's tiers I-V and missed the giga VI the "breach" build
// actually runs - the result looked identical): every ALL-CAPS array the patch names is compared before and after it; one
// that changed below its last index but not AT it (giga tables are 7 long - aspira-giga.js) is reported, loudly, once
const warned = new Set();
export function patchProbe(run, patch) {
  const names = [...new Set((patch.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []))];
  const read = () => Object.fromEntries(names.map(n => [n, run(`(typeof ${n} !== "undefined" && Array.isArray(${n})) ? JSON.stringify(${n}) : null`)]));
  const before = read();
  return () => {
    const after = read();
    for (const n of names) {
      if (!before[n] || !after[n] || warned.has(n)) continue;
      const a = JSON.parse(before[n]), b = JSON.parse(after[n]), last = a.length - 1;
      const low = a.slice(0, last).some((v, i) => JSON.stringify(v) !== JSON.stringify(b[i])), top = JSON.stringify(a[last]) !== JSON.stringify(b[last]);
      if (low && !top && a.length >= 7) { warned.add(n); console.error(`!! patch changed ${n} below its last tier but NOT index ${last} (the giga VI) - a maxed axis still reads ${JSON.stringify(a[last])}`); }
    }
  };
}
