// noodle owner page: create a poll (creating goes straight to it), list the
// polls, delete one (asked first -- it takes every vote with it).

// The server lists polls by FILE id only -- each link is its poll's key and
// it keeps none (api/noodle/store.py). This browser's own list of polls it
// has opened (noodle.polls, written by noodle-storage.js ndvRemember) gives
// the ones it knows a title and a link: same HKDF as store.poll_id, so a
// slug maps to its id here without the slug ever being sent.
function ndmKnown() {
  try { return JSON.parse(localStorage.getItem('noodle.polls') || '{}'); } catch (e) { return {}; }
}

async function ndmIdOf(slug) {
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey('raw', enc.encode(slug), 'HKDF', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32),
    info: enc.encode('noodle poll file v1') }, key, 256);
  return Array.from(new Uint8Array(bits)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function ndmById() {
  var known = ndmKnown(), out = {};
  await Promise.all(Object.keys(known).map(async function (slug) {
    out[await ndmIdOf(slug)] = Object.assign({ slug: slug }, known[slug]);
  }));
  return out;
}

function ndmRow(p, k) {
  var when = new Date(p.modified * 1000).toISOString().slice(0, 16).replace('T', ' ');
  var label = k ? window.noodleEsc(k.title || 'title') : 'sealed ' + p.id.slice(0, 10);
  var name = k ? '<a href="' + window.noodleEsc(k.url) + '">' + label + '</a>'
    : '<span class="nd-dim">' + label + '</span>';
  return '<tr><td>' + name + '</td><td>' + when + '</td>' +
    '<td><button type="button" class="nd-face-rm nd-del" data-id="' + p.id + '" data-slug="' +
    (k ? k.slug : '') + '" data-title="' + label + '">delete</button></td></tr>';
}

async function ndmList() {
  var r = await fetch('/api/noodle-polls', { cache: 'no-store' });
  if (!r.ok) return;   // not the owner: the list stays hidden (it is owner-only server-side too)
  document.getElementById('nd-owner').hidden = false;
  var d = await r.json(), byId = await ndmById();
  document.getElementById('nd-polls').innerHTML = d.polls.map(function (p) {
    return ndmRow(p, byId[p.id]);
  }).join('') || '<tr><td colspan="3" class="nd-dim">no polls yet</td></tr>';
}

async function ndmCreate(e) {
  e.preventDefault();
  var msg = document.getElementById('nd-msg');
  // nothing is stored yet: a fresh slug and its token, and the poll page opens
  // as a draft that the host's first commit creates (noodle/drafts.py)
  var r = await fetch('/api/noodle-polls/new', { method: 'POST' });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) { msg.textContent = d.detail || 'could not start a poll'; return; }
  location.href = d.url;   // straight to the new poll
}

async function ndmDelete(e) {
  var b = e.target.closest('.nd-del');
  if (!b) return;
  if (!window.confirm('delete "' + b.dataset.title + '" and every vote in it? this cannot be undone.')) return;
  var r = await fetch('/api/noodle-polls/' + b.dataset.id, { method: 'DELETE' });
  if (!r.ok) { document.getElementById('nd-msg').textContent = 'could not delete'; return; }
  if (b.dataset.slug) {
    var known = ndmKnown();
    delete known[b.dataset.slug];
    try { localStorage.setItem('noodle.polls', JSON.stringify(known)); } catch (e2) { /* kept */ }
  }
  ndmList();
}

(function () {
  var form = document.getElementById('nd-create');
  if (!form) return;
  form.addEventListener('submit', ndmCreate);
  document.getElementById('nd-polls').addEventListener('click', ndmDelete);
  ndmList();
})();
