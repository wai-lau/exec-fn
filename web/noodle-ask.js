// Ask Noodle: free text -> a filled-in grid for the voter to REVIEW. Never
// submits -- and it has its OWN button, beside the box and below Commit, so
// asking can never be mistaken for sealing a vote. Enter is a newline: the
// box is multi-line on purpose, so only the button asks.
//
// Needs the voter's key first (the per-voter rate window is counted against
// it). Limits are RATE limits, never a lifetime cap: a 429 carries
// retry_after, the button counts it down and comes back by itself.

var NDA = { busy: false, until: 0, tick: null };

function nda$(id) { return document.getElementById(id); }

// Errors go to the page's banner (ndvBanner), like every other error.
function ndaStatus(msg, kind) {
  if (kind === 'err') { ndvBanner(msg); msg = ''; } else if (msg) ndvBanner('');
  nda$('nd-ask-status').textContent = msg || '';
}

function ndaWaiting() { return NDA.until > Date.now(); }

function ndaSync() {
  var box = nda$('nd-ask');
  box.disabled = NDA.busy;
  nda$('nd-ask-go').disabled = NDA.busy || ndaWaiting() || !box.value.trim();
}

// Count a 429's wait down on the status line, then hand the button back.
function ndaBackOff(secs) {
  NDA.until = Date.now() + secs * 1000;
  clearInterval(NDA.tick);
  function step() {
    var left = Math.ceil((NDA.until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(NDA.tick);
      ndaStatus('');
    } else {
      ndaStatus('Noodle needs a breather -- try again in ' + left + 's');
    }
    ndaSync();
  }
  step();
  NDA.tick = setInterval(step, 1000);
}

async function ndaAsk() {
  var text = nda$('nd-ask').value.trim();
  if (!text || NDA.busy || ndaWaiting()) return;
  if (!ndvReady()) { ndaStatus('enter your name first -- Noodle counts questions per person.'); return; }
  NDA.busy = true;
  ndaSync();
  ndaStatus('Noodle is reading...');
  try {
    // every ask starts from a BLANK calendar: the answer replaces the grid
    // outright, and the text stays in the box so it can be tweaked and re-asked
    // the voter's crop is also Noodle's horizon; without one it looks ahead
    // from today (the calendar itself is endless)
    // the host's crop is Noodle's horizon too; without one it looks ahead
    var res = await ndvPost('/ask', { text: text, pub: ndvPub(), view: ndhCrop() || undefined });
    if (res.ok) {
      // "just the next three weeks": the host can crop by asking; a guest cannot
      if (res.data.crop && window.ndxIsHost && window.ndxIsHost()) await window.ndxSave(res.data.crop);
      if (NDV.cal) NDV.cal.setSel(new Set(res.data.slots));
      ndvSaveDraft();
      // the reading is how Noodle understood the words -- shown first, so an
      // ambiguous sentence read the other way is visible before it is committed
      var skipped = res.data.dropped ? ' (' + res.data.dropped + ' unusable rule(s) skipped)' : '';
      ndaStatus('Noodle read that as: ' + (res.data.reading || '(no summary)') + ' -- ' +
        res.data.slots.length + ' slots filled' + skipped + '. check the calendar, then commit.');
    } else if (res.data.retry_after) {
      ndaBackOff(res.data.retry_after);
    } else {
      ndaStatus(res.data.error || 'Noodle could not answer', 'err');
    }
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
})();
