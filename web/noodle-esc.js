// noodle's ONE HTML escape, for the few strings built into innerHTML (the
// voters row, the owner's poll table). Loaded by both noodle pages before
// the files that use it. Names are [a-z0-9 ] already; titles are not.
function noodleEsc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

window.noodleEsc = noodleEsc;
