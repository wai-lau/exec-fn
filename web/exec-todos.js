// Exec-panel scratch todo list — occupies the top half of the exec panel.
// Server-persisted (exec_todos.json) and SEPARATE from rd.json cards: items
// here are DELETED on checkbox, not archived. Built by exec-bubble.js after the
// panel exists (window.execBuildTodos(panel)); shares the panel's global scope.
(function () {
  'use strict';

  var listEl, inputEl;

  function esc(s) { return s == null ? '' : String(s); }

  function renderItem(item) {
    var li = document.createElement('li');
    li.className = 'exec-todo';
    li.dataset.id = item.id;
    li.dataset.text = esc(item.text);
    var box = document.createElement('span');
    box.className = 'exec-todo-box';
    box.textContent = '[ ]';
    var txt = document.createElement('span');
    txt.className = 'exec-todo-text';
    txt.textContent = esc(item.text);
    li.appendChild(box);
    li.appendChild(txt);
    box.addEventListener('click', function () { checkOff(li, box); });
    txt.addEventListener('click', function () { startEdit(li, txt); });
    return li;
  }

  // Tap the text → inline edit. Enter/blur commits, Escape reverts. Empty text
  // reverts (delete is the checkbox's job). On PATCH failure, restore the old
  // text so the row never shows an unsaved value.
  function startEdit(li, txt) {
    if (li.classList.contains('done') || txt.isContentEditable) return;
    txt.contentEditable = 'true';
    txt.spellcheck = false;
    txt.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(txt);
    sel.removeAllRanges();
    sel.addRange(range);

    function finish(commit) {
      txt.removeEventListener('keydown', onKey);
      txt.removeEventListener('blur', onBlur);
      txt.contentEditable = 'false';
      var next = (txt.textContent || '').trim();
      var prev = li.dataset.text || '';
      if (!commit || !next || next === prev) {
        txt.textContent = prev;
        return;
      }
      txt.textContent = next;
      saveEdit(li, txt, next, prev);
    }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); txt.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }
    function onBlur() { finish(true); }
    txt.addEventListener('keydown', onKey);
    txt.addEventListener('blur', onBlur);
  }

  function saveEdit(li, txt, next, prev) {
    var id = li.dataset.id;
    fetch('/api/todos/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: next }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('edit failed');
        li.dataset.text = next;
      })
      .catch(function () {
        txt.textContent = prev;
      });
  }

  // Checkbox = delete. Mark done, drop on the server, then fade the row out —
  // but only once the DELETE actually succeeds; on failure, undo the done state
  // so the item isn't left showing "gone" while still present server-side.
  function checkOff(li, box) {
    if (li.classList.contains('done')) return;
    li.classList.add('done');
    box.textContent = '[x]';
    var id = li.dataset.id;
    fetch('/api/todos/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('delete failed');
        setTimeout(function () { li.remove(); }, 180);
      })
      .catch(function () {
        li.classList.remove('done');
        box.textContent = '[ ]';
      });
  }

  // On failure, restore the typed text into the input instead of discarding it
  // silently — a network error would otherwise lose what the user just typed.
  function addTodo(text) {
    text = (text || '').trim();
    if (!text) return;
    inputEl.value = '';
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (item) {
        if (item) {
          listEl.appendChild(renderItem(item));
          listEl.scrollTop = listEl.scrollHeight;
        } else if (!inputEl.value) {
          inputEl.value = text;
        }
      })
      .catch(function () {
        if (!inputEl.value) inputEl.value = text;
      });
  }

  function loadTodos() {
    fetch('/api/todos')
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) {
        listEl.innerHTML = '';
        (data.items || []).forEach(function (item) {
          listEl.appendChild(renderItem(item));
        });
      })
      .catch(function () {});
  }

  window.execBuildTodos = function (panel) {
    if (!panel || document.getElementById('exec-todos')) return;
    var sec = document.createElement('div');
    sec.id = 'exec-todos';
    sec.innerHTML =
      '<div id="exec-todo-add">' +
        '<span id="exec-todo-prompt">+</span>' +
        '<input id="exec-todo-input" type="text" autocomplete="off" ' +
          'autocorrect="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="add a todo...">' +
      '</div>' +
      '<ul id="exec-todo-list"></ul>';
    panel.insertBefore(sec, panel.firstChild);
    listEl = sec.querySelector('#exec-todo-list');
    inputEl = sec.querySelector('#exec-todo-input');
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addTodo(inputEl.value); }
    });
    loadTodos();
  };
})();
