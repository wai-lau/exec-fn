/* The Exec panel's command layer: what a leading slash means before anything is sent.
 *
 * Split out of exec-bubble.js at the 500-line cap and named for what it holds. Loaded
 * before it, same global scope, so sendMsg calls execRunCommand by bare name.
 *
 * Three kinds of command meet here. The page's own (/new, /clear, /list,
 * /listall, /back, /help) never leave the browser. The SDK's own -- probed
 * 2026-09-11, not assumed -- are passed through to be answered for free, in
 * zero turns, without reaching the model. Everything else is refused with the
 * list, rather than sent to Claude as a sentence beginning with a slash.
 */
'use strict';

// `/clear` is deliberately NOT in this set: the SDK honours it SILENTLY, which
// would drop the conversation without the archive /new writes first. /help,
// /status and /memory answer "isn't available in this environment" (ours wins
// for /help, since the page never forwards it); /agents says it was removed.
const EXEC_SDK_COMMANDS = new Set(['context', 'cost', 'usage', 'compact', 'model']);

// Aliases share a row rather than getting one each. "/clear -- same as /new"
// spends a line of a phone-width list saying nothing: the reader has to hold
// two names to learn there is one behaviour. Listing them together says it in
// the shape instead. Each entry is [names, what] and the names render joined.
const EXEC_HELP = [
  [['/new', '/clear'], 'end this conversation (archived first)'],
  [['/list'], 'recent conversations, tap one to resume'],
  [['/listall'], 'every conversation'],
  [['/back'], 'the last conversation you were in'],
  [['/help'], 'this list'],
  [['/context'], 'token usage of this conversation'],
  [['/cost', '/usage'], 'subscription usage against the plan'],
  [['/compact'], 'summarise the conversation to free context'],
  [['/model'], 'show the model; /model <name> switches it'],
];

function execHelp() {
  const box = document.createElement('div');
  box.className = 'msg exec-list';
  for (const [names, what] of EXEC_HELP) {
    const row = document.createElement('div');
    row.className = 'exec-help-row';
    const cmd = document.createElement('span');
    cmd.className = 'exec-help-cmd';
    cmd.textContent = names.join(' · ');
    const desc = document.createElement('span');
    desc.className = 'exec-help-what';
    desc.textContent = what;
    row.appendChild(cmd);
    row.appendChild(desc);
    box.appendChild(row);
  }
  execTermEl.appendChild(box);
  execTermEl.scrollTop = execTermEl.scrollHeight;
}

/** Slash commands, handled client-side. The page has no chrome by design (it is
 * the mtg terminal), so the control is typed rather than a button. */
async function execRunCommand(text) {
  const cmd = text.slice(1).trim().toLowerCase();
  if (cmd === 'help') { execHelp(); return true; }
  if (cmd === 'list') { await execListSessions(EXEC_LIST_LIMIT); return true; }
  if (cmd === 'listall') { await execListSessions(0); return true; }
  if (cmd === 'back') { await execBackSession(); return true; }
  // Commands the SDK answers itself, passed through on purpose. They cost no
  // turn and never reach the model -- it replies "isn't available in this
  // environment" for the ones it does not have. `false` = not handled here, so
  // sendMsg goes on to send it like any other message.
  if (EXEC_SDK_COMMANDS.has(cmd.split(/\s+/)[0])) return false;
  if (cmd !== 'new' && cmd !== 'clear') {
    execAddMsg('sys warn', '[ unknown: /' + cmd + ' — /help lists them ]');
    return true;
  }
  try {
    const r = await fetch('/api/cc/new', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) {
      // The archive runs BEFORE the clear and a failure aborts it, so the old
      // conversation is still intact — say so rather than leaving it ambiguous.
      execAddMsg('sys warn', '[ not cleared — ' + (d.error || 'archive failed') + '; conversation kept ]');
      return true;
    }
    execTermEl.textContent = '';
    execAddMsg('sys', '[ new conversation — the previous one is archived ]');
    // The context is back to the floor; the status bar caches its last value
    // and would otherwise keep showing the old conversation's.
    execTermEl.dispatchEvent(new CustomEvent('exec:conversation-new'));
    // An empty terminal is the one moment the past is worth showing: what was
    // just archived is one tap away instead of one remembered command, and the
    // page opens on something rather than on nothing. Same rows /list draws --
    // no `current` row now, since the pointer was just dropped.
    await execListSessions(EXEC_LIST_LIMIT);
  } catch {
    execAddMsg('sys warn', '[ could not start a new conversation ]');
  }
  return true;
}

// ── run ───────────────────────────────────────────────────────────────────
