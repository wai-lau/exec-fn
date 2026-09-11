/* The archive, as three tools instead of a filesystem.
 *
 * /new writes the whole conversation to ~cc-agent/.cc-archive/<stamp>__<id>/
 * before dropping the session pointer, so nothing is ever lost -- but the agent
 * could not reach any of it and answered "no filesystem, no history store
 * here", which is true and useless: the history is right there.
 *
 * Giving it Read would have been the lazy fix and the wrong one. Read is a
 * filesystem, and a filesystem is every file the unit can see. These three
 * tools are the capability actually wanted -- list, search, read, over ONE
 * directory of Wai's own past conversations -- and nothing else is reachable
 * through them.
 *
 * Containment is enforced twice on every call: the id must match a strict
 * pattern (no separators, no dots, so `..` cannot be spelled), and the resolved
 * path must still sit inside the archive root. The second check is what
 * survives a future edit to the first.
 */

import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ID_RE = /^[A-Za-z0-9_:-]+$/;      // stamp__session-id, nothing exotic
const READ_CAP = 40000;                  // chars per read_conversation call
const SNIPPET = 160;
const MAX_HITS = 40;

const text = (s) => ({ content: [{ type: "text", text: s }] });

/** Resolve one archive id to its transcript, or throw.
 *
 * Exported for the containment check -- a guard nobody can run is a guard
 * nobody knows still works. */
export function transcriptPath(root, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new Error("bad conversation id");
  }
  const dir = path.resolve(root, id);
  // Belt to the pattern's braces: whatever the pattern lets through, the
  // resolved path still has to live under the archive root.
  if (dir !== path.resolve(root) && !dir.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("bad conversation id");
  }
  return path.join(dir, "conversation.txt");
}

function entries(root) {
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];        // no archive yet is an empty list, never an error
  }
  // The stamp leads the name and is zero-padded ISO, so lexical sort IS
  // chronological -- newest first without stat()ing anything.
  return names.sort().reverse();
}

function head(file, lines = 40) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").slice(0, lines);
  } catch {
    return [];
  }
}

/** First thing Wai actually said, which is what a conversation is "about". */
function preview(file) {
  const rows = head(file, 60);
  const i = rows.findIndex((r) => /^\[\d+\] USER\b/.test(r));
  if (i < 0) return "";
  const body = rows.slice(i + 1).find((r) => r.trim() && !r.startsWith("images:"));
  return (body || "").slice(0, SNIPPET);
}

export const ARCHIVE_TOOL_NAMES = [
  "mcp__archive__list_conversations",
  "mcp__archive__search_conversations",
  "mcp__archive__read_conversation",
];

export function archiveServer(root) {
  return createSdkMcpServer({
    name: "archive",
    version: "1.0.0",
    tools: [
      tool(
        "list_conversations",
        "List Wai's archived /cc conversations, newest first. Each entry has the id to pass to read_conversation, when it was archived, how many messages it held, and the opening line.",
        { limit: z.number().int().min(1).max(200).optional() },
        async ({ limit }) => {
          const ids = entries(root).slice(0, limit || 50);
          if (!ids.length) return text("No archived conversations yet.");
          const rows = ids.map((id) => {
            const file = transcriptPath(root, id);
            const hdr = head(file, 4);
            const count = (hdr.find((r) => r.startsWith("messages:")) || "").replace("messages:", "").trim();
            const when = (hdr.find((r) => r.startsWith("archived:")) || "").replace("archived:", "").trim();
            return `${id}\n  archived ${when} · ${count} messages\n  opens: ${preview(file)}`;
          });
          return text(`${ids.length} archived conversation(s):\n\n${rows.join("\n\n")}`);
        },
      ),
      tool(
        "search_conversations",
        "Search every archived conversation for a phrase (case-insensitive). Returns matching lines with the conversation id, so you can then read the one that matters.",
        { query: z.string().min(2), limit: z.number().int().min(1).max(100).optional() },
        async ({ query, limit }) => {
          const needle = query.toLowerCase();
          const cap = limit || MAX_HITS;
          const hits = [];
          for (const id of entries(root)) {
            let body = "";
            try {
              body = fs.readFileSync(transcriptPath(root, id), "utf8");
            } catch {
              continue;   // a half-written archive must not stop the search
            }
            for (const line of body.split("\n")) {
              if (!line.toLowerCase().includes(needle)) continue;
              hits.push(`${id}: ${line.trim().slice(0, SNIPPET)}`);
              if (hits.length >= cap) break;
            }
            if (hits.length >= cap) break;
          }
          if (!hits.length) return text(`No archived conversation mentions "${query}".`);
          return text(`${hits.length} match(es):\n\n${hits.join("\n")}`);
        },
      ),
      tool(
        "read_conversation",
        "Read one archived conversation by id. Long transcripts are returned in slices -- pass `from` (a character offset) to continue where the last slice stopped.",
        { id: z.string(), from: z.number().int().min(0).optional() },
        async ({ id, from }) => {
          let body;
          try {
            body = fs.readFileSync(transcriptPath(root, id), "utf8");
          } catch {
            return text(`No archived conversation "${id}". Use list_conversations for the ids.`);
          }
          const start = from || 0;
          const slice = body.slice(start, start + READ_CAP);
          const end = start + slice.length;
          const more = end < body.length
            ? `\n\n[ ${end} of ${body.length} chars. Continue with from=${end}. ]`
            : "";
          return text(slice + more);
        },
      ),
    ],
  });
}
