/**
 * Rolling conversation titles, generated AND checked on the subscription.
 *
 * Two model calls, not one. The generator writes a title; a second, independent
 * haiku call judges whether it is title SHAPED and, when it isn't, says why in
 * one sentence -- which is handed back to the generator as feedback. A model
 * grading its own output in the same breath talks itself into whatever it just
 * wrote; a fresh call with only the title in front of it does not.
 *
 * On the PLAN, deliberately: this is Claude Code's own subscription login, the
 * same account /cc itself runs on, so titling a conversation costs no API
 * credit. (api/cc_title.py used to call the Anthropic API with the key that
 * bills per token. It now calls this.)
 *
 * The price is memory, and this box has an OOM history: each call spawns a CLI
 * subprocess measured at ~304MB peak / ~6.9s. So a title run is single-flight
 * and yields entirely while a real query is in flight -- two 300MB subprocesses
 * inside the unit's 700M cgroup is exactly the stack that gets something killed.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = "claude-haiku-4-5";
const CALL_TIMEOUT_MS = 60 * 1000;
// One retry, not three. Each attempt is a generate + a judge, so this already
// tops out at four subprocesses (~28s); a title is not worth more than that,
// and the feedback loop's whole gain lands on the first retry anyway.
const MAX_RETRIES = 1;
const MAX_MSGS = 12;
const MAX_CHARS = 400;

// What "title shaped" means. ONE definition, quoted to both the writer and the
// judge, so the thing being asked for and the thing being checked cannot drift
// apart. (session-recap-gen.js carries its own copy of this for the terminal
// statusline -- it runs as wai-root, outside this unit's tmpfs root, and cannot
// import anything from here. Change one, change the other.)
const SHAPE = [
  "A title is SHAPED like this:",
  "1. Three to six words.",
  "2. A noun phrase naming the subject. Not a sentence, not a command, not a question.",
  "3. No trailing punctuation, no surrounding quotes, no preamble ('Title:', 'Here is').",
  "4. Not first person and not addressed to the reader ('Let me help you with', 'Your question about').",
  "5. Not a verbatim or near-verbatim echo of a message. A title NAMES the topic; it does not quote the prompt.",
  "6. Not generic filler ('Chat Session', 'General Discussion', 'Coding Help', 'Various Topics', 'Untitled').",
  "   It has to be specific enough to pick this conversation out of a list of forty.",
  "7. About what the conversation is CURRENTLY on, weighting the latest messages most.",
].join("\n");

const WRITE_SYSTEM =
  "You are titling a conversation for a narrow status bar.\n" +
  SHAPE +
  "\nOutput ONLY the title. No quotes, no trailing punctuation, no preamble.";

const JUDGE_SYSTEM =
  "You check whether a proposed conversation title is title SHAPED.\n" +
  SHAPE +
  "\nYou are given a PROPOSED TITLE and, for context only, the conversation it" +
  " names. Judge the proposed title exactly as given. Do NOT write a title of" +
  " your own, and do not judge a better one you thought of -- a measured judge" +
  " passed 'Chat Session' by quietly substituting its own title and grading" +
  " that. Be strict about shape but do not bikeshed word choice: right shape," +
  " right subject, it passes.\n" +
  'Reply with JSON and nothing else: {"ok":true} or {"ok":false,"feedback":' +
  '"<one sentence: what is wrong and what to do instead>"}.';

// Generic enough to name any conversation, which means it names none of them.
const GENERIC = new Set([
  "chat session", "chat", "conversation", "general discussion", "general chat",
  "coding help", "technical discussion", "various topics", "untitled",
  "new conversation", "help request", "assistant conversation", "discussion",
]);

/**
 * The deterministic floor, checked BEFORE spending a call on the judge.
 *
 * Most of "title shaped" is countable -- word count, trailing punctuation,
 * quotes, a preamble, filler, second person, a verbatim echo -- and code checks
 * those perfectly while a model is merely likely to. Measured: a haiku judge
 * PASSED both "Chat Session" and "Sourdough" on a real transcript (it wrote its
 * own title and graded that instead), and every one of the five bad titles in
 * that test is caught here for free. The model judge still runs, on everything
 * left over: whether the title actually names what the conversation is about,
 * which is the part no rule can check.
 *
 * Returns a feedback sentence, or null when the title clears the floor.
 */
