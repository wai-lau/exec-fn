// Exec scratch todo list — beside the calendar on /rd only (never in the panel).
// Server-persisted (exec_todos.json) and SEPARATE from rd.json cards. The
// checkbox marks an item done (struck through, still there; tap again to undo);
// the 4:30 morning run is what removes it. Built at page load into #rd-notes.
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
    box.textContent = item.done ? '\u25A0' : '\u25A1';
    if (item.done) li.classList.add('done');
    var txt = document.createElement('span');
    txt.className = 'exec-todo-text';
    txt.textContent = esc(item.text);
    li.appendChild(box);
    li.appendChild(txt);
    box.addEventListener('click', function () { toggleDone(li, box); });
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

  // Checkbox = done, not delete: the row stays, struck through, until the
  // morning run clears it, and a second tap takes it back. The row flips at
  // once and flips back if the PATCH fails, so it never shows a state the
  // server does not hold.
  function toggleDone(li, box) {
    var done = !li.classList.contains('done');
    function show(d) {
      li.classList.toggle('done', d);
      box.textContent = d ? '\u25A0' : '\u25A1';
    }
    show(done);
    fetch('/api/todos/' + encodeURIComponent(li.dataset.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: done }),
    })
      .then(function (r) { if (!r.ok) throw new Error('toggle failed'); })
      .catch(function () { show(!done); });
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
          listEl.insertBefore(renderItem(item), listEl.firstChild);
          listEl.scrollTop = 0;
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
        var items = (data.items || []).slice();
        items.reverse();
        items.forEach(function (item) {
          listEl.appendChild(renderItem(item));
        });
      })
      .catch(function () {});
  }

  // The list lives only beside the calendar on /rd (#rd-notes); the Exec
  // panel carries none (Wai, 2026-11-20: "don't want the todos on the exec
  // chat on any page"). Add row leads the list, so newest first.
  function build(slot) {
    if (document.getElementById('exec-todos')) return;
    var sec = document.createElement('div');
    sec.id = 'exec-todos';
    // The add row (moved above the list by rd.css) reads as the next empty
    // row: it starts with the same empty-square box the rows do (a label, so
    // tapping it focuses the input), and typed text begins in the rows' text
    // column, instead of under the box.
    sec.innerHTML =
      '<ul id="exec-todo-list"></ul>' +
      '<div id="exec-todo-add">' +
        '<label class="exec-todo-box" for="exec-todo-input">\u25A1</label>' +
        '<input id="exec-todo-input" type="text" autocomplete="off" ' +
          'autocorrect="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="add a note...">' +
      '</div>';
    slot.insertBefore(sec, slot.firstChild);
    listEl = sec.querySelector('#exec-todo-list');
    inputEl = sec.querySelector('#exec-todo-input');
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addTodo(inputEl.value); }
    });
    loadTodos();
  }

  function buildInSlot() {
    var slot = document.getElementById('rd-notes');
    if (slot) build(slot);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildInSlot);
  else buildInSlot();
})();
