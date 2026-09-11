/* The subscription's 5h / 7d windows — the numbers the CLI's own status line
 * shows, from the place the CLI gets them.
 *
 * The SDK does not carry them: `rate_limit_event` is declared in its .d.ts but
 * appears ZERO times in the shipped runtime (0.3.265), and nothing the CLI
 * writes to disk holds them either. What the CLI actually does is read
 * `anthropic-ratelimit-unified-*` response headers, and ask
 * `GET /api/oauth/usage` — both strings are in its binary. The endpoint is the
 * one reachable from outside a request, so that is what this uses.
 *
 * THE TOKEN NEVER LEAVES THIS PROCESS. cc-agent's own OAuth access token is
 * read here and exchanged for two percentages; the page is handed the
 * percentages. It is also never refreshed here -- two processes on one refresh
 * token race, which is the whole reason this account has its own login, so an
 * expired token degrades to "no numbers" and the CLI fixes it on its next run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CREDS = path.join(os.homedir(), ".claude", ".credentials.json");
// The windows move in percent-points per hour, so a minute of staleness is
// invisible -- and this way a page left open all night is not a poller.
const TTL_MS = 60000;
const TIMEOUT_MS = 6000;

let cache = { at: 0, data: null };

function token() {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDS, "utf8"));
    return (raw.claudeAiOauth && raw.claudeAiOauth.accessToken) || null;
  } catch {
    return null;   // not logged in yet: no numbers, not an error
  }
}

/** One window, flattened to what a status line needs. */
function win(w) {
  if (!w || w.utilization == null) return null;
  const resets = w.resets_at ? Date.parse(w.resets_at) : null;
  return { pct: w.utilization, resetsAt: Number.isFinite(resets) ? Math.floor(resets / 1000) : null };
}

export async function usage() {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  const tok = token();
  if (!tok) return { ok: false };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(USAGE_URL, {
      headers: {
        authorization: "Bearer " + tok,
        "anthropic-beta": "oauth-2025-04-20",
        accept: "application/json",
      },
      signal: ctl.signal,
    });
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json();
    const data = {
      ok: true,
      five_hour: win(j.five_hour),
      seven_day: win(j.seven_day),
      seven_day_opus: win(j.seven_day_opus),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return { ok: false };     // offline, slow, or refused: the bar just omits it
  } finally {
    clearTimeout(timer);
  }
}
