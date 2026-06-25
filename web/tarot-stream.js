// /tarot reader-turn streaming: streamResponse() drives the LLM fetch + the
// audio-synced / guessed-pace typewriter (createTypewriter). Same global scope
// as tarot-view.js / tarot-voice.js / tarot-chat.js (loaded in order via
// <script>, not modules); only ever called at runtime by autoTrigger.

// Reveal engine. Owns `st.displayed`; reads `st.buffered/serverDone/cancelled`
// (a shared mutable state object so streamResponse can append text + cancel).
// Returns { guessed, audio }:
//   guessed()    SILENT mode — type one char at a time at the weighted pace.
//   audio(ctl)   VOICE mode  — pace the reveal off the playback clock.
// Punctuation weights set the SHAPE (dramatic pauses); in voice mode the total
// is rescaled to the measured audio duration. Upstream {end} only means audio is
// BUFFERED, so we stay synced to el/dur until playback actually finishes.
function createTypewriter(st, body, cur) {
  const SPEED = 1.25;   // overall pace multiplier (silent mode)
  const BASE_MS = 65;
  function charWeight(ch) {
    switch (ch) {
      case '.': case '!': case '?': return 850;
      case ',': case ';': case ':': return 420;
      case '—': case '-':           return 480; // em-dash, hyphen
      case '\n':                    return 1100;
      case ' ':                     return 110;
      default:                      return BASE_MS;
    }
  }
  function render() {
    body.innerHTML = renderText(st.displayed);
    (body.lastElementChild || body).appendChild(cur);
    terminal.scrollTop = terminal.scrollHeight;
  }
  function guessed() {
    if (st.cancelled) return;
    if (st.displayed.length < st.buffered.length) {
      st.displayed = st.buffered.slice(0, st.displayed.length + 1);
      render();
      setTimeout(guessed, charWeight(st.displayed[st.displayed.length - 1]) / SPEED);
    } else if (!st.serverDone) {
      setTimeout(guessed, 50);
    }
  }
  function audio(ctl) {
    const text = st.buffered;  // final by now (server stream complete)
    const cum = new Array(text.length + 1);
    cum[0] = 0;
    for (let i = 0; i < text.length; i++) cum[i + 1] = cum[i] + charWeight(text[i]);
    const totalW = cum[text.length] || 1;
    let lastEl = -1, lastProgressAt = performance.now();
    // Audio gave up (errored / never started / stalled): mark the controller
    // failed so the outer wait loop exits, record the reason, finish at the
    // guessed pace. NEVER leave the reveal hanging — that froze the page.
    function bail(reason) {
      ctl.ok = false;
      ctl.ended = true;
      if (!ctl.error) ctl.error = reason;
      guessed();
    }
    function finishBrisk() {  // clean end, text still behind → mop up the tail
      if (st.cancelled) return;
      if (st.displayed.length >= text.length) return;
      st.displayed = text.slice(0, st.displayed.length + 2);
      render();
      setTimeout(finishBrisk, 16);
    }
    function tick() {
      if (st.cancelled) return;
      if (!ctl.ok) { bail(ctl.error); return; }
      const dur = ctl.duration();
      const el = ctl.elapsed();
      if (el > lastEl) { lastEl = el; lastProgressAt = performance.now(); }
      const audioFinished = ctl.ended && dur > 0 && el >= dur;
      // Stall: clock frozen 2.5s and playback not done → finish at guessed pace.
      if (!audioFinished && performance.now() - lastProgressAt > 2500) { bail('no audio'); return; }
      if (dur > 0) {
        let frac = Math.min(el / dur, audioFinished ? 1 : 0.999);
        frac = Math.max(0, Math.min(1, frac));
        const targetW = frac * totalW;
        let n = st.displayed.length;
        while (n < text.length && cum[n + 1] <= targetW) n++;
        if (n !== st.displayed.length) { st.displayed = text.slice(0, n); render(); }
      }
      if (audioFinished && st.displayed.length >= text.length) return;
      if (audioFinished) { finishBrisk(); return; }
      requestAnimationFrame(tick);
    }
    tick();
  }
  return { guessed, audio };
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

// Eager opening generation. Starts a chat fetch for one persona NOW (server
// begins generating + streams into the socket buffers) without reading the body.
// tarot-chat.js fires one per persona behind the "who reads for you?" screen, so
// the pick replays the chosen buffered response with no LLM wait; the others are
// aborted. Returns {promise, abort}.
function prefetchOpening(persona) {
  const ac = new AbortController();
  const promise = fetch('/api/tarot/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({messages, spread: filteredSpread(), persona, session_id: spread?.session_id || null}),
    signal: ac.signal,
  });
  return {promise, abort: () => ac.abort()};
}

// `prefetched`, when given, is a Promise<Response> from prefetchOpening — used
// instead of issuing a fresh fetch (eager opening replay).
async function streamResponse(holdForGesture = null, prefetched = null) {
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
  const voiceReady = tarotVoice.ready();
  let voiceCtl = null;
  if (!voiceReady && !holdForGesture) tw.guessed();

  try {
    const r = prefetched ? await prefetched : await fetch('/api/tarot/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({messages, spread: filteredSpread(), persona: tarotPersona.current(), session_id: spread?.session_id || null}),
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
    const speakNow = holdForGesture ? tarotVoice.ready() : voiceReady;
    // Voice mode strips the trailing flip-invite BEFORE narrating so voice and
    // typewriter share the final text; silent mode strips after typing (below).
    if (speakNow && pendingDeal) st.buffered = stripDealInvite(st.buffered);
    if (speakNow) {
      voiceCtl = tarotVoice.speak(st.buffered);
      tw.audio(voiceCtl);
    } else if (holdForGesture) {
      tw.guessed();  // gesture came but audio unusable → type now
    }
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
    for (const m of pendingSys) addMsg('sys', m);   // held sys notes
    // voice was on but narration failed — reader still read silently. Log it as
    // an action note (not reader prose) so it's visible without breaking things.
    if (voiceCtl && !voiceCtl.ok) {
      addMsg('sys', `[ reader voice unavailable: ${voiceCtl.error || 'no audio'} ]`);
    }
    const sysMsgs = terminal.querySelectorAll('.msg.sys');
    for (let i = 0; i < sysMsgs.length - 6; i++) sysMsgs[i].remove();
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
    addMsg('sys', '[ error: ' + e.message + ' ]');
    pendingDeal = null;
  }
  streaming = false;
  updateInputBarVisibility();
  // draw the spread only now — after the reader stopped and the note printed
  if (pendingDeal) drawSpread('three', pendingDeal);
  else focusInput();
}
