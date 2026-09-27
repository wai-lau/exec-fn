// Ask Noodle: free text -> a filled-in grid for the voter to REVIEW. Never
// submits. Needs the voter's key first, because the per-voter budget is
// counted against their public key. When a budget is spent the input is
// disabled with a short note; the grid keeps working.

var NDA_SPENT = 'Noodle is out of answers here -- use the grid';

function ndaSpent(msg) {
  var el = document.getElementById('nd-ask');
  el.disabled = true;
  el.value = '';
  el.placeholder = msg;
}

async function ndaLoadBudget(pub) {
  var r = await fetch('/api/noodle/' + NDV.slug + '?pub=' + encodeURIComponent(pub), { cache: 'no-store' });
  if (!r.ok) return;
  var p = await r.json();
  if (p.ask_remaining === 0) ndaSpent(NDA_SPENT);
}

async function ndaAsk() {
  var el = document.getElementById('nd-ask');
  var text = el.value.trim();
  if (!text) return;
  if (!ndvReady()) { ndvStatus('enter your name and passphrase first -- Noodle counts questions per person.'); return; }
  el.disabled = true;
  ndvStatus('Noodle is reading...');
  try {
    var res = await ndvPost('/ask', {
      text: text, pub: NDV.kdf.pub(), current: Array.from(NDV.cal.getSel()).sort(),
    });
    if (!res.ok) {
      ndvStatus(res.data.error || 'Noodle could not answer', 'err');
    } else {
      NDV.cal.setSel(new Set(res.data.slots));
      el.value = '';
      ndvStatus('Noodle filled in ' + res.data.slots.length + ' slots. check the grid, then submit.');
    }
    if (res.data.remaining === 0) ndaSpent(NDA_SPENT); else el.disabled = false;
  } catch (e) {
    el.disabled = false;
    ndvStatus('Noodle could not be reached', 'err');
  }
}

(function () {
  var el = document.getElementById('nd-ask');
  if (!el) return;
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); ndaAsk(); }
  });
  window.ndaLoadBudget = ndaLoadBudget;
})();
