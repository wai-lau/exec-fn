// noodle's /noodle page: one button that starts a poll and goes straight to
// it. (It listed the owner's polls until 2026-10-13; the owner API still
// lists and deletes them -- ARCHITECTURE.md section 21i.)

async function ndmCreate(e) {
  e.preventDefault();
  var msg = document.getElementById('nd-msg');
  // the poll's key is made here, and only the public half of the claim key
  // derived from it is sent: it binds the poll's first vote to this browser
  // (noodle-claim.js)
  var key, claim;
  try {
    key = window.noodleNewPollKey();
    claim = await window.noodleClaimKey(key);
  } catch (err) {
    msg.textContent = 'this browser cannot make a key -- a current Safari, Chrome or Firefox is needed';
    return;
  }
  // nothing is stored yet: a fresh slug and its token, and the poll page opens
  // as a draft that the host's first commit creates (noodle/drafts.py)
  var r = await fetch('/api/noodle-polls/new', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim: claim.pub }) });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) { msg.textContent = d.detail || 'could not start a poll'; return; }
  location.href = d.url + '#k=' + key;   // straight to the new poll, its key in the fragment
}

(function () {
  var form = document.getElementById('nd-create');
  if (form) form.addEventListener('submit', ndmCreate);
})();
