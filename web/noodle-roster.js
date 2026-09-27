// Noodle roster: everyone who has voted, with their seals, under the calendar
// on the vote page (there is no separate results page -- the calendar's dots
// ARE the results). Each voter's seal ink is also their dot colour, so a
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

// myPub: the key this browser holds now -- '(you)' follows the KEY, not the
// name, or typing someone else's name would label their row as yours.
function ndrRender(el, voters, seals, myPub) {
  if (!voters.length) { el.innerHTML = '<li class="nd-none">nobody yet</li>'; return; }
  el.innerHTML = voters.map(function (v) {
    var seal = seals[v.pub];
    var you = !!myPub && v.pub === myPub;
    return '<li class="nd-voter"><pre class="nd-seal sm' + (seal ? ' nd-hue-' + seal.hue : '') + '">' +
      ndrEsc(seal ? seal.text : '') + '</pre><span class="nd-vname">' + ndrEsc(v.name) +
      (you ? ' <span class="nd-dim">(you)</span>' : '') + '</span>' +
      '<span class="nd-vcount">' + v.slots.length + ' slots</span></li>';
  }).join('');
}

window.NoodleRoster = { seals: ndrSeals, render: ndrRender };
