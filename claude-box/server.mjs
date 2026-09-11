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
 * settings.json, and the unit gives the service a tmpfs root with only named
 * paths bound back in, so /exec-fn is absent rather than merely unreadable.
 * Any one of the three failing still leaves two. That third layer did NOT hold
 * as written until 2026-09-10 -- see cc-sidecar.service for what defeated it.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const HOST = process.env.CC_BIND_HOST || "172.17.0.1";
const PORT = Number(process.env.CC_BIND_PORT || 8129);
const SANDBOX = process.env.CC_SANDBOX || "/srv/cc-sandbox";
const TOKEN = process.env.CC_SIDECAR_TOKEN || "";
// The box has ~930MB free and each run spawns a CLI subprocess, so this is a
// memory ceiling expressed as a queue depth, not a politeness limit.
const MAX_CONCURRENT = Number(process.env.CC_MAX_CONCURRENT || 1);
const MAX_TURNS = Number(process.env.CC_MAX_TURNS || 40);
const IDLE_TIMEOUT_MS = Number(process.env.CC_IDLE_TIMEOUT_MS || 10 * 60 * 1000);
// Pasted images. The client downscales to ~1568px before sending (Claude
// downsamples above that anyway), so these ceilings are a guard against a
// pathological paste, not the normal path -- a phone photo arrives ~200KB.
const MAX_IMAGES = Number(process.env.CC_MAX_IMAGES || 4);
const MAX_IMAGE_B64 = Number(process.env.CC_MAX_IMAGE_B64 || 5 * 1024 * 1024);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// NO tools. /cc is a general chat UI on Wai's subscription, not a coding agent:
// nothing here edits a repo, and the page offers no way to download a file the
// agent might write, so a filesystem tool could only produce work nobody can
// reach. Denying the whole set also removes the prompt-injection surface
// outright -- with no Read there is no untrusted content to inject THROUGH, and
// with no WebFetch/WebSearch nothing to exfiltrate through.
//
// ALLOWED_TOOLS is empty, so canUseTool below denies EVERY tool by construction.
// That is deliberate structure, not laziness: a list of blocked NAMES is a
// denylist, and this file has already been burned once by a denylist that only
// covered what someone remembered to write down.
//
// It has to be a denylist-free design because of what the subscription login
// drags in. Signing cc-agent into claude.ai attaches that ACCOUNT's connectors:
// a probe on 2026-09-10 found Gmail, Google Calendar and Google Drive all
// "connected" -- send_message, trash_thread, share_file, download_file_content,
// delete_event -- plus CronCreate, RemoteTrigger and PushNotification. None of
// them are Claude Code built-ins, so a hand-written blocklist missed all of
// them, and none are files, so neither the mount namespace nor settingSources
// touched them. They are server-side capability riding the OAuth identity.
//
// BLOCKED_TOOLS therefore exists only to keep the built-ins out of CONTEXT (a
// tool the model can see, calls, and gets refused on burns a turn and reads as
// the assistant being broken). It is a UX measure. The security is canUseTool.
const ALLOWED_TOOLS = [];
const BLOCKED_TOOLS = [
  "Read", "Write", "Edit", "NotebookEdit",
  "Bash", "BashOutput", "KillShell",
  "Glob", "Grep", "WebFetch", "WebSearch",
  "Task", "TodoWrite",
  // Not Claude Code file tools -- harness capability that also rode in on the
  // login. Cron* schedules agents that outlive the request, Workflow fans out
  // many at once, and RemoteTrigger / PushNotification / SendMessage reach
  // outward. A chat page needs none of them.
  "CronCreate", "CronDelete", "CronList", "DesignSync",
  "EnterWorktree", "ExitWorktree", "ListAgents", "Monitor",
  "PushNotification", "RemoteTrigger", "ReportFindings", "ScheduleWakeup",
  "SendMessage", "Skill", "ToolSearch", "Workflow",
];

