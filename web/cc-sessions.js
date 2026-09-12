/* `/list` — past conversations, tappable, to pick one back up.
 *
 * /cc is ONE continuing thread and the sidecar owns which one (a pointer file,
 * not a value on the page), so switching conversations is a one-line change on
 * the server and nothing here needs a session id in its URL. Resuming copies
 * nothing and loses nothing: the pointer moves, the transcript replays.
 *
 * Rows are TAPPABLE rather than numbered-and-typed. This page is used one-handed
 * on a phone, where "/resume 3" means reading a list, remembering an index, and
 * typing it without the keyboard covering the thing you are reading from.
 *
 * Loaded before cc.js, same global scope: it calls terminal/addMsg/loadHistory
 * by bare name, all of which exist by the time a command can be typed.
 */
'use strict';

/** "3h", "yesterday", "6d" -- a list is scanned, not read. */
function ccWhen(ms) {
  if (!ms) return '';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return mins + 'm';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : days + 'd';
}

async function ccResumeSession(id, title) {
  try {
    const r = await fetch('/api/cc/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) {
      addMsg('sys warn', '[ could not switch: ' + (d.error || 'unknown session') + ' ]');
      return;
    }
    // The pointer moved; everything on screen belongs to the old thread.
    terminal.textContent = '';
    if (typeof ccStatusState === 'object') ccStatusState.title = title || '';
    await loadHistory();
    if (typeof ccTitleFetch === 'function') ccTitleFetch();
    if (typeof ccStatusRender === 'function') ccStatusRender();
  } catch {
    addMsg('sys warn', '[ could not switch conversation ]');
  }
}

// /list shows the recent ones; /listall shows every one. Twenty is about what
// fits a phone screen without becoming a thing to scroll through, and the ones
// past it are old enough that you would search rather than browse.
const CC_LIST_LIMIT = 20;

async function ccFetchSessions() {
  try {
    const r = await fetch('/api/cc/sessions', { cache: 'no-store' });
    return await r.json();
  } catch {
    return null;
  }
}

/** Switch to the most recently touched conversation that is not this one. */
async function ccBackSession() {
  const data = await ccFetchSessions();
  const rows = (data && data.sessions) || [];
  const prev = rows.find((s) => s.id !== data.current);
  if (!prev) {
    addMsg('sys', '[ no other conversation ]');
    return;
  }
  await ccResumeSession(prev.id, prev.title);
}

async function ccListSessions(limit) {
  const data = await ccFetchSessions();
  if (!data) {
    addMsg('sys warn', '[ could not list conversations ]');
    return;
  }
  let rows = data.sessions || [];
  if (!rows.length) {
    addMsg('sys', '[ no past conversations ]');
    return;
  }
  const total = rows.length;
  if (limit) rows = rows.slice(0, limit);
  // Oldest first, so the most recent sits at the BOTTOM -- nearest the composer
  // and where the eye already is, the same way the transcript itself reads.
  rows = rows.slice().reverse();

  const box = document.createElement('div');
  box.className = 'msg cc-list';
  for (const s of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cc-sess' + (s.id === data.current ? ' current' : '');
    const name = document.createElement('span');
    name.className = 'cc-sess-title';
    name.textContent = s.title || '(untitled)';
    const when = document.createElement('span');
    when.className = 'cc-sess-when';
    when.textContent = s.id === data.current ? 'current' : ccWhen(s.modified);
    row.appendChild(name);
    row.appendChild(when);
    // The current one is not a destination; tapping it would clear the screen
    // and replay exactly what is already on it.
    if (s.id !== data.current) {
      row.addEventListener('click', () => ccResumeSession(s.id, s.title));
    } else {
      row.disabled = true;
    }
    box.appendChild(row);
  }
  terminal.appendChild(box);
  if (limit && total > limit) {
    addMsg('sys', '[ ' + limit + ' of ' + total + ' — /listall for the rest ]');
  }
  terminal.scrollTop = terminal.scrollHeight;
}
