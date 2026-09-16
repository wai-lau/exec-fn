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
// answer rather than pushback. It is sent behind a `[answering: "..." card=...]`
// reference, because several questions can be open at once and a bare "Not yet"
// belongs to none of them on its face (see answerRef).
//
// CARD ACTIONS are the exception, and they are deliberately NOT messages. A
// nudge also carries its card's id, and `done` / `exile` mean exactly what the
// same two buttons on the card dialog mean — archive it, or drop it — so they
// PATCH the card directly (cdDone/cdExile in card-dialog.js do the identical
// {id, column} write). Routing those through the model instead would spend a
// turn asking it to do something the tap already decided, and could silently
// not happen. They are appended by the CLIENT, not written by the model: they
// apply to every nudge, and a model that has to remember to offer them is one
// that will sometimes forget.
//
// Only {id, column} is sent — PATCH /api/rd merges by id, so every field the
// client does not own (above all the server-owned `nudge` block) is preserved.
window.execChoices = (function () {
  // Label -> the column the card dialog's button moves it to.
  const CARD_ACTIONS = [
    { label: 'done', column: 'archives' },
    { label: 'exile', column: 'exile' },
  ];
  // Anchored to the LAST line and required to carry a '|', so an ordinary
  // [bracketed] sys note, a markdown link, or a stray bracket mid-sentence is
  // never mistaken for a choice row.
  //
  // Emphasis around the row is tolerated (`**[a | b]**`) and so is trailing
  // whitespace: the model reaches for bold on a line that reads like a control,
  // and a row that misses by two asterisks doesn't degrade — it prints the raw
  // brackets as prose and Wai gets no buttons at all, which is how it failed.
  const RE = /\n[ \t]*(?:\*\*|__|\*|_)?\[([^[\]\n]*\|[^[\]\n]*)\](?:\*\*|__|\*|_)?\s*$/;

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

  // EVERY question keeps its answer buttons, for as long as it is unanswered.
  //
  // They used to be wiped down to the newest nudge on every attach(), on the
  // theory that an older question had been overtaken. It had not: a day that
  // fires two nudges asks two real questions, and Wai answers them when she
  // surfaces, not in arrival order. Wiping the older row left exactly one
  // tappable row on screen — under the WRONG card (2026-09-16: the tap meant
  // for the 14:00 climbing nudge archived "Lyre poster", and climbing had to be
  // archived by hand from /hq 22s later).
  //
  // What the old rule was really protecting against is ambiguity: an answer is
  // a bare "Packed" with nothing saying which question it answers. So the tap
  // carries a REFERENCE instead (see answerRef) — deterministic, resolvable
  // against the transcript, and cheaper than throwing the buttons away.
  //
  // Only two things retire a row: answering that question (its answer buttons
  // go, the card actions stay — the card may still need marking), and the card
  // action itself (the whole row goes).
  function retireAnswers(row) {
    const answers = row.querySelectorAll('.exec-choice:not(.exec-act)');
    for (let i = 0; i < answers.length; i++) answers[i].remove();
    if (!row.querySelector('.exec-choice')) row.remove();
  }

  // Legacy no-op kept because exec-bubble.js calls it before sending a typed
  // message. Typing an answer no longer retires anything: the message says what
  // it says, and a question Wai did not answer is still open.
  function clear() {}

  // The deterministic part. An answer means nothing on its own — "Not yet"
  // could belong to any open question — so the tap prefixes the message with a
  // reference the model can RESOLVE rather than guess:
  //
  //   [answering: "Packed yet?" card=card-climbing] Packed
  //
  // The quoted question is the last interrogative sentence of the message the
  // buttons hang under, which appears verbatim in the transcript the model is
  // reading, so matching it is a string compare, not an inference. `card=` is
  // added when the row came from a nudge (a nudge push carries its card id), so
  // advance_chunk/archive_card get the id directly instead of the model working
  // out which card the question was about.
  //
  // Collapsed whitespace and a 120-char cap keep the marker to one line; the
  // prefix of a question is still unique against the handful of open ones.
  function question(text) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    const asked = flat.match(/[^.!?]*\?/g);
    const q = (asked && asked.length ? asked[asked.length - 1] : flat).trim();
    return q.length > 120 ? q.slice(0, 119).trimEnd() + '\u2026' : q;
  }

  function answerRef(text, cardId) {
    const q = question(text);
    if (!q && !cardId) return '';
    return '[answering:' + (q ? ' "' + q.replace(/"/g, "'") + '"' : '')
                         + (cardId ? ' card=' + cardId : '') + '] ';
  }

  // Move the card the way its own dialog button would. Merge-by-id means the
  // {id, column} pair is the whole write; the server handles the rest (clearing
  // scheduled_day on exile, preserving it into archives, reviving a recurring
  // card). Leaving hq also ends the nudge loop for this card on its own, since
  // _eligible() requires column == "hq" — nothing has to disarm it by hand.
  async function runAction(act, cardId) {
    const res = await fetch('/api/rd?source=Exec', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [{ id: cardId, column: act.column }] }),
    });
    if (!res.ok) throw new Error('patch failed: ' + res.status);
    // Repaint any open board immediately rather than waiting for the monitor
    // debounce to push {cards_changed}.
    window.dispatchEvent(new Event('exec:cards-changed'));
  }

  function actionButton(act, cardId, row, note) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'exec-choice exec-act exec-act-' + act.label;
    b.textContent = act.label;
    b.addEventListener('click', async function () {
      if (b.disabled || !row.parentNode) return;
      b.disabled = true;
      try {
        await runAction(act, cardId);
        row.remove();
      } catch (e) {
        // Re-arm rather than vanish: a failed tap that removed the row would
        // look exactly like a successful one.
        b.disabled = false;
        if (note) note('could not ' + act.label + ' that card (' + e.message + ')');
      }
    });
    return b;
  }

  // `cardId` is present only on a nudge (a monitor comment is about the whole
  // board, so it gets no card actions) — so a nudge's row offers that card's own
  // done/exile actions and a monitor comment's does not. `asked` is the message
  // the row hangs under, used to build the answer's reference. `note` prints a
  // sys line on failure. Callers hand us every row unconditionally; returning
  // null on an empty one keeps that check here instead of at each call site.
  function attach(termEl, afterEl, opts, send, cardId, note, asked) {
    if ((!opts || !opts.length) && !cardId) return null;
    const ref = (opts && opts.length) ? answerRef(asked, cardId) : '';
    const row = document.createElement('div');
    row.className = 'exec-choice-row';
    (opts || []).forEach(function (label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'exec-choice';
      b.textContent = label;
      b.addEventListener('click', function () {
        if (!b.parentNode) return;   // already tapped; never send twice
        retireAnswers(row);
        send(ref + label);
      });
      row.appendChild(b);
    });
    if (cardId) {
      CARD_ACTIONS.forEach(function (act) {
        row.appendChild(actionButton(act, cardId, row, note));
      });
    }
    afterEl.parentNode.insertBefore(row, afterEl.nextSibling);
    termEl.scrollTop = termEl.scrollHeight;
    return row;
  }

  return { parse: parse, strip: strip, attach: attach, clear: clear,
           answerRef: answerRef };
})();
