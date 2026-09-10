/**
 * Sandboxed Claude Code sidecar.
 *
 * Runs as cc-agent on the droplet HOST (the api container is python:3.12-slim
 * and has neither node nor the CLI), bound to the docker bridge so only the
 * container can reach it -- exactly the hosaka/emet/printer idiom. Never bind
 * 0.0.0.0 here: nginx does not proxy this port, and that is load-bearing.
 *
 * Auth is cc-agent's OWN subscription login in ~/.claude. Sharing wai-root's
 * credentials.json instead would put two processes on one OAuth refresh token
 * and log the interactive session out mid-refresh.
 *
 * The security model is three independent layers, because the in-process one is
 * the weakest: canUseTool (below) is a deterministic allowlist, settingSources
 * is empty so the agent cannot grant itself tools by writing its own
 * settings.json, and systemd's mount namespace means /exec-fn is not merely
 * unreadable but absent. Any one of the three failing still leaves two.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

const HOST = process.env.CC_BIND_HOST || "172.17.0.1";
const PORT = Number(process.env.CC_BIND_PORT || 8129);
const SANDBOX = process.env.CC_SANDBOX || "/srv/cc-sandbox";
const TOKEN = process.env.CC_SIDECAR_TOKEN || "";
// The box has ~930MB free and each run spawns a CLI subprocess, so this is a
// memory ceiling expressed as a queue depth, not a politeness limit.
const MAX_CONCURRENT = Number(process.env.CC_MAX_CONCURRENT || 1);
const MAX_TURNS = Number(process.env.CC_MAX_TURNS || 40);
const IDLE_TIMEOUT_MS = Number(process.env.CC_IDLE_TIMEOUT_MS || 10 * 60 * 1000);

// Chosen blast radius: full authoring power, confined to SANDBOX. WebFetch and
// WebSearch are absent deliberately -- they would let a prompt-injected page
// exfiltrate sandbox contents outward, which the mount namespace cannot stop.
const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

let active = 0;

/** Whether cc-agent has completed its subscription login.
 *
 * Checked per call, never cached: the file appears the moment the one-time
 * `sudo -u cc-agent -H /usr/bin/claude` + /login finishes, and a cached false
 * would keep the page saying "login needed" until someone restarted the unit.
 * Advisory only -- a run is never blocked on it. */
function hasLogin() {
  try {
    return fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json"));
  } catch {
    return false;
  }
}

const isAuthed = (req) =>
  Boolean(TOKEN) && req.headers["x-cc-token"] === TOKEN;

/** Deterministic permission gate -- the ONLY one.
 *
 * These names are deliberately NOT passed as `allowedTools`. A bare allowedTools
 * entry auto-approves the whole tool BEFORE this callback is consulted, which
 * the SDK reports as CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: the gate silently stops
 * running for exactly the tools that matter most. Letting every tool fall
 * through to here keeps one decision point instead of two overlapping ones.
 *
 * Answering for EVERY request is the other half: a tool with no decision falls
 * through to an interactive prompt, and headless there is nobody to answer it --
 * the run stalls until the idle timeout instead of failing cleanly. */
async function canUseTool(toolName) {
  if (ALLOWED_TOOLS.includes(toolName)) {
    return { behavior: "allow", updatedInput: undefined };
  }
  return { behavior: "deny", message: `${toolName} is not available in the sandbox.` };
}

/** Flatten one SDK message into the small stable shape the browser renders.
 *
 * Written against both content-block shapes the SDK has shipped (`msg.message
 * .content` and a bare `msg.content`) so an SDK bump cannot silently blank the
 * transcript -- an unrecognised message becomes no events, never a crash. */
function normalize(msg) {
  const out = [];
  if (!msg || typeof msg !== "object") return out;

  if (msg.type === "system" && msg.subtype === "init") {
    out.push({ type: "session", sessionId: msg.session_id, model: msg.model });
    return out;
  }

  if (msg.type === "result") {
    out.push({
      type: "done",
      subtype: msg.subtype,
      turns: msg.num_turns,
      ms: msg.duration_ms,
      // Present on API-key auth, absent (or 0) on subscription auth.
      costUsd: msg.total_cost_usd,
    });
    return out;
  }

  const blocks = msg.message?.content ?? msg.content;
  if (typeof blocks === "string") {
    if (msg.type === "assistant") out.push({ type: "text", text: blocks });
    return out;
  }
  if (!Array.isArray(blocks)) return out;

  for (const b of blocks) {
    if (b.type === "text" && msg.type === "assistant") {
      out.push({ type: "text", text: b.text });
    } else if (b.type === "thinking") {
      out.push({ type: "thinking", text: b.thinking ?? "" });
    } else if (b.type === "tool_use") {
      out.push({ type: "tool", name: b.name, input: b.input });
    } else if (b.type === "tool_result") {
      let text = b.content;
      if (Array.isArray(text)) {
        text = text.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join("");
      }
      out.push({
        type: "tool_result",
        isError: Boolean(b.is_error),
        text: typeof text === "string" ? text : JSON.stringify(text ?? ""),
      });
    }
  }
  return out;
}

function sse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function handleQuery(req, res, body) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "prompt required" }));
    return;
  }
  if (active >= MAX_CONCURRENT) {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "busy", detail: "a run is already in flight" }));
    return;
  }

  active += 1;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    // nginx is not in this path today, but the header costs nothing and a
    // buffering proxy would otherwise hold the whole stream to the end.
    "x-accel-buffering": "no",
  });

  const controller = new AbortController();
  // A browser that navigates away must not leave a CLI subprocess resident --
  // at MAX_CONCURRENT 1 one orphan wedges every later request.
  const onClose = () => controller.abort();
  req.on("close", onClose);

  let idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };

  try {
    const options = {
      cwd: SANDBOX,
      permissionMode: "default",
      canUseTool,
      maxTurns: MAX_TURNS,
      // Load NO settings files. The agent has Bash and a writable $HOME, so a
      // settings.json it wrote itself would otherwise be read back as policy.
      settingSources: [],
      abortController: controller,
    };
    if (typeof body.sessionId === "string" && body.sessionId) {
      options.resume = body.sessionId;
    }

    for await (const msg of query({ prompt, options })) {
      touch();
      for (const event of normalize(msg)) sse(res, event);
    }
  } catch (err) {
    const aborted = controller.signal.aborted;
    sse(res, {
      type: "error",
      detail: aborted ? "run cancelled or timed out" : String(err?.message || err),
    });
  } finally {
    clearTimeout(idle);
    req.off("close", onClose);
    active -= 1;
    res.end();
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 64 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!isAuthed(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ ok: true, busy: active >= MAX_CONCURRENT, active, authed: hasLogin() }),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/query") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message) }));
      return;
    }
    await handleQuery(req, res, body);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`cc-sidecar listening on ${HOST}:${PORT} sandbox=${SANDBOX}`);
});