function shapeFault(title, body) {
  const t = (title || "").trim();
  if (!t) return "it was empty";
  const words = t.split(/\s+/);
  if (words.length < 3) {
    return `it is only ${words.length} word${words.length === 1 ? "" : "s"}; a title is three to six words naming the subject`;
  }
  if (words.length > 6) {
    return `it is ${words.length} words; a title is three to six words`;
  }
  if (/[.!?,:;]$/.test(t)) return "it ends in punctuation; drop the trailing mark";
  if (/^["'`]|["'`]$/.test(t)) return "it is wrapped in quotes; drop them";
  if (/^(title|here|sure|okay)\b/i.test(t)) {
    return "it starts with a preamble; output the title by itself";
  }
  if (GENERIC.has(t.toLowerCase())) {
    return "it is generic filler that would fit any conversation; name what THIS one is specifically about";
  }
  if (/^(let me|i can|i will|i'll|your |you )/i.test(t)) {
    return "it addresses the reader; use a noun phrase naming the subject instead";
  }
  if (t.length > 12 && body && body.toLowerCase().includes(t.toLowerCase())) {
    return "it quotes a message verbatim; name the topic rather than echoing the prompt";
  }
  return null;
}

/** Strip the things a model wraps a bare title in. */
function clean(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 60)
    .trim();
}

/** The conversation, trimmed to what a title can actually be about. */
function transcript(messages) {
  const recent = (messages || [])
    .filter((m) => (m && m.text ? String(m.text).trim() : ""))
    .slice(-MAX_MSGS);
  return recent
    .map((m) => `${m.role || "user"}: ${String(m.text).slice(0, MAX_CHARS)}`)
    .join("\n");
}

/**
 * One bounded, tool-less model call on the subscription.
 *
 * Hardened the same way the chat path is and then some: no MCP servers at all
 * (strictMcpConfig makes that "only the ones named here", which is none, so the
 * account's connectors are absent rather than merely refused), no settings
 * files, one turn. A titler needs no tools, so it gets none.
 */
async function ask(systemPrompt, prompt, { sandbox, blockedTools }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    let out = "";
    const run = query({
      prompt,
      options: {
        cwd: sandbox,
        model: MODEL,
        systemPrompt,
        maxTurns: 1,
        allowedTools: [],
        disallowedTools: blockedTools,
        mcpServers: {},
        strictMcpConfig: true,
        canUseTool: async () => ({ behavior: "deny", message: "no tools" }),
        settingSources: [],
        abortController: controller,
      },
    });
    for await (const msg of run) {
      if (msg?.type !== "assistant") continue;
      for (const block of msg.message?.content || []) {
        if (block?.type === "text") out += block.text;
      }
    }
    return out.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Read the judge's verdict without trusting it to be bare JSON.
 *
 * "Reply with JSON only" is a request, not a guarantee. Measured replies came
 * back wrapped in ```json fences, as a one-element ARRAY, and as an object
 * followed by a paragraph of prose. So this does not parse JSON at all: it
 * reads the two fields out of the text directly, which survives every one of
 * those shapes. An unreadable verdict PASSES -- a judge that cannot make itself
 * understood must not be able to veto a perfectly good title.
 */
function verdict(raw) {
  const text = String(raw || "");
  const ok = /"ok"\s*:\s*(true|false)/i.exec(text);
  if (!ok) return { ok: true };
  const fb = /"feedback"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(text);
  return {
    ok: ok[1].toLowerCase() === "true",
    feedback: fb ? fb[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim() : "",
  };
}

/**
 * Generate a title, check it, and retry once with the judge's feedback.
 *
 * Returns { title, attempts, ok } -- `ok` says whether the title it hands back
 * actually passed. A title that never passes is still RETURNED: the last
 * attempt had the most feedback behind it, and a mediocre title beats a blank
 * status bar. The caller decides what to do with `ok`.
 */
export async function generateTitle(messages, opts = {}) {
  const body = transcript(messages);
  if (!body) return { title: null, attempts: 0, ok: false };

  let title = null;
  let feedback = "";
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const prompt = feedback
      ? `${body}\n\nYour previous attempt was "${title}", which was REJECTED: ` +
        `${feedback}\nWrite a better title that fixes exactly that.`
      : body;
    const next = clean(await ask(WRITE_SYSTEM, prompt, opts));
    if (!next) break;          // nothing came back; keep whatever we already had
    title = next;

    // The free check first: when code can already say what is wrong, spending a
    // ~300MB subprocess to be told the same thing (or, worse, to be told
    // nothing is wrong) buys nothing.
    const fault = shapeFault(title, body);
    if (fault) {
      feedback = fault;
      continue;
    }
    // The proposed title goes FIRST. Trailing it after the transcript is what
    // let the judge lose track of which string it was grading.
    const judged = verdict(
      await ask(JUDGE_SYSTEM, `PROPOSED TITLE: ${title}\n\nCONVERSATION (context only):\n${body}`, opts),
    );
    if (judged.ok) return { title, attempts: attempt, ok: true };
    feedback = judged.feedback || "it was not title shaped";
  }
  return { title, attempts: MAX_RETRIES + 1, ok: false };
}
