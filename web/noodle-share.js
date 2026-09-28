// The poll's link under Commit: plain text in a read-only box, with a button
// that copies it. The link IS the only key to the poll, so sharing it is the
// next thing a host does -- and it is text to hand on, not somewhere to go.
// The icon in its own element so it can be centred by its INK: the copy
// glyph claims one cell (0.5em) but draws a whole em rightward, so it is
// shifted back by the difference (.nd-copy-ic). The check is a plain letter.
function ndsIcon(btn, which) {
  btn.innerHTML = which === 'copy' ? '<i class="nd-copy-ic">\uf0c5</i>' : '\u2713';
}

function ndsShare(root) {
  var url = location.origin + '/noodle/' + root.dataset.slug;
  var box = document.getElementById('nd-url'), btn = document.getElementById('nd-copy');
  box.value = url;
  ndsIcon(btn, 'copy');
  box.addEventListener('focus', function () { box.select(); });
  btn.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(url);
      ndsIcon(btn, 'done');   // copied
    } catch (e) {
      box.focus();   // no clipboard access: leave it selected to copy by hand
      ndsIcon(btn, 'done');   // selected: copy by hand
    }
    setTimeout(function () { ndsIcon(btn, 'copy'); }, 1500);
  });
}

(function () {
  var root = document.getElementById('noodle');
  if (root && root.dataset.slug && document.getElementById('nd-copy')) ndsShare(root);
})();
