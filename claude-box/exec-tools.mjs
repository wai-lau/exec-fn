/* Exec's card tools, as an in-process MCP server that relays to exec-fn.
 *
 * The /cc + Exec merge (docs/plan-exec-cc-merge.md) makes this agent Exec, so it
 * needs Exec's tools: create / archive / schedule a card, decompose a task, and
 * the rest. They stay implemented in Python inside the exec-fn container, next
 * to rd.json and its lock -- a second implementation here would be a second
 * copy of every scheduling rule, drifting. Each call is POSTed to
 * /api/exec/tool/{name} (api/routes_exec.py) and the JSON result handed back.
 *
 * Two lists, on purpose:
 *   EXEC_TOOLS  -- the ALLOWLIST, written out by hand. A tool the container
 *                  starts serving does not reach the model until someone adds
 *                  its name here, the same rule as BUILTIN_TOOLS in server.mjs.
 *   schemas     -- fetched from /api/exec/tools, the same definitions the
 *                  in-container chat path hands the API, so descriptions and
 *                  argument shapes are never retyped.
 * A tool is exposed only when it is in BOTH.
 *
 * The credential is the sidecar's own CC_SIDECAR_TOKEN, which the container
 * accepts for these two routes and nothing else. It is read in THIS process;
 * server.mjs strips it from the CLI subprocess's environment, so the agent's
 * Bash cannot read it back out.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const API = process.env.EXEC_API_URL || "http://127.0.0.1:8080";
const TOKEN = process.env.CC_SIDECAR_TOKEN || "";
const FETCH_TIMEOUT_MS = 3000;
// A card tool touches rd.json and at most schedules; a decompose makes an LLM
// call on the container side, so it gets real room.
const CALL_TIMEOUT_MS = 120_000;

export const EXEC_TOOLS = [
  "create_card", "archive_card", "exile_card", "update_card", "schedule_card",
  "decompose_task", "advance_chunk", "record_consequences",
  "reschedule_after_consequences", "update_context",
];
export const EXEC_TOOL_NAMES = EXEC_TOOLS.map((n) => `mcp__exec__${n}`);

// Last schemas that loaded. Kept across a failed refresh: the container
// restarting under `--reload` must not strip Exec of its tools mid-day.
let schemas = [];

const text = (s) => ({ content: [{ type: "text", text: s }] });

/** Re-read the schemas from the container. Never throws. */
export async function refreshExecSchemas() {
  if (!TOKEN) return schemas;
  try {
    const r = await fetch(`${API}/api/exec/tools`, {
      headers: { "x-cc-token": TOKEN },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (r.ok) {
      const body = await r.json();
      const fresh = (body.tools || []).filter((t) => EXEC_TOOLS.includes(t.name));
      if (fresh.length) schemas = fresh;
    }
  } catch {
    /* keep the last good set; a missing container is not a failed run */
  }
  return schemas;
}

// Exec's static system prompt (api/exec_context.py), kept the same way as the
// schemas: last good copy survives a failed refresh, so a container restart
// never turns Exec back into a bare assistant mid-conversation.
let prompt = "";

/** Re-read Exec's system prompt from the container. Never throws. */
export async function refreshExecPrompt() {
  if (!TOKEN) {
    promptStatus("no CC_SIDECAR_TOKEN");
    return prompt;
  }
  try {
    const r = await fetch(`${API}/api/exec/prompt`, {
      headers: { "x-cc-token": TOKEN },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = r.ok ? await r.json() : {};
    if (typeof body.prompt === "string" && body.prompt.trim()) {
      prompt = body.prompt.trim();
      promptStatus(`loaded ${prompt.length} chars`);
    } else {
      promptStatus(`exec-fn answered ${r.status}`);
    }
  } catch (e) {
    promptStatus(`unreachable: ${e?.message || e}`);   // keep the last good prompt
  }
  return prompt;
}

// Logged on CHANGE only, to the unit's journal: whether the agent is really
// Exec cannot be read off the model (it confabulates its own prompt), so this
// line is the ground truth -- `journalctl -u cc-sidecar | grep exec-prompt`.
let lastStatus = "";
function promptStatus(s) {
  if (s === lastStatus) return;
  lastStatus = s;
  console.log(`exec-prompt: ${s}${prompt ? "" : " (agent has NO Exec prompt)"}`);
}

// The per-turn block exec-fn puts in front of each of Wai's messages
// (exec_context.wrap). Stored with the turn, so it is stripped wherever the
// transcript is shown or archived. Same tag as exec_context.OPEN/CLOSE.
const CONTEXT_BLOCK = /^\s*<exec-context>[\s\S]*?<\/exec-context>\s*/;

/** A user turn as Wai typed it, without the board state riding in front. */
export function stripExecContext(text) {
  return typeof text === "string" ? text.replace(CONTEXT_BLOCK, "") : text;
}

async function call(name, input) {
  try {
    const r = await fetch(`${API}/api/exec/tool/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "x-cc-token": TOKEN, "content-type": "application/json" },
      body: JSON.stringify(input || {}),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!r.ok) return text(JSON.stringify({ error: `exec-fn answered ${r.status}` }));
    const body = await r.json();
    return text(JSON.stringify(body.result));
  } catch (e) {
    // Said plainly, so the model reports a failed action instead of claiming it.
    return text(JSON.stringify({ error: `exec-fn unreachable: ${e?.message || e}` }));
  }
}

/** The MCP server over whatever schemas are loaded, or null with none. */
export function execServer() {
  const tools = schemas.flatMap((t) => {
    let shape;
    try {
      shape = z.fromJSONSchema(t.input_schema).shape;
    } catch {
      return [];   // a schema zod cannot read is one missing tool, not a dead server
    }
    return [tool(t.name, t.description || "", shape, (input) => call(t.name, input))];
  });
  if (!tools.length) return null;
  return createSdkMcpServer({ name: "exec", version: "1.0.0", tools });
}
