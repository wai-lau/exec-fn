// Ask Noodle: free text -> a filled-in grid for the voter to REVIEW. Never
// submits -- and it has its OWN button, beside the box and below Commit, so
// asking can never be mistaken for sealing a vote. Enter is a newline: the
// box is multi-line on purpose, so only the button asks. Needs the voter's key first, because the per-voter budget is
// counted against their public key. When a budget is spent the input is
// disabled with a short note; the grid keeps working.

var NDA_SPENT = 'Noodle is out of answers here -- use the grid';
var NDA = { spent: false, busy: false };

function nda$(id) { return document.getElementById(id); }

function ndaStatus(msg, kind) {
  var el = nda$('nd-ask-status');
  el.textContent = msg || '';
  el.dataset.kind = kind || '';
}

function ndaSync() {
  var box = nda$('nd-ask');
  box.disabled = NDA.spent || NDA.busy;
  nda$('nd-ask-go').disabled = NDA.spent || NDA.busy || !box.value.trim();
}

function ndaSpent(msg) {
  NDA.spent = true;
  nda$('nd-ask').value = '';
  nda$('nd-ask').placeholder = msg;
  ndaSync();
}

async function ndaLoadBudget(pub) {
  var r = await fetch('/api/noodle/' + NDV.slug + '?pub=' + encodeURIComponent(pub), { cache: 'no-store' });
  if (!r.ok) return;
  var p = await r.json();
  if (p.ask_remaining === 0) ndaSpent(NDA_SPENT);
}

async function ndaAsk() {
  var text = nda$('nd-ask').value.trim();
  if (!text || NDA.busy || NDA.spent) return;
  if (!ndvReady()) { ndaStatus('enter your name first -- Noodle counts questions per person.'); return; }
  NDA.busy = true;
  ndaSync();
  ndaStatus('Noodle is reading...');
  try {
    // every ask starts from a BLANK calendar: the answer replaces the grid
    // outright, and the text stays in the box so it can be tweaked and re-asked
    var res = await ndvPost('/ask', { text: text, pub: NDV.kdf.pub() });
    if (!res.ok) {
      ndaStatus(res.data.error || 'Noodle could not answer', 'err');
    } else {
      NDV.cal.setSel(new Set(res.data.slots));
      ndvSaveDraft();
      ndaStatus('Noodle filled in ' + res.data.slots.length + ' slots. check the calendar, then commit.');
    }
    if (res.data.remaining === 0) ndaSpent(NDA_SPENT);
  } catch (e) {
    ndaStatus('Noodle could not be reached', 'err');
  } finally {
    NDA.busy = false;
    ndaSync();
  }
}

(function () {
  var el = document.getElementById('nd-ask');
  if (!el) return;
  el.addEventListener('input', ndaSync);
  nda$('nd-ask-go').addEventListener('click', ndaAsk);
  ndaSync(); // a restored draft may already hold text
  window.ndaLoadBudget = ndaLoadBudget;
})();
