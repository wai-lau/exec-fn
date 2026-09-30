/* `/list` — past conversations, tappable, to pick one back up.
 *
 * Exec is ONE continuing thread and the sidecar owns which one (a pointer file,
 * not a value on the page), so switching conversations is a one-line change on
 * the server and nothing here needs a session id in its URL. Resuming copies
 * nothing and loses nothing: the pointer moves, the transcript replays.
 *
 * Rows are TAPPABLE rather than numbered-and-typed. This page is used one-handed
 * on a phone, where "/resume 3" means reading a list, remembering an index, and
 * typing it without the keyboard covering the thing you are reading from.
 *
 * Loaded before exec-bubble.js, same global scope: it calls terminal/addMsg/loadHistory
 * by bare name, all of which exist by the time a command can be typed.
 */
'use strict';

/** How long ago, as `<1m` / `45m` / `2h 20m` / `3d 14h 3m`.
 *
 * Minutes are the floor and days the ceiling -- no seconds, because nothing in
 * a list of conversations turns on them, and no weeks or months, because "3w"
 * makes you do arithmetic to compare it with "9d". Leading zero units are
 * dropped and trailing ones too (`2h`, not `2h 0m`), but an interior zero stays
 * (`3d 0h 5m`) so the columns keep their meaning. */
function execWhen(ms) {
  if (!ms) return '';
  let mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return '<1m';
  const d = Math.floor(mins / 1440);
  mins -= d * 1440;
  const h = Math.floor(mins / 60);
  const m = mins - h * 60;
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h || (d && m)) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  return parts.join(' ');
}

async function execResumeSession(id, title) {
  try {
    const r = await fetch('/api/cc/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) {
      execAddMsg('sys warn', '[ could not switch: ' + (d.error || 'unknown session') + ' ]');
      return;
    }
    // The pointer moved; everything on screen belongs to the old thread.
    execTermEl.textContent = '';
    await execLoadHistory();
    if (typeof execStatusRender === 'function') execStatusRender();
  } catch {
    execAddMsg('sys warn', '[ could not switch conversation ]');
  }
}

// /list shows the recent ones; /listall shows every one. Twenty is about what
// fits a phone screen without becoming a thing to scroll through, and the ones
// past it are old enough that you would search rather than browse.
const EXEC_LIST_LIMIT = 20;

async function execFetchSessions() {
  try {
    const r = await fetch('/api/cc/sessions', { cache: 'no-store' });
    return await r.json();
  } catch {
    return null;
  }
}

/** Switch to the most recently touched conversation that is not this one. */
async function execBackSession() {
  const data = await execFetchSessions();
  const rows = (data && data.sessions) || [];
  const prev = rows.find((s) => s.id !== data.current);
  if (!prev) {
    execAddMsg('sys', '[ no other conversation ]');
    return;
  }
  await execResumeSession(prev.id, prev.title);
}

async function execListSessions(limit) {
  const data = await execFetchSessions();
  if (!data) {
    execAddMsg('sys warn', '[ could not list conversations ]');
    return;
  }
  let rows = data.sessions || [];
  if (!rows.length) {
    execAddMsg('sys', '[ no past conversations ]');
    return;
  }
  const total = rows.length;
  if (limit) rows = rows.slice(0, limit);
  // Oldest first, so the most recent sits at the BOTTOM -- nearest the composer
  // and where the eye already is, the same way the transcript itself reads.
  rows = rows.slice().reverse();

  const box = document.createElement('div');
  box.className = 'msg exec-list';
  for (const s of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'exec-sess' + (s.id === data.current ? ' current' : '');
    if (s.id === data.current) row.title = 'current conversation';
    const name = document.createElement('span');
    name.className = 'exec-sess-title';
    name.textContent = s.title || '(untitled)';
    // A conversation keeps its colour (execHue, exec-status.js: an FNV hash of
    // the title), the same hue every time the picker opens. Only a TITLED row is
    // hued -- an untitled one has nothing to hash.
    if (s.title && typeof execHue === 'function') {
      name.classList.add('hued');
      name.style.setProperty('--cs-hue', execHue(s.title) + 'deg');
    }
    const when = document.createElement('span');
    when.className = 'exec-sess-when';
    when.textContent = execWhen(s.modified);
    row.appendChild(name);
    row.appendChild(when);
    // The current one is not a destination; tapping it would clear the screen
    // and replay exactly what is already on it.
    if (s.id !== data.current) {
      row.addEventListener('click', () => execResumeSession(s.id, s.title));
    } else {
      row.disabled = true;
    }
    box.appendChild(row);
  }
  execTermEl.appendChild(box);
  if (limit && total > limit) {
    execAddMsg('sys', '[ ' + limit + ' of ' + total + ' — /listall for the rest ]');
  }
  execTermEl.scrollTop = execTermEl.scrollHeight;
}
