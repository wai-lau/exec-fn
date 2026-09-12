/* The /cc command layer: what a leading slash means before anything is sent.
 *
 * Split out of cc.js at the 500-line cap and named for what it holds. Loaded
 * before it, same global scope, so sendMsg calls runCommand by bare name.
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
const CC_SDK_COMMANDS = new Set(['context', 'cost', 'usage', 'compact', 'model']);

const CC_HELP = [
  ['/new', 'end this conversation (archived first)'],
  ['/clear', 'same as /new'],
  ['/list', 'recent conversations, tap one to resume'],
  ['/listall', 'every conversation'],
  ['/back', 'the last conversation you were in'],
  ['/help', 'this'],
  ['/context', 'token usage of this conversation'],
  ['/cost', 'subscription usage'],
  ['/usage', 'same as /cost'],
  ['/compact', 'summarise the conversation to free context'],
  ['/model', 'show the model; /model <name> switches it'],
];

function ccHelp() {
  const box = document.createElement('div');
  box.className = 'msg cc-list';
  for (const [name, what] of CC_HELP) {
    const row = document.createElement('div');
    row.className = 'cc-help-row';
    const cmd = document.createElement('span');
    cmd.className = 'cc-help-cmd';
    cmd.textContent = name;
    const desc = document.createElement('span');
    desc.className = 'cc-help-what';
    desc.textContent = what;
    row.appendChild(cmd);
    row.appendChild(desc);
    box.appendChild(row);
  }
  terminal.appendChild(box);
  terminal.scrollTop = terminal.scrollHeight;
}

/** Slash commands, handled client-side. The page has no chrome by design (it is
 * the mtg terminal), so the control is typed rather than a button. */
async function runCommand(text) {
  const cmd = text.slice(1).trim().toLowerCase();
  if (cmd === 'help') { ccHelp(); return true; }
  if (cmd === 'list') { await ccListSessions(CC_LIST_LIMIT); return true; }
  if (cmd === 'listall') { await ccListSessions(0); return true; }
  if (cmd === 'back') { await ccBackSession(); return true; }
  // Commands the SDK answers itself, passed through on purpose. They cost no
  // turn and never reach the model -- it replies "isn't available in this
  // environment" for the ones it does not have. `false` = not handled here, so
  // sendMsg goes on to send it like any other message.
  if (CC_SDK_COMMANDS.has(cmd.split(/\s+/)[0])) return false;
  if (cmd !== 'new' && cmd !== 'clear') {
    addMsg('sys warn', '[ unknown: /' + cmd + ' — /help lists them ]');
    return true;
  }
  try {
    const r = await fetch('/api/cc/new', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) {
      // The archive runs BEFORE the clear and a failure aborts it, so the old
      // conversation is still intact — say so rather than leaving it ambiguous.
      addMsg('sys warn', '[ not cleared — ' + (d.error || 'archive failed') + '; conversation kept ]');
      return true;
    }
    terminal.textContent = '';
    addMsg('sys', '[ new conversation — the previous one is archived ]');
    // The context is back to the floor; the status bar caches its last value
    // and would otherwise keep showing the old conversation's.
    terminal.dispatchEvent(new CustomEvent('cc:conversation-new'));
  } catch {
    addMsg('sys warn', '[ could not start a new conversation ]');
  }
  return true;
}

// ── run ───────────────────────────────────────────────────────────────────