// Claude Code's own preset would introduce a terminal coding assistant. This is
// a personal chat page, so the harness's identity is replaced rather than
// appended to. Kept short on purpose -- the point is to remove a persona, not
// impose a new one.
const SYSTEM_PROMPT = [
  "You are Claude, talking with Wai through a personal chat page he built.",
  "This is ordinary conversation, not a coding session: you have no tools, no",
  "filesystem and no repository here, so never offer to run, read or edit",
  "anything, and never describe yourself as a CLI or coding assistant.",
  "Answer as you normally would in conversation.",
  // Without this the model does not know a picture is even possible here, so it
  // describes diagrams in prose instead of drawing them.
  "You CAN draw. A fenced ```svg code block is rendered as a real diagram on",
  "the page, so reach for one whenever a picture explains better than a",
  "paragraph. The canvas is a DARK terminal: use light strokes and text, leave",
  "the background transparent, and never rely on dark-on-dark. Do not set width",
  "or height on the svg element - give it a viewBox and it scales to fit a",
  "phone. You still cannot produce photographs or raster images of any kind.",
].join(" ");

// ONE continuing conversation, owned by the SERVER.
//
// The session id used to live only in a JS variable on the page, so every
// reload silently began a new conversation -- five sessions came out of a
// handful of messages. Holding it here instead means the thread survives a
// reload, a phone locking, and a move between devices, which a browser-side
// value cannot. Wai ends a conversation deliberately; nothing else does.
const SESSION_FILE = path.join(os.homedir(), ".cc-session");
const ARCHIVE_DIR = path.join(os.homedir(), ".cc-archive");

function currentSession() {
  try {
    const id = fs.readFileSync(SESSION_FILE, "utf8").trim();
    return id || null;
  } catch {
    return null;   // absent = start fresh on the next turn
  }
}

function rememberSession(id) {
  if (!id || id === currentSession()) return;
  try {
    fs.writeFileSync(SESSION_FILE, id + "\n", { mode: 0o600 });
  } catch {
    /* a lost pointer costs continuity, never the run in flight */
  }
}

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
      // Reported on subscription runs too (an equivalent-cost estimate, not a
      // charge) -- do not read a non-zero value here as "this is billing per token".
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

/** The stored thread, flattened to what the page renders.
 *
 * Slash-command turns are stored as user messages carrying <command-name> tags;
 * they are machinery, not things Wai typed, so they never reach the transcript.
 * An unreadable or vanished session is an EMPTY history, never an error -- the
 * page must still open and accept a new message. */
async function historyFor(sessionId) {
  if (!sessionId) return [];
  let msgs;
  try {
    msgs = await getSessionMessages(sessionId);
  } catch {
    return [];
  }
  const out = [];
  for (const m of msgs || []) {
    const role = m.message?.role ?? m.role;
    if (role !== "user" && role !== "assistant") continue;
    const blocks = m.message?.content ?? m.content;
    let text = "";
    const images = [];
    if (typeof blocks === "string") text = blocks;
    else if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b?.type === "text") text += b.text;
        // Replay pasted images too. Without this a reload keeps the words and
        // silently drops the picture they were about, which reads as corruption.
        else if (b?.type === "image" && b.source?.type === "base64") {
          images.push({ media_type: b.source.media_type, data: b.source.data });
        }
      }
    }
    text = text.trim();
    if ((!text && !images.length) || text.startsWith("<command-name>")) continue;
    const ts = typeof m.timestamp === "string" ? m.timestamp : "";
    out.push(images.length ? { role, text, images, ts } : { role, text, ts });
  }
  return out;
}

/** Write the whole conversation to disk before it is let go.
 *
 * Clearing is the ONLY way a thread ends, so this is the one choke point; it
 * runs before the pointer is dropped, and a failure here ABORTS the clear
 * rather than losing the transcript silently.
 *
 * Format is fixed and parseable, not pretty-printed: a `key: value` header, a
 * blank line, then one block per message opening with
 * `[NNNN] SPEAKER ISO8601Z`. Index is zero-padded so lexical order is
 * chronological order, the speaker is a bare uppercase word, and timestamps are
 * always UTC with a Z -- nothing about the output varies with locale, timezone
 * or terminal width. Images are written beside the transcript and named from
 * the index that referenced them. */
