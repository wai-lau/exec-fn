// noodle's END-TO-END layer (api/noodle/e2e.py). A poll started since
// 2026-10-09 is sealed with a key that lives only in its link's FRAGMENT
// (#k=...) -- the part of a URL a browser never sends -- so the server stores
// ciphertext it cannot open. This file: the key (read from the link, or made
// here for a fresh draft), sealing and opening with it (AES-256-GCM, bound to
// the poll, the object kind and the voter's key), and ndeView, which turns
// what the server holds back into the poll the rest of the page already
// draws -- applying the rules the server used to apply and now cannot read:
// the host's offer, the crop, the split, one seat per name.
// Plain polls (data-e2e empty) never touch any of it. Same global scope as
// noodle-vote.js; loaded before it, called once it has run.

var NDE_KEY_RE = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?=&|$)/;
var NDE_TITLE_MAX = 80;   // noodle/config.py TITLE_MAX
var NDE_NOTE_MAX = 280;   // noodle/config.py NOTE_MAX
var NDE_SLOT_RE = /^\d{4}-\d{2}-\d{2}:[dmn]$/;
var NDE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function ndeBin(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function ndeB64(bytes) { return btoa(ndeBin(bytes)); }
function ndeFromB64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
function ndeB64u(bytes) { return ndeB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function ndeFromB64u(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return ndeFromB64(s);
}

// The link to hand on: on an end-to-end poll it MUST carry the key.
function ndeLink() {
  return location.origin + '/noodle/' + NDV.slug + (NDV.keyStr ? '#k=' + NDV.keyStr : '');
}

// What the passphrase KDF is salted with. On an end-to-end poll the poll key
// is in it too, so the server -- which knows the slug but not the key --
// cannot test guessed names (or name + passphrase) against a public key.
function ndeScope() {
  return NDV.keyStr ? NDV.slug + '\u0000' + NDV.keyStr : NDV.slug;
}

// Called by ndvInit on an end-to-end page. A fresh DRAFT makes its key here,
// in the creator's browser, and writes it into the address; a poll opened
// without one cannot be read at all. -> false when the page cannot go on.
function ndeInit() {
  var m = NDE_KEY_RE.exec(location.hash), k = m ? m[1] : null;
  if (!k && NDV.draft) {
    k = ndeB64u(crypto.getRandomValues(new Uint8Array(32)));
    history.replaceState(null, '', location.pathname + location.search + '#k=' + k);
  }
  if (!k) {
    ndvBanner('this link is missing its key (the part after #). ask whoever sent it for the whole link.');
    ndv$('noodle').classList.add('nd-locked');
    return false;
  }
  NDV.keyStr = k;
  NDV.key = crypto.subtle.importKey('raw', ndeFromB64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return true;
}

// Bound to this poll, the kind of object and (for a vote) the voter's key, so
// the server cannot move a sealed vote to another voter or pass it off as
// the settings. Must match nothing on the server: it never opens these.
function ndeAad(kind, pub) {
  return new TextEncoder().encode('noodle e2e v1|' + NDV.slug + '|' + kind + '|' + (pub || ''));
}

async function ndeSeal(kind, pub, obj) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: ndeAad(kind, pub) },
    await NDV.key, new TextEncoder().encode(JSON.stringify(obj))));
  var out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return ndeB64(out);
}

// -> the object, or null for anything that does not open under this key
async function ndeOpen(kind, pub, b64) {
  try {
    var raw = ndeFromB64(b64);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: ndeAad(kind, pub) },
      await NDV.key, raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) { return null; }
}

// Keys in sorted order: the bytes noodle/sig.py canonical_action signs.
function ndeCanon(o) {
  var out = {};
  Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; });
  return JSON.stringify(out);
}

// EXACTLY noodle/slots.py convert(): a whole day becomes both halves; halves
// become a whole day only where both were picked.
function ndeConvert(slots, halves) {
  var have = new Set(slots), out = new Set();
  slots.forEach(function (s) {
    var day = s.slice(0, 10), k = s.slice(11);
    if (halves) {
      if (k === 'd') { out.add(day + ':m'); out.add(day + ':n'); } else out.add(s);
    } else if (k === 'd' || (have.has(day + ':m') && have.has(day + ':n'))) {
      out.add(day + ':d');
    }
  });
  return Array.from(out).sort();
}

