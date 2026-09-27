// Ask Noodle: free text -> a filled-in grid for the voter to REVIEW. Never
// submits -- and it has its OWN button, beside the box and below Commit, so
// asking can never be mistaken for sealing a vote. Enter is a newline: the
// box is multi-line on purpose, so only the button asks.
//
// Noodle works on THIS PAGE's state, never the server's: it is sent the days
// the page can pick right now (the host's crop lines, or a guest's offered
// days) and the split, and its answer is clamped to the page's offer again.
// No name needed. Limits are RATE limits (per poll, per IP), never a lifetime
// cap: a 429 carries retry_after, the button counts it down and comes back.

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

// The days Noodle may fill: the host's crop lines (the calendar is endless
// for them), else everything this page can pick. Capped to the server's view.
function ndaDays() {
  var from = null, to = null;
  if (window.ndxIsHost && window.ndxIsHost() && window.NDX && NDV.cal.rows().length) {
    from = NDV.cal.weekOf(NDX.a)[0];
    to = NDV.cal.weekOf(Math.min(NDX.b, NDV.cal.rows().length - 1))[6];
  }
  return NDV.cal ? NDV.cal.pickableDays(from, to).slice(0, 186) : [];
}

async function ndaAsk() {
  var text = nda$('nd-ask').value.trim();
  if (!text || NDA.busy || ndaWaiting()) return;
  NDA.busy = true;
  ndaSync();
  ndaStatus('Noodle is reading...');
  try {
    var res = await ndvPost('/ask', { text: text, dates: ndaDays(), halves: ndhHalves() });
    if (res.ok) {
      // "just the next three weeks": the host can crop by asking; a guest cannot
      if (res.data.crop && window.ndxIsHost && window.ndxIsHost()) await window.ndxSave(res.data.crop);
      var got = NDV.cal ? NDV.cal.clamp(res.data.slots) : [];
      // an answer REPLACES the grid (every ask starts blank, and the text stays
      // in the box to be tweaked) -- unless it filled nothing: then the picks
      // stay, since wiping a calendar to show "no match" loses real work
      if (got.length) { NDV.cal.setSel(new Set(got)); ndvSaveDraft(); }
      res.data.slots = got;
      // the reading is how Noodle understood the words -- shown first, so an
      // ambiguous sentence read the other way is visible before it is committed
      var skipped = res.data.dropped ? ' (' + res.data.dropped + ' unusable rule(s) skipped)' : '';
      ndaStatus('Noodle read that as: ' + (res.data.reading || '(no summary)') + ' -- ' + (got.length
        ? got.length + ' slots filled' + skipped + '. check the calendar, then commit.'
        : 'nothing on this calendar matched' + skipped + ', so your picks are unchanged.'));
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
