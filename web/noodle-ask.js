// Ask noodle: free text -> a filled-in grid for the voter to REVIEW. Never
// submits -- and it has its OWN button, beside the box and below Commit, so
// asking can never be mistaken for sealing a vote. Enter is a newline: the
// box is multi-line on purpose, so only the button asks.
//
// noodle works on THIS PAGE's state, never the server's: it is sent the days
// the page can pick right now (the host's crop lines, or a guest's offered
// days) and the split, and its answer is clamped to the page's offer again.
// No name needed. Limits are RATE limits (per poll, per IP), never a lifetime
// cap: a 429 carries retry_after, the button counts it down and comes back.

var NDA = { busy: false, until: 0, tick: null, last: null };   // last: {text, data}
var NDA_MAX_DAYS = 186;   // = noodle/config.py VIEW_MAX_DAYS: more days in one ask is a 400

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
  // always pressable (but while a question is out): an empty box says so, an
  // unchanged question re-applies the last answer, a wait counts itself down
  nda$('nd-ask-go').disabled = NDA.busy;
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
      ndaStatus('too fast, wait ' + left + 's =_=');
    }
    ndaSync();
  }
  step();
  NDA.tick = setInterval(step, 1000);
}

// The days noodle may fill: the host's crop lines (the calendar is endless
// for them), else everything this page can pick. Capped to the server's view.
function ndaDays() {
  var from = null, to = null;
  if (window.ndxIsHost && window.ndxIsHost() && window.NDX && NDV.cal.rows().length) {
    from = NDV.cal.weekOf(NDX.a)[0];
    to = NDV.cal.weekOf(Math.min(NDX.b, NDV.cal.rows().length - 1))[6];
  }
  return NDV.cal ? NDV.cal.pickableDays(from, to).slice(0, NDA_MAX_DAYS) : [];
}

// Fill the grid from an answer (fresh, or the last one re-applied).
async function ndaApply(d) {
  // "just the next three weeks": the host can crop by asking; a guest cannot
  var host = window.ndxIsHost && window.ndxIsHost();
  if (d.crop && host) await window.ndxSave(d.crop);
  var slots = d.slots;
  // the words told parts of a day apart: a host's calendar splits its days to
  // show them; a guest's cannot, so each half folds back into its whole day
  // (only when the calendar is not split ALREADY -- a re-applied answer finds
  // it split by the first time round, and folding its halves then matched
  // nothing: "help me" on an unchanged question did nothing)
  if (d.split && !ndhHalves()) {
    if (host) {
      nda$('nd-split').checked = true;
      ndhSplitChange();
    } else {
      slots = Array.from(new Set(slots.map(function (s) { return s.slice(0, 10) + ':d'; })));
    }
  }
  var got = NDV.cal ? NDV.cal.clamp(slots) : [];
  // an answer REPLACES the grid (every ask starts blank, and the text stays
  // in the box to be tweaked) -- unless it filled nothing: then the picks
  // stay, since wiping a calendar to show "no match" loses real work
  if (got.length) { NDV.cal.setSel(new Set(got)); ndvSaveDraft(); }
  // the reading is how noodle understood the words -- shown first, so an
  // ambiguous sentence read the other way is visible before it is committed
  var skipped = d.dropped ? ' (' + d.dropped + ' unusable rule(s) skipped)' : '';
  ndaStatus('noodle read that as: ' + (d.reading || '(no summary)') + ' -- ' + (got.length
    ? got.length + ' slots filled' + skipped + '. check the calendar, then commit.'
    : 'nothing on this calendar matched' + skipped + ', so your picks are unchanged.'));
}

async function ndaAsk() {
  var text = nda$('nd-ask').value.trim();
  if (NDA.busy) return;
  if (!text) { ndaStatus('help how? type in box pls'); return; }
  // the same question again: its answer again, no second trip to the model
  if (NDA.last && NDA.last.text === text) { await ndaApply(NDA.last.data); return; }
  if (ndaWaiting()) { ndaBackOff(Math.ceil((NDA.until - Date.now()) / 1000)); return; }
  NDA.busy = true;
  ndaSync();
  ndaStatus('noodling');
  nda$('nd-ask-status').classList.add('nd-noodling');   // the dots are CSS
  try {
    var res = await ndvPost('/ask', { text: text, dates: ndaDays(), halves: ndhHalves() });
    nda$('nd-ask-status').classList.remove('nd-noodling');
    if (res.ok) {
      NDA.last = { text: text, data: res.data };
      await ndaApply(res.data);
    } else if (res.data.retry_after) {
      ndaBackOff(res.data.retry_after);
    } else {
      ndaStatus(res.data.error || 'noodle could not answer', 'err');
    }
  } catch (e) {
    ndaStatus('noodle could not be reached', 'err');
  } finally {
    nda$('nd-ask-status').classList.remove('nd-noodling');
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
