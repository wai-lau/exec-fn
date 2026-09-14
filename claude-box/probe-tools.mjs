// What tools does the model ACTUALLY get? Ask it, do not read the config.
//
// CLAUDE.md tells you to "re-run the init probe and confirm TOOL COUNT: 0"
// after every @anthropic-ai/claude-agent-sdk bump. This is that probe. It was
// referenced for months without existing as a file, which is most of how
// AskUserQuestion reached a user: nothing was re-run because there was nothing
// to run.
//
// It builds the SAME options object the real query uses (imported, never
// retyped -- a probe that describes a different sandbox than the one serving
// traffic is worse than no probe) and prints the tool list off the SDK's `init`
// system frame, which is the model's actual context rather than our intent.
//
// Run it as the credentialed user, memory-capped like any CLI subprocess:
//
//   systemd-run --user --scope -p MemoryMax=700M \
//     sudo -u cc-agent -H node /srv/cc-agent/probe-tools.mjs
//
// Expected: every name in ALLOWED_TOOLS, and NOTHING else. A name you do not
// recognise is a tool that arrived on an SDK upgrade -- add it to the allowlist
// deliberately or leave it out; it is already blocked by `tools`.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { probeOptions, ALLOWED_TOOLS } from "./server.mjs";

const EXPECTED = new Set(ALLOWED_TOOLS);

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let init = null;

  try {
    const it = query({
      prompt: "probe",
      options: { ...probeOptions(), abortController: controller, maxTurns: 1 },
    });
    // The init frame is the first thing the SDK emits; the model never has to
    // answer for the probe to be conclusive, so stop as soon as it lands.
    for await (const msg of it) {
      if (msg.type === "system" && msg.subtype === "init") { init = msg; break; }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  if (!init) {
    console.error("NO INIT FRAME -- sidecar unauthenticated, or the SDK changed shape.");
    process.exit(2);
  }

  const got = (init.tools || []).slice().sort();
  const unexpected = got.filter((t) => !EXPECTED.has(t));
  const missing = [...EXPECTED].filter((t) => !got.includes(t)).sort();

  console.log("model: " + (init.model || "?"));
  console.log("TOOL COUNT: " + got.length);
  for (const t of got) console.log("  " + (EXPECTED.has(t) ? "ok       " : "UNEXPECTED ") + t);
  if (missing.length) console.log("MISSING (allowed but absent): " + missing.join(", "));

  if (unexpected.length) {
    console.error("\nFAIL: " + unexpected.length + " tool(s) the sandbox never granted: "
      + unexpected.join(", "));
    console.error("`tools` is the allowlist that keeps these out of context. Add each one"
      + " to ALLOWED_TOOLS on purpose, or leave it blocked.");
    process.exit(1);
  }
  console.log("\nOK: no tool outside ALLOWED_TOOLS reached the model.");
}

main().catch((e) => { console.error(e); process.exit(2); });
