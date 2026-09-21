// The canned opening turn: /tarot's first reader turn, pre-generated.
//
// The first turn is the only turn that depends on nothing but the clock -- no
// history, no Significator, no spread -- so the server keeps ten of them per
// hour with the narration ALREADY RENDERED (api/tarot/openings.py). Playing one
// costs a small JSON read and a .wav instead of an opus round-trip plus a cold
// TTS synth, which together were the slow start on the first reading of a day.
//
// Everything here falls back: an hour with no clips, a failed fetch, a clip
// whose audio never lands -- each one lands on the live path (autoTrigger), the
// way the page always worked.
//
// Same global scope as tarot-view/-stream/-chat.js (classic scripts in load
// order). Loaded after tarot-stream.js, which owns createTypewriter; called by
// tarot-chat.js, which owns showBeginHint and the opening event marker.

// How long the reveal waits for the clip's audio before giving up and typing it
// silently. Generous because it is competing with a cold synth (~4.6s) plus an
// LLM turn, not with zero -- but bounded, because a stalled fetch must not hold
// the reading.
const TAROT_CLIP_WAIT_MS = 5000;

const TarotOpening = (() => {
  let clip = null;
  let audio = null; // Promise<ArrayBuffer|null> — the clip's narration

  // Fire-and-forget: load the voice models while the querent reads the opening.
  // The opening itself needs no synth, but the reader's NEXT turn does, and
  // under GPU mode `idle` the models load on demand. Server-side cooldown means
  // a reload storm is not GPU load.
  function warmVoice() {
    fetch('/api/tarot/warm', {method: 'POST'}).catch(() => {});
  }

  // Say it once, in the status bar, when the reader's voice cannot come: the
  // home GPU box is unreachable, so every turn after this one reads in silence.
  // Deliberately NOT the same words as streamResponse's "reader voice
  // unavailable", which means a voice that tried and failed — this one never
  // had a box to try.
  function noteIfVoiceDown() {
    if (tarotVoice.homeDown()) {
      setStatus('[ reader voice offline — the reading continues in silence ]');
    }
  }

  // Start the download NOW: the page then sits on "tap anywhere to begin" while
  // it lands, so the tap plays instead of waiting.
  function prefetchAudio(url) {
    audio = fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }

  async function fetchClip() {
    clip = null;
    audio = null;
    try {
      const r = await fetch(`/api/tarot/opening?hour=${new Date().getHours()}`);
      if (!r.ok) return null;
      clip = (await r.json()).clip;
    } catch {
      return null;
    }
    if (clip) prefetchAudio(clip.audio);
    return clip;
  }

  function waitAudio() {
    if (!audio) return Promise.resolve(null);
    return Promise.race([audio, new Promise(res => setTimeout(() => res(null), TAROT_CLIP_WAIT_MS))]);
  }

  // One reader turn with no server round-trip. The marker is recorded exactly
  // as autoTrigger would record it, the text is revealed by the same typewriter
  // (audio-paced if the clip plays, guessed pace if not), and the reply is
  // pushed onto `messages` so the model continues the reading from its own
  // first turn with no idea it did not write it.
  async function play(ev, gate) {
    addEventMsg(ev);
    messages.push({role: 'user', content: ev});
    streaming = true;
    updateInputBarVisibility();
    const {body, cur} = addStreamDiv();
    const st = {buffered: clip.text, displayed: '', serverDone: true, cancelled: false};
    const tw = createTypewriter(st, body, cur);
    if (gate) await gate;  // the first gesture — audio is unlocked by now
    // Narrator off → no clip audio and no waiting for it: the opening reveals
    // at the reader's own pace like any other turn.
    const wantsVoice = tarotVoice.isOn() && tarotVoice.ready();
    const buf = wantsVoice ? await waitAudio() : null;
    const ctl = buf ? tarotVoice.speakClip(buf) : null;
    if (ctl && ctl.ok) tw.audio(ctl);
    else tw.guessed();
    // Narration was expected and the clip's audio never arrived. Say so in the
    // status bar — but NOT as "reader voice unavailable", which streamResponse
    // reserves for a voice that actually failed: here the voice is fine and the
    // file is what went missing.
    if (wantsVoice && !buf) setStatus('[ opening narration unavailable — reading silently ]');
    while (
      st.displayed.length < st.buffered.length ||
      (ctl && ctl.ok && !ctl.ended)
    ) {
      await new Promise(res => setTimeout(res, 50));
    }
    cur.remove();
    messages.push({role: 'assistant', content: clip.text});
    localStorage.setItem(LS_MESSAGES, JSON.stringify(messages));
    streaming = false;
    updateInputBarVisibility();
    terminal.dispatchEvent(new CustomEvent('tarot:reply-done'));
    focusInput();
    return true;
  }

  return {fetch: fetchClip, play, warmVoice, noteIfVoiceDown};
})();

// The opening turn, canned where it can be and live where it cannot.
// `canned` is false for the two openings that are NOT a first turn (a returning
// querent whose Significator is already set, or one who left mid-spread) —
// those have to be written against that state.
async function startOpeningTurn(ev, canned) {
  // Warm the models only if there are models to warm — with the home box down
  // the POST is a round-trip into a dead tunnel. The probe also decides whether
  // the reading gets the "voice offline" note once the opening has played.
  tarotVoice.probeHome().then(up => { if (up) TarotOpening.warmVoice(); });
  const clipP = canned ? TarotOpening.fetch() : Promise.resolve(null);
  if (!tarotVoice.wantsDeferredOpening()) {
    // Audio already unlocked (or voice unusable) → reveal immediately.
    const clip = await clipP;
    const ok = clip ? await TarotOpening.play(ev, null) : await autoTrigger(ev);
    TarotOpening.noteIfVoiceDown();
    return ok;
  }
  // Voice on but no gesture has unlocked audio yet. Fetch/generate NOW and hold
  // only the reveal + narration until the first gesture, so the tap starts the
  // reading with nothing queued behind it. While held, the reader bubble and
  // input bar are blank (body.opening-pending) and only the hint shows.
  const clearHint = showBeginHint();
  document.body.classList.add('opening-pending');
  let openGate;
  const gate = new Promise(res => { openGate = res; });
  tarotVoice.armOpeningUnlock(() => {
    document.body.classList.remove('opening-pending');
    clearHint();
    openGate();
  });
  const clip = await clipP;
  // The canned opening narrates from a FILE, so it speaks even with the box
  // down — which is why the note waits for it to finish. Silence starts at the
  // querent's first answer, not here.
  const ok = clip ? await TarotOpening.play(ev, gate) : await autoTrigger(ev, gate);
  TarotOpening.noteIfVoiceDown();
  return ok;
}
