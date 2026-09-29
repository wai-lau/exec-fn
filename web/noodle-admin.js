// noodle owner page: create a poll (a title; creating goes straight to it),
// list the polls, delete one (asked first -- it takes every vote with it).

async function ndmList() {
  var r = await fetch('/api/noodle-polls', { cache: 'no-store' });
  if (!r.ok) return;   // not the owner: the list stays hidden (it is owner-only server-side too)
  document.getElementById('nd-owner').hidden = false;
  var d = await r.json();
  document.getElementById('nd-polls').innerHTML = d.polls.map(function (p) {
    return '<tr><td><a href="/noodle/' + p.slug + '">' + window.noodleEsc(p.title) + '</a></td>' +
      '<td>' + p.voters + '</td>' +
      '<td>' + window.noodleEsc(String(p.created_at || '').slice(0, 16).replace('T', ' ')) + '</td>' +
      '<td><button type="button" class="nd-face-rm nd-del" data-slug="' + p.slug + '" data-title="' +
      window.noodleEsc(p.title) + '">delete</button></td></tr>';
  }).join('') || '<tr><td colspan="4" class="nd-dim">no polls yet</td></tr>';
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
  var r = await fetch('/api/noodle-polls/' + b.dataset.slug, { method: 'DELETE' });
  if (!r.ok) { document.getElementById('nd-msg').textContent = 'could not delete'; return; }
  ndmList();
}

// The demo video (guests only) autoplays muted and looping inline; a tap opens
// it FULLSCREEN with the native controls, and leaving hides them again and
// keeps it playing.
// iPhone Safari has no element requestFullscreen -- a video's own
// webkitEnterFullscreen is its only way in.
function ndmDemo(v) {
  function inFull() { return document.fullscreenElement === v || document.webkitFullscreenElement === v; }
  v.addEventListener('click', function () {
    if (inFull()) return;
    v.controls = true;
    v.play().catch(function () {});
    if (v.requestFullscreen) v.requestFullscreen().catch(function () {});
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  });
  function left() { if (!inFull()) { v.controls = false; v.play().catch(function () {}); } }
  document.addEventListener('fullscreenchange', left);
  document.addEventListener('webkitfullscreenchange', left);
  v.addEventListener('webkitendfullscreen', left);   // iPhone
}

(function () {
  var demo = document.querySelector('.nd-demo');
  if (demo) ndmDemo(demo);
  var form = document.getElementById('nd-create');
  if (!form) return;
  form.addEventListener('submit', ndmCreate);
  document.getElementById('nd-polls').addEventListener('click', ndmDelete);
  ndmList();
})();
