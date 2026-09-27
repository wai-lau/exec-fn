// The poll's link under Commit, with a button that copies it: the link IS the
// only key to the poll, so sharing it is the next thing a host does.
function ndsShare(root) {
  var url = location.origin + '/noodle/' + root.dataset.slug, a = document.getElementById('nd-url'), btn = document.getElementById('nd-copy');
  a.href = url;
  a.textContent = url;
  btn.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'copied';
    } catch (e) {
      window.getSelection().selectAllChildren(a);   // no clipboard access: select it instead
      btn.textContent = 'selected';
    }
    setTimeout(function () { btn.textContent = 'copy link'; }, 1500);
  });
}

(function () {
  var root = document.getElementById('noodle');
  if (root && root.dataset.slug && document.getElementById('nd-copy')) ndsShare(root);
})();
