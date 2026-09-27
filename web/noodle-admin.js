// Noodle owner page: create a poll (title + date window), list existing ones.

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
      '<span class="nd-dim">' + p.start + ' .. ' + p.end + ' / ' + p.voters + ' voters</span></li>';
  }).join('') || '<li class="nd-dim">no polls yet</li>';
}

async function ndmCreate(e) {
  e.preventDefault();
  var f = e.target, msg = document.getElementById('nd-msg');
  var r = await fetch('/api/noodle-polls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: f.title.value, start: f.start.value, end: f.end.value }),
  });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) { msg.textContent = d.detail || 'could not create'; return; }
  msg.innerHTML = 'created: <a href="' + d.url + '">' + ndmEsc(f.title.value || 'the poll') + '</a>';
  f.reset();
  ndmList();
}

(function () {
  var form = document.getElementById('nd-create');
  if (!form) return;
  form.addEventListener('submit', ndmCreate);
  ndmList();
})();
