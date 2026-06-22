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
    var box = document.createElement('span');
    box.className = 'exec-todo-box';
    box.textContent = '[ ]';
    var txt = document.createElement('span');
    txt.className = 'exec-todo-text';
    txt.textContent = esc(item.text);
    li.appendChild(box);
    li.appendChild(txt);
    box.addEventListener('click', function () { checkOff(li, box); });
    return li;
  }

  // Checkbox = delete. Mark done, drop on the server, then fade the row out.
  function checkOff(li, box) {
    if (li.classList.contains('done')) return;
    li.classList.add('done');
    box.textContent = '[x]';
    var id = li.dataset.id;
    fetch('/api/todos/' + encodeURIComponent(id), { method: 'DELETE' })
      .catch(function () {})
      .finally(function () {
        setTimeout(function () { li.remove(); }, 180);
      });
  }

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
        }
      })
      .catch(function () {});
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