// The host's settings as opened, every field checked: anyone holding the link
// holds the key, so nothing sealed is trusted to be well-formed.
function ndeHeadOf(h) {
  h = h && typeof h === 'object' ? h : {};
  var ok = function (d) { return typeof d === 'string' && NDE_DAY_RE.test(d); };
  var title = typeof h.title === 'string' && h.title.trim() ? h.title.slice(0, NDE_TITLE_MAX) : 'title';
  return { title: title, note: typeof h.note === 'string' ? h.note.slice(0, NDE_NOTE_MAX) : '',
    halves: h.halves === true, crop: ok(h.from) && ok(h.to) && h.from <= h.to ? { from: h.from, to: h.to } : null };
}

// The settings the host is committing, sealed whole -> {ct} or {error}.
async function ndeSealHead(head) {
  var title = String(head.title || '').split(/\s+/).filter(Boolean).join(' ');
  if (!title || title.length > NDE_TITLE_MAX) return { error: 'title must be 1-' + NDE_TITLE_MAX + ' characters' };
  var note = String(head.note || '').trim();
  if (note.length > NDE_NOTE_MAX) return { error: 'note must be at most ' + NDE_NOTE_MAX + ' characters' };
  return { ct: await ndeSeal('head', '', { title: title, note: note, halves: !!head.halves,
    from: head.from || null, to: head.to || null }) };
}

// What the server holds -> the poll as a plain poll's JSON looks
// (noodle/pages.py public_poll), with the server's old rules applied here.
async function ndeView(raw) {
  var h = raw.head ? await ndeOpen('head', '', raw.head.ct) : null;
  var head = ndeHeadOf(h), seen = new Set(), voters = [], opened = h ? 1 : 0;
  var recs = raw.voters.slice().sort(function (a, b) { return a.order - b.order; });
  var votes = await Promise.all(recs.map(function (v) { return ndeOpen('vote', v.pub, v.ct); }));
  recs.forEach(function (v, i) {
    var o = votes[i], name = o && window.noodleNormName(o.name);
    if (o) opened++;
    // one seat per name: the FIRST key to claim it holds it (the server used
    // to refuse the second; now an honest page simply does not seat it)
    if (!name || seen.has(name) || !Array.isArray(o.slots)) return;
    seen.add(name);
    var slots = o.slots.filter(function (s) { return typeof s === 'string' && NDE_SLOT_RE.test(s); });
    slots = ndeConvert(slots, head.halves);   // the split
    if (head.crop) slots = slots.filter(function (s) { return head.crop.from <= s.slice(0, 10) && s.slice(0, 10) <= head.crop.to; });
    voters.push({ name: name, pub: v.pub, slots: slots, order: v.order });
  });
  // the host's picks ARE the offer: a guest's dots show only within it
  if (voters.length) {
    var offer = new Set(voters[0].slots);
    voters.slice(1).forEach(function (v) { v.slots = v.slots.filter(function (s) { return offer.has(s); }); });
  }
  return { slug: raw.slug, e2e: true, title: head.title, note: head.note, halves: head.halves, crop: head.crop,
    voters: voters, host: voters.length ? voters[0].name : null,
    sealed: recs.length + (raw.head ? 1 : 0), opened: opened };
}

// The title + note the server could not write into the page.
function ndeShowTexts() {
  var p = NDV.poll;
  [['nd-title', 'title', 'pendingTitle'], ['nd-note', 'note', 'pendingNote']].forEach(function (x) {
    var el = ndv$(x[0]);
    if (!el.isContentEditable && NDV[x[2]] === undefined) el.textContent = p[x[1]] || '';
  });
  document.title = 'noodle: ' + p.title;
  if (p.sealed && !p.opened) ndvBanner("this link's key does not open this poll. ask whoever sent it for the whole link.");
}

async function ndeSendVote(name, slots, ts) {
  var pub = NDV.kdf.pub();
  var ct = await ndeSeal('vote', pub, { name: window.noodleNormName(name), slots: slots });
  var sig = await NDV.kdf.sign(ndeCanon({ ct: ct, kind: 'e2e-vote', poll: NDV.slug, ts: ts }));
  return ndvPost('/vote', { pub: pub, ts: ts, ct: ct, sig: sig });
}
