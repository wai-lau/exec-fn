// noodle's VOTERS ROW. Two halves: who is seated (ndvRenderRoster -- the
// voters, plus YOUR face as it would join them, the empty "you" seat with its
// kept placeholder seal, a typed name's owner selected, your own face mid a
// name change) and how a row of faces is drawn (NoodleRoster.render, seals
// from ndrSeals). There is no separate results page: the calendar's dots ARE
// the results, and each voter's seal ink is also their dot colour, so a
// column of dots can be matched to a name here.

// voters -> Promise<{pub: {text, hue}}>
async function ndrSeals(voters) {
  var out = {};
  await Promise.all(voters.map(async function (v) {
    if (v.pub) out[v.pub] = await window.NoodleSeal.seal(v.pub);
  }));
  return out;
}

// "are you one of these guys?": a grid of faces, name under each, five to a
// row. Tapping one fills the name field (noodle-vote.js); the host also gets a
// remove button under each guest (noodle-host.js). myPub is the key this
// browser holds now -- the "you" mark follows the KEY, not the name, or typing
// someone else's name would mark their face as yours. A `pending` voter is
// this browser's own face before it has committed (noodle-vote.js).
// What a host alone on the poll is shown where the guests will appear.
var NDR_HOWTO = '<li class="nd-howto"><p>you\'re the <b>host</b>!</p>' +
  '<p>your identity = <b>name</b> + <b>passphrase</b></p>' +
  '<p>host picks <b>available choices</b></p>' +
  '<p><b>commit</b> and share link</p></li>';

function ndrRender(el, voters, seals, myPub, canRemove, howto) {
  el.closest('.nd-who').hidden = !voters.length;
  el.innerHTML = voters.map(function (v) {
    var seal = seals[v.pub];
    var you = v.pending || v.picked || (!!myPub && v.pub === myPub);   // your seat, committed, or named
    return '<li><button type="button" class="nd-face' + (you ? ' you' : '') + (v.pending ? ' pending' : '') +
      (v.order === 0 ? ' host' : '') + '" data-name="' +
      (v.blank ? '' : window.noodleEsc(v.name)) + '"' + (v.blank ? '' : ' title="' + v.slots.length + ' slots"') + '>' +
      '<pre class="nd-seal xs' + (seal ? ' inked" style="--seal-hsl:' + seal.ink + '"' : '"') + '>' +
      (seal ? seal.html : '') +   // already escaped, face in <b> (noodle-seal.js)
      '</pre><span class="nd-face-name">' + window.noodleEsc(v.name) + '</span>' +
      (v.order === 0 ? '<span class="nd-face-host">host</span>' : '') + '</button>' +
      // the host (and only the host) can remove a guest, and their vote with them
      (canRemove && v.order !== 0 && !v.pending ? '<button type="button" class="nd-face-rm" data-name="' +
        window.noodleEsc(v.name) + '" data-pub="' + window.noodleEsc(v.pub) + '">remove</button>' : '') + '</li>';
  }).join('') + (howto ? NDR_HOWTO : '');
}

window.NoodleRoster = { seals: ndrSeals, render: ndrRender };

// Does the typed name belong to a voter already? (Then it is not a new seat.)
function ndvNameTaken(typed) {
  return !!typed && (NDV.poll ? NDV.poll.voters : []).some(function (v) {
    return window.noodleNormName(v.name) === typed;
  });
}

// The "you" seat's seal: random, made ONCE per browser per poll and
// kept, so the placeholder face is the same every visit instead of reshuffling.
var NDV_BLANK = '__could_be_you__';
function ndvBlankSeal() {
  var k = 'noodle.blankSeal.' + NDV.slug, id = null;   // per poll, like all of noodle's storage
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
    // never blinks back to "you"
    var seal = (pub && NDV.seal) || NDV.lastSeal || NDV.blankSeal;
    seals = Object.assign({}, seals);
    seals[NDV_BLANK] = seal;
    voters = voters.concat([{ name: typed, pub: NDV_BLANK, slots: [], order: voters.length, pending: true }]);
  } else if (!typed && NDV.blankSeal) {
    // no name at all: a seat saying there is room, wearing this browser's
    // placeholder seal
    seals = Object.assign({}, seals);
    seals[NDV_BLANK] = NDV.blankSeal;
    voters = voters.concat([{ name: 'you', pub: NDV_BLANK, slots: [], order: voters.length,
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
