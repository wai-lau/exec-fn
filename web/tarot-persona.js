// /tarot reader persona picker. Chooses which character voices the reading:
// the persona id rides with each chat turn (the server restyles every
// non-default persona through a second haiku pass -- see api/tarot/restyle.py),
// and the persona's TTS voice is handed to tarot-voice.js for narration.
//
// Two entry points:
//  - chooseScreen(onPick): the "who reads for you?" gate shown before a fresh
//    reading. The pick is the user gesture that selects the persona + unlocks
//    audio, then fires onPick(id). tarot-chat.js eager-generates every persona's
//    opening behind this screen so the pick reveals instantly.
//  - a cycle button (#persona-btn, shares .spread-btn) in #spread-controls for
//    switching persona mid-reading (affects subsequent turns).
// Selection persists in localStorage `tarot.persona` (default `reader`). Loaded
// AFTER tarot-voice.js (needs tarotVoice) + BEFORE tarot-stream.js.
const LS_PERSONA = "tarot.persona";
const READER_PERSONA = {
  id: "reader", name: "the Reader",
  voice_id: "af_nicole", backend: "kokoro", gain: 0.98,
};

const tarotPersona = (() => {
  // current() must be correct synchronously (an opening can read it before the
  // persona list has fetched), so seed it from localStorage now.
  let current = localStorage.getItem(LS_PERSONA) || READER_PERSONA.id;
  let personas = [READER_PERSONA];
  let cycleBtn = null;

  function record() {
    return personas.find((p) => p.id === current) || personas[0];
  }

  function applyVoice() {
    if (window.tarotVoice && tarotVoice.setVoice) tarotVoice.setVoice(record());
  }

  function select(id) {
    if (!personas.some((p) => p.id === id)) return;
    current = id;
    localStorage.setItem(LS_PERSONA, current);
    applyVoice();
    renderCycle();
  }

  function renderCycle() {
    if (cycleBtn) cycleBtn.innerHTML = `[<span class="persona-name">${record().name}</span>]`;
  }

  function cycle() {
    const i = personas.findIndex((p) => p.id === current);
    select(personas[(i + 1) % personas.length].id);
  }

  function mountCycle() {
    const controls = document.getElementById("spread-controls");
    if (!controls || cycleBtn) return;
    cycleBtn = document.createElement("button");
    cycleBtn.className = "spread-btn persona-btn";
    cycleBtn.id = "persona-btn";
    cycleBtn.title = "Reader persona (tap to change)";
    cycleBtn.setAttribute("aria-label", "Change reader persona");
    cycleBtn.addEventListener("click", cycle);
    renderCycle();
    controls.appendChild(cycleBtn);
  }

  // The "who reads for you?" gate. Renders one button per persona in #terminal;
  // a click is the user gesture -> select the persona, unlock audio in-gesture,
  // remove the screen, fire onPick(id). With a single persona (e.g. the endpoint
  // failed) there is nothing to choose, so it fires onPick immediately.
  function chooseScreen(onPick) {
    const terminal = document.getElementById("terminal");
    if (!terminal || personas.length <= 1) {
      select(current);
      onPick(current);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "reader-select";
    const title = document.createElement("div");
    title.className = "reader-select-title";
    title.textContent = "who reads for you?";
    wrap.appendChild(title);
    const row = document.createElement("div");
    row.className = "reader-select-row";
    for (const p of personas) {
      const b = document.createElement("button");
      b.className = "spread-btn reader-pick";
      b.innerHTML = `[<span class="persona-name">${p.name}</span>]`;
      b.addEventListener("click", () => {
        select(p.id);
        if (window.tarotVoice && tarotVoice.unlock) tarotVoice.unlock();
        wrap.remove();
        onPick(p.id);
      });
      row.appendChild(b);
    }
    wrap.appendChild(row);
    terminal.appendChild(wrap);
  }

  const ready = (async () => {
    try {
      const r = await fetch("/api/tarot/personas");
      const d = await r.json();
      if (Array.isArray(d.personas) && d.personas.length) personas = d.personas;
    } catch {
      /* offline / error -> keep the default reader only */
    }
    if (!personas.some((p) => p.id === current)) current = READER_PERSONA.id;
    mountCycle();
    applyVoice();
    return personas;
  })();

  return {
    current: () => current,
    list: () => personas,
    ready,
    select,
    chooseScreen,
  };
})();
