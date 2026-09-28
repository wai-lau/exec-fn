// noodle roster: everyone who has voted, with their seals, at the TOP of the
// vote page (there is no separate results page -- the calendar's dots ARE the
// results). Each voter's seal ink is also their dot colour, so a
// column of dots in the grid can be matched to a name here by colour.

function ndrEsc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

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
      (v.blank ? '' : ndrEsc(v.name)) + '"' + (v.blank ? '' : ' title="' + v.slots.length + ' slots"') + '>' +
      '<pre class="nd-seal xs' + (seal ? ' inked" style="--seal-hsl:' + seal.ink + '"' : '"') + '>' +
      (seal ? seal.html : '') +   // already escaped, face in <b> (noodle-seal.js)
      '</pre><span class="nd-face-name">' + ndrEsc(v.name) + '</span>' +
      (v.order === 0 ? '<span class="nd-face-host">host</span>' : '') + '</button>' +
      // the host (and only the host) can remove a guest, and their vote with them
      (canRemove && v.order !== 0 && !v.pending ? '<button type="button" class="nd-face-rm" data-name="' +
        ndrEsc(v.name) + '">remove</button>' : '') + '</li>';
  }).join('') + (howto ? NDR_HOWTO : '');
}

window.NoodleRoster = { seals: ndrSeals, render: ndrRender };
