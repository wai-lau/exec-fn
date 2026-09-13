// Multiple-choice answers for a nudge, rendered as tappable buttons.
//
// A nudge ends on a question, and the question is the part Wai answers — so the
// model writes the answers as its final line, "[Sent it | Not yet | Doing it
// now]". One bracketed span is already how Exec writes a sys note, and
// exec-voice.js's speak() strips every [...] span before narrating, so the
// marker costs the voice path nothing and needs no second parser there.
//
// Tapping a button sends that text as Wai's own message — the same message she
// would have typed — so nothing server-side has to know the buttons exist: the
// exec chat already reads "done" as advancing the chunk and "not yet" as an
// answer rather than pushback.
window.execChoices = (function () {
  // Anchored to the LAST line and required to carry a '|', so an ordinary
  // [bracketed] sys note, a markdown link, or a stray bracket mid-sentence is
  // never mistaken for a choice row.
  const RE = /\n[ \t]*\[([^[\]\n]*\|[^[\]\n]*)\][ \t]*$/;

  function parse(text) {
    const m = typeof text === 'string' ? text.match(RE) : null;
    if (!m) return { clean: text, opts: [] };
    const opts = m[1].split('|')
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, 4);
    return { clean: text.slice(0, m.index).trim(), opts: opts };
  }

  function strip(text) { return parse(text).clean; }

  function clear(termEl) {
    const rows = termEl.querySelectorAll('.exec-choice-row');
    for (let i = 0; i < rows.length; i++) rows[i].remove();
  }

  // Only the NEWEST nudge keeps live buttons (clear() first): an older row is a
  // question already answered or overtaken, and tapping one would send an answer
  // about a step Exec has since moved off. Replaying history walks oldest-first,
  // so this leaves the buttons on the last nudge for free.
  function attach(termEl, afterEl, opts, send) {
    clear(termEl);
    if (!opts || !opts.length) return null;
    const row = document.createElement('div');
    row.className = 'exec-choice-row';
    opts.forEach(function (label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'exec-choice';
      b.textContent = label;
      b.addEventListener('click', function () {
        if (!row.parentNode) return;   // already tapped; never send twice
        row.remove();
        send(label);
      });
      row.appendChild(b);
    });
    afterEl.parentNode.insertBefore(row, afterEl.nextSibling);
    termEl.scrollTop = termEl.scrollHeight;
    return row;
  }

  return { parse: parse, strip: strip, attach: attach, clear: clear };
})();
