// The poll's link under Commit: plain text in a read-only box, with a button
// that copies it. The link IS the only key to the poll, so sharing it is the
// next thing a host does -- and it is text to hand on, not somewhere to go.
function ndsShare(root) {
  var url = location.origin + '/noodle/' + root.dataset.slug, ICON = '\uf0c5';
  var box = document.getElementById('nd-url'), btn = document.getElementById('nd-copy');
  box.value = url;
  btn.textContent = ICON;
  box.addEventListener('focus', function () { box.select(); });
  btn.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = '\u2713';   // copied
    } catch (e) {
      box.focus();   // no clipboard access: leave it selected to copy by hand
      btn.textContent = '\u2713';   // selected: copy by hand
    }
    setTimeout(function () { btn.textContent = ICON; }, 1500);
  });
}

(function () {
  var root = document.getElementById('noodle');
  if (root && root.dataset.slug && document.getElementById('nd-copy')) ndsShare(root);
})();