async function archiveSession(sessionId) {
  const msgs = await historyFor(sessionId);
  if (!msgs.length) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ARCHIVE_DIR, `${stamp}__${sessionId || "unknown"}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const lines = [
    `session: ${sessionId || "unknown"}`,
    `archived: ${new Date().toISOString()}`,
    `messages: ${msgs.length}`,
    "",
  ];
  msgs.forEach((m, i) => {
    const n = String(i + 1).padStart(4, "0");
    const who = m.role === "user" ? "USER" : "ASSISTANT";
    const files = (m.images || []).map((im, j) => {
      const ext = (im.media_type || "image/png").split("/")[1].replace("jpeg", "jpg");
      const name = `img-${n}-${j + 1}.${ext}`;
      try {
        fs.writeFileSync(path.join(dir, name), Buffer.from(im.data, "base64"));
      } catch {
        return null;   // one unwritable image must not cost the transcript
      }
      return name;
    }).filter(Boolean);
    lines.push(`[${n}] ${who} ${m.ts || ""}`.trimEnd());
    if (files.length) lines.push(`images: ${files.join(", ")}`);
    lines.push(m.text || "", "");
  });

  const file = path.join(dir, "conversation.txt");
  fs.writeFileSync(file, lines.join("\n"), { mode: 0o600 });
  return file;
}

function sse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Validate pasted images into Anthropic image blocks, dropping anything odd.
 *
 * A bad block would fail the whole turn, so a malformed entry is discarded and
 * the text still goes through -- losing one image beats losing the message. */
function imageBlocks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const im of list.slice(0, MAX_IMAGES)) {
    const mt = typeof im?.media_type === "string" ? im.media_type : "";
    const data = typeof im?.data === "string" ? im.data : "";
    if (!IMAGE_TYPES.has(mt) || !data || data.length > MAX_IMAGE_B64) continue;
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) continue;   // must be bare base64
    out.push({ type: "image", source: { type: "base64", media_type: mt, data } });
  }
  return out;
}

async function handleQuery(req, res, body) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const images = imageBlocks(body.images);
  if (!prompt && !images.length) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "prompt or image required" }));
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
      systemPrompt: SYSTEM_PROMPT,
      disallowedTools: BLOCKED_TOOLS,
      // Drop the account's claude.ai connectors (Gmail / Calendar / Drive).
      // strictMcpConfig means "only the servers named in mcpServers", and that
      // is the empty set -- so they leave the model's context entirely instead
      // of sitting there connected and merely refused at call time.
      mcpServers: {},
      strictMcpConfig: true,
      canUseTool,   // the actual gate: ALLOWED_TOOLS is empty, so this denies all
      maxTurns: MAX_TURNS,
      // Load NO settings files. The agent has Bash and a writable $HOME, so a
      // settings.json it wrote itself would otherwise be read back as policy.
      settingSources: [],
      abortController: controller,
    };
    // The client does not choose the conversation -- the pointer does, so every
    // device lands in the same thread.
    const resume = currentSession();
    if (resume) options.resume = resume;

    // A string prompt cannot carry images, so once there is one we hand the SDK
    // an async iterable of user messages instead -- same turn, richer content.
    const input = images.length
      ? (async function* () {
          yield {
            type: "user",
            parent_tool_use_id: null,
            message: { role: "user", content: [...images, { type: "text", text: prompt || "" }] },
          };
        })()
      : prompt;

    for await (const msg of query({ prompt: input, options })) {
      touch();
      for (const event of normalize(msg)) {
        if (event.type === "session") rememberSession(event.sessionId);
        sse(res, event);
      }
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
      // Images ride in this body, so the cap is sized for them, not for text.
      if (raw.length > 24 * 1024 * 1024) reject(new Error("body too large"));
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

  if (req.method === "GET" && req.url === "/history") {
    const id = currentSession();
    const messages = await historyFor(id);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sessionId: id, messages }));
    return;
  }

  if (req.method === "POST" && req.url === "/new") {
    // Archive BEFORE dropping the pointer, and refuse to clear if the archive
    // fails -- a clear that loses the transcript is the one outcome worth
    // failing loudly for. The SDK's own session files stay under
    // ~/.claude/projects either way; this is the readable copy.
    const id = currentSession();
    let archived = null;
    try {
      archived = await archiveSession(id);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: `archive failed: ${err.message}` }));
      return;
    }
    try {
      fs.rmSync(SESSION_FILE, { force: true });
    } catch { /* already gone */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, archived }));
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
