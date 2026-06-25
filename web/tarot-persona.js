// /tarot reader persona picker. Chooses which character voices the reading:
// the persona id rides with each chat turn (the server restyles every
// non-default persona through a second haiku pass -- see api/tarot/restyle.py),
// and the persona's TTS voice is handed to tarot-voice.js for narration.
//
// The ONLY chooser is the "who reads for you?" gate (chooseScreen) shown before a
// fresh reading: the pick selects the persona, unlocks audio, and begins the
// reading. Once you pick, you are committed for the session -- there is no
// mid-reading switch. tarot-chat.js eager-generates every persona's opening
// behind this screen so the pick reveals instantly.
//
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

  function record() {
    return personas.find((p) => p.id === current) || personas[0];
  }

  function applyVoice() {
    if (typeof tarotVoice !== "undefined" && tarotVoice.setVoice) tarotVoice.setVoice(record());
  }

  function select(id) {
    if (!personas.some((p) => p.id === id)) return;
    current = id;
    localStorage.setItem(LS_PERSONA, current);
    applyVoice();
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
        if (typeof tarotVoice !== "undefined" && tarotVoice.unlock) tarotVoice.unlock();
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
