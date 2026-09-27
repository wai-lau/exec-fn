// Noodle owner page: create a poll (a title; creating goes straight to it),
// list the polls, delete one (asked first -- it takes every vote with it).

function ndmEsc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function ndmList() {
  var r = await fetch('/api/noodle-polls', { cache: 'no-store' });
  if (!r.ok) return;
  var d = await r.json();
  document.getElementById('nd-polls').innerHTML = d.polls.map(function (p) {
    return '<li><a href="/noodle/' + p.slug + '">' + ndmEsc(p.title) + '</a> ' +
      '<span class="nd-dim">' + p.voters + ' voters</span> ' +
      '<button type="button" class="nd-face-rm nd-del" data-slug="' + p.slug + '" data-title="' +
      ndmEsc(p.title) + '">delete</button></li>';
  }).join('') || '<li class="nd-dim">no polls yet</li>';
}

async function ndmCreate(e) {
  e.preventDefault();
  var f = e.target, msg = document.getElementById('nd-msg');
  var r = await fetch('/api/noodle-polls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: f.title.value }),
  });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) { msg.textContent = d.detail || 'could not create'; return; }
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

(function () {
  var form = document.getElementById('nd-create');
  if (!form) return;
  form.addEventListener('submit', ndmCreate);
  document.getElementById('nd-polls').addEventListener('click', ndmDelete);
  ndmList();
})();
