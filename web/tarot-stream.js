// /tarot reader-turn streaming: streamResponse() drives the LLM fetch + the
// audio-synced / guessed-pace typewriter (createTypewriter). Same global scope
// as tarot-view.js / tarot-voice.js / tarot-chat.js (loaded in order via
// <script>, not modules); only ever called at runtime by autoTrigger.

// The reader's binding to the shared reveal engine (typewriter.js): both modes
// live there now, since the Exec panel and /cc narrate with the same rules.
// Only the render target and the reader's pace are tarot's.
//
//   guessed()   SILENT mode — the weighted per-character pace.
//   audio(ctl)  VOICE mode  — the same weights rescaled to the measured audio,
//               so the text lands with the voice saying it.
//
// The state object is shared and mutable by contract: the caller appends to
// `buffered` and sets `serverDone`, the engine owns `displayed`.
function createTypewriter(st, body, cur) {
  // The reader's pace. The chat surfaces run the same engine at 5 -- a reading
  // is paced to be listened to.
  const SPEED = 1.25;
  function render() {
    body.innerHTML = renderText(st.displayed);
    (body.lastElementChild || body).appendChild(cur);
    terminal.scrollTop = terminal.scrollHeight;
  }
  return {
    guessed: () => twGuess(st, render, { speed: SPEED }).start(),
    audio: (ctl) => twAudio(st, render, ctl, { speed: SPEED }).start(),
  };
}

// Apply one SSE tool_call. Pushes any held sys notes into `pendingSys`; returns
// a spread frame string when this is a successful deal_spread, else null.
function handleToolCall(data, pendingSys) {
  if (data.name === 'set_significator' && data.input?.card_id) {
    const cid = data.input.card_id;
    if (significator) {
      pendingSys.push(`[ set_significator ignored: Significator already locked (${significator.name}) ]`);
    } else if (data.count === 0) {
      pendingSys.push(`[ set_significator failed: ${cid} (not a court card) ]`);
    } else {
      const c = courtList().find(x => x.card_id === cid);
      if (c) {
        significator = {card_id: c.card_id, name: c.name, image: c.image};
        localStorage.setItem(LS_SIG, JSON.stringify(significator));
        renderSigCard();
      }
      pendingSys.push(`[ Significator set: ${c?.name || cid} ]`);
    }
    return null;
  }
  if (data.name === 'deal_spread') {
    if (spread) pendingSys.push('[ deal_spread ignored: spread already dealt ]');
    else if (data.count === 0) pendingSys.push('[ deal_spread error — reader will retry ]');
    // success: no sys note — the '[drew a ...]' event marker announces the deal.
    else return data.input?.frame || 'past_present_future';
    return null;
  }
  const label = data.input?.card_id ? `card lookup — ${data.input.card_id}` : `${data.name} — ${data.count}`;
  pendingSys.push(`[ ${label} ]`);
  return null;
}

async function streamResponse(holdForGesture = null) {
  streaming = true;
  updateInputBarVisibility();
  const {div, body, cur} = addStreamDiv();
  const st = {buffered: '', displayed: '', serverDone: false, cancelled: false};
  const tw = createTypewriter(st, body, cur);
  const pendingSys = [];   // sys notes held until the reader finishes speaking
  let pendingDeal = null;  // frame to deal once the reader is done speaking

  // Voice mode holds the text until audio starts (reader "draws breath"); silent
  // mode types as text arrives. A held opening (holdForGesture, pre-generated on
  // load) holds ALL reveal until the first gesture, so the click adds no LLM wait.
  //
  // `isOn()` is half the question now, not just `ready()`: with the narrator
  // turned OFF there is no clock to pace to, so the reveal runs at the reader's
  // own pace from the first character instead of waiting for a voice that is
  // never coming.
  const willNarrate = tarotVoice.isOn() && tarotVoice.ready();
  let voiceCtl = null;
  if (!willNarrate && !holdForGesture) tw.guessed();

  try {
    const r = await fetch('/api/tarot/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({messages, spread: filteredSpread(), session_id: spread?.session_id || null}),
    });
    if (!r.ok) throw new Error(await r.text());
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'text') st.buffered += data.delta;
        else if (data.type === 'tool_call') {
          const frame = handleToolCall(data, pendingSys);
          if (frame) pendingDeal = frame;
        }
      }
    }
    st.serverDone = true;
    // Held opening: generation is done; wait for the first gesture (unlocks
    // audio) before revealing/narrating — no LLM round-trip on the click.
    if (holdForGesture) await holdForGesture;
    const speakNow = holdForGesture ? (tarotVoice.isOn() && tarotVoice.ready()) : willNarrate;
    // Voice mode strips the trailing flip-invite BEFORE narrating so voice and
    // typewriter share the final text; silent mode strips after typing (below).
    if (speakNow && pendingDeal) st.buffered = stripDealInvite(st.buffered);
    if (speakNow) voiceCtl = tarotVoice.speak(st.buffered);
    // A live utterance paces the reveal across itself; a DEAD controller (voice
    // off, never unlocked, upstream gone) means type now, at the reader's pace.
    if (voiceCtl && voiceCtl.ok) tw.audio(voiceCtl);
    else if (holdForGesture || speakNow) tw.guessed();
    // wait for the reveal to catch up — and, in voice mode, for the voice to end
    while (
      st.displayed.length < st.buffered.length ||
      (voiceCtl && voiceCtl.ok && !voiceCtl.ended)
    ) {
      await new Promise(res => setTimeout(res, 50));
    }
    cur.remove();
    // The deal turn ends at "let me set the cards." — the flip invite is the
    // frontend's job (drawSpread). Strip any the reader tacked on, so no dupe.
    if (pendingDeal) {
      const stripped = stripDealInvite(st.buffered);
      if (stripped !== st.buffered) {
        st.buffered = stripped;
        body.innerHTML = renderText(st.buffered);
      }
    }
    // backstop: reader named the Significator in prose but skipped the tool call.
    // Match the one court card it named and fill the slot so the flow continues.
    if (!significator && st.buffered) {
      const low = st.buffered.toLowerCase();
      const named = courtList().filter(c => low.includes(c.name.toLowerCase()));
      if (named.length === 1) {
        const c = named[0];
        significator = {card_id: c.card_id, name: c.name, image: c.image};
        localStorage.setItem(LS_SIG, JSON.stringify(significator));
        renderSigCard();
      }
    }
    for (const m of pendingSys) setStatus(m);   // held sys notes (latest wins)
    // voice was on but narration of ACTUAL prose failed — reader still read
    // silently. Surface it in the status bar (not reader prose). Skip when there
    // was nothing to narrate (a tool-only turn) — empty speech isn't a failure.
    if (st.buffered && voiceCtl && !voiceCtl.ok && voiceCtl.duration() === 0) {
      setStatus(`[ reader voice unavailable: ${voiceCtl.error || 'no audio'} ]`);
    }
    if (st.buffered) {
      messages.push({role: 'assistant', content: st.buffered});
      localStorage.setItem(LS_MESSAGES, JSON.stringify(messages));
    }
  } catch(e) {
    st.serverDone = true;
    st.cancelled = true;
    cur.remove();
    // Log the error as an action note (not reader prose). Keep any reader text
    // already rendered; drop the bubble only if it's empty.
    if (!st.displayed) div.remove();
    setStatus('[ error: ' + e.message + ' ]');
    pendingDeal = null;
  }
  streaming = false;
  updateInputBarVisibility();
  // draw the spread only now — after the reader stopped and the note printed
  if (pendingDeal) drawSpread('three', pendingDeal);
  else focusInput();
}
