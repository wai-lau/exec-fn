// Noodle roster: everyone who has voted, with their seals, at the TOP of the
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

// "are you one of these guys?": a grid of faces, name under each, four to a
// row. Tapping one fills the name field (noodle-vote.js). myPub is the key this
// browser holds now -- the "you" mark follows the KEY, not the name, or typing
// someone else's name would mark their face as yours.
function ndrRender(el, voters, seals, myPub) {
  el.closest('.nd-who').hidden = !voters.length;
  el.innerHTML = voters.map(function (v) {
    var seal = seals[v.pub];
    var you = !!myPub && v.pub === myPub;
    return '<li><button type="button" class="nd-face' + (you ? ' you' : '') + '" data-name="' +
      ndrEsc(v.name) + '" title="' + v.slots.length + ' slots">' +
      '<pre class="nd-seal xs' + (seal ? ' nd-hue-' + seal.hue : '') + '">' + ndrEsc(seal ? seal.text : '') +
      '</pre><span class="nd-face-name">' + ndrEsc(v.name) + '</span></button></li>';
  }).join('');
}

window.NoodleRoster = { seals: ndrSeals, render: ndrRender };
