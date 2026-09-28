// noodle's SEATS: who the voter row shows and how -- the host's default offer,
// the "could be you" seat and its kept seal, a typed name's owner, your own
// face mid change -- plus a stored vote as the page shows it and the span a
// guest's calendar covers. Split from noodle-vote.js at the 500-line cap (same
// global scope; loaded before it and only called once it has run).

// Does the typed name belong to a voter already? (Then it is not a new seat.)
function ndvNameTaken(typed) {
  return !!typed && (NDV.poll ? NDV.poll.voters : []).some(function (v) {
    return window.noodleNormName(v.name) === typed;
  });
}

// The "could be you" seat's seal: random, made ONCE per browser and kept, so
// the placeholder face is the same every visit instead of reshuffling.
var NDV_BLANK = '__could_be_you__';
function ndvBlankSeal() {
  var k = 'noodle.blankSeal', id = null;
  try { id = localStorage.getItem(k); } catch (e) { /* blocked: a fresh one each load */ }
  // a seed is 32 bytes (64 hex); a shorter one (an early version stored 16)
  // reads past its end in the seal and throws, so it is replaced
  if (!/^[0-9a-f]{64}$/.test(id || '')) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    try { localStorage.setItem(k, id); } catch (e) { /* not kept */ }
  }
  // the seal is drawn from 32 fingerprint bytes; these simply ARE them
  return window.NoodleSeal.fromFp(new Uint8Array(id.match(/../g).map(function (h) { return parseInt(h, 16); })));
}

// A stored vote as the page shows it: under an unsaved split change it is
// converted the way the server will convert it on Commit (a whole day counts
// as BOTH halves), so nobody's dots vanish when the box is ticked.
function ndvShown(slots) {
  var set = new Set(slots);
  return window.ndhHalves && window.ndhHalves() !== !!(NDV.poll && NDV.poll.halves)
    ? ndhConvert(set, window.ndhHalves()) : set;
}

// The voters, plus -- for a key that has not committed under this name yet --
// YOUR face as it would join them, redrawn whenever the seal changes. Mid
// change (noodle-rekey.js) your own face already wears the NEW seal and name.
function ndvRenderRoster(pub, iHost, typed) {
  var voters = NDV.poll ? NDV.poll.voters : [], seals = NDV.seals;
  if (NDV.mine && window.NDR && NDR.active) {
    // mid change: your own face, with the name being typed and the newest seal
    // (the last one while the next derives) -- never the empty seat
    seals = Object.assign({}, seals);
    if (NDV.seal || NDV.lastSeal) seals[pub] = NDV.seal || NDV.lastSeal;
    voters = voters.map(function (v) { return v.pub === pub && typed ? Object.assign({}, v, { name: typed }) : v; });
  } else if (typed && !ndvNameTaken(typed)) {
    // a NEW name: its face joins the row at once and keeps it while the key
    // computes -- the last seal stands in until the next is made, so the seat
    // never blinks back to "could be you"
    var seal = (pub && NDV.seal) || NDV.lastSeal || NDV.blankSeal;
    seals = Object.assign({}, seals);
    seals[NDV_BLANK] = seal;
    voters = voters.concat([{ name: typed, pub: NDV_BLANK, slots: [], order: voters.length, pending: true }]);
  } else if (!typed && NDV.blankSeal) {
    // no name at all: a seat saying there is room, wearing this browser's
    // placeholder seal
    seals = Object.assign({}, seals);
    seals[NDV_BLANK] = NDV.blankSeal;
    voters = voters.concat([{ name: 'could be you', pub: NDV_BLANK, slots: [], order: voters.length,
      pending: true, blank: true }]);
  }
  // the typed name's owner is SELECTED too, before any key says it is you
  voters = voters.map(function (v) {
    return typed && !v.pending && window.noodleNormName(v.name) === typed ? Object.assign({}, v, { picked: true }) : v;
  });
  // a host alone on the poll gets the how-to where the guests will appear
  var alone = window.ndxIsHost && window.ndxIsHost() && !(NDV.poll ? NDV.poll.voters : []).some(function (v) {
    return v.pub !== pub;
  });
  window.NoodleRoster.render(ndv$('nd-voters'), voters, seals, pub, iHost, alone);
}

// The first and last day the host offers, or null before they offer any.
function ndvOfferSpan(p) {
  var days = p.voters.length ? p.voters[0].slots.map(function (s) { return s.slice(0, 10); }).sort() : [];
  return days.length ? { from: days[0], to: days[days.length - 1] } : null;
}
