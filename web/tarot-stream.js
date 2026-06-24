// /tarot reader-turn streaming: streamResponse() drives the LLM fetch + the
// audio-synced / guessed-pace typewriter (drainAudio + drainGuessed). Same
// global scope as tarot-view.js / tarot-voice.js / tarot-chat.js (loaded in
// order via <script>, not modules); only ever called at runtime by autoTrigger.
async function streamResponse(holdForGesture = null) {
  streaming = true;
  updateInputBarVisibility();
  const {div, body, cur} = addStreamDiv();
  let buffered = '';   // received from server
  let displayed = '';  // rendered to DOM
  let serverDone = false;
  let drainCancelled = false;
  const pendingSys = [];  // sys notes held until the reader finishes speaking
  let pendingDeal = null; // frame to deal once the reader is done speaking

  // Punctuation-weighted pacing. In SILENT mode these are the literal per-char
  // delays (tuned to an unhurried reader, ~130 wpm). In VOICE mode the SAME
  // weights set only the SHAPE of the typing — the dramatic pauses at periods
  // and em-dashes — while the total is rescaled to the measured audio duration
  // and driven off the playback clock, so the text tracks the actual voice.
  const SPEED = 1.25;       // overall pace multiplier (silent mode)
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
    body.innerHTML = renderText(displayed);
    (body.lastElementChild || body).appendChild(cur);
    terminal.scrollTop = terminal.scrollHeight;
  }
  // SILENT: reveal one char at a time at the weighted (guessed) pace.
  function drainGuessed() {
    if (drainCancelled) return;
    if (displayed.length < buffered.length) {
      displayed = buffered.slice(0, displayed.length + 1);
      render();
      setTimeout(drainGuessed, charWeight(displayed[displayed.length - 1]) / SPEED);
    } else if (!serverDone) {
      setTimeout(drainGuessed, 50);
    }
  }
  // VOICE: drive the reveal off the audio clock. `buffered` is final by the time
  // this runs (after the server stream completes), so the weight schedule is fixed.
  function drainAudio(ctl) {
    const text = buffered;
    const cum = new Array(text.length + 1);
    cum[0] = 0;
    for (let i = 0; i < text.length; i++) cum[i + 1] = cum[i] + charWeight(text[i]);
    const totalW = cum[text.length] || 1;
    let lastEl = -1, lastProgressAt = performance.now();
    // Audio gave up (errored, never started, or stalled mid-stream). Mark the
    // controller failed so the outer wait loop can exit, record the reason for
    // the chat note, then finish the text at the guessed pace. NEVER leave the
    // reveal hanging — that froze the page when speaking failed.
    function bail(reason) {
      ctl.ok = false;
      ctl.ended = true;
      if (!ctl.error) ctl.error = reason;
      drainGuessed();
    }
    // Audio ended cleanly but text is still behind (e.g. a tail with no audio):
    // reveal the rest briskly, then stop.
    function finishBrisk() {
      if (drainCancelled) return;
      if (displayed.length >= text.length) return;
      displayed = text.slice(0, displayed.length + 2);
      render();
      setTimeout(finishBrisk, 16);
    }
    function tick() {
      if (drainCancelled) return;
      if (!ctl.ok) { bail(ctl.error); return; }  // upstream/speak error → guessed pace
      const dur = ctl.duration();
      const el = ctl.elapsed();
      if (el > lastEl) { lastEl = el; lastProgressAt = performance.now(); }
      // ctl.ended = upstream finished STREAMING the audio (all PCM buffered),
      // NOT that playback finished. Stay synced to the playback clock until the
      // played time (el) catches the buffered duration — else the text dumps out
      // early while the voice is still talking.
      const audioFinished = ctl.ended && dur > 0 && el >= dur;
      // Stall: the clock hasn't advanced for 2.5s and playback isn't done (never
      // started, or the upstream dropped mid-utterance) → don't freeze; finish
      // the rest at the guessed pace.
      if (!audioFinished && performance.now() - lastProgressAt > 2500) { bail('no audio'); return; }
      if (dur > 0) {
        // fraction of the voice actually PLAYED; don't outrun it
        let frac = Math.min(el / dur, audioFinished ? 1 : 0.999);
        frac = Math.max(0, Math.min(1, frac));
        const targetW = frac * totalW;
        let n = displayed.length;
        while (n < text.length && cum[n + 1] <= targetW) n++;
        if (n !== displayed.length) { displayed = text.slice(0, n); render(); }
      }
      if (audioFinished && displayed.length >= text.length) return;  // done
      if (audioFinished) { finishBrisk(); return; }  // playback done, tail w/o audio → mop up
      requestAnimationFrame(tick);
    }
    tick();
  }

  // Decide the path up front. Voice mode holds the text until audio starts (the
  // reader "draws breath" behind a blinking cursor); silent mode types as the
  // server text arrives, exactly as before. A held opening (holdForGesture) was
  // generated eagerly on load -- hold ALL reveal until the first gesture, so the
  // click adds no LLM wait (generation already happened in the background).
  const voiceReady = tarotVoice.ready();
  let voiceCtl = null;
  if (!voiceReady && !holdForGesture) drainGuessed();

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
        if (data.type === 'text') {
          buffered += data.delta;
        } else if (data.type === 'tool_call') {
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
          } else if (data.name === 'deal_spread') {
            if (spread) {
              pendingSys.push('[ deal_spread ignored: spread already dealt ]');
            } else if (data.count === 0) {
              pendingSys.push('[ deal_spread error — reader will retry ]');
            } else {
              // no sys note — the '[drew a ...]' event marker already
              // announces the deal. defer the actual draw until the reader
              // has finished speaking.
              pendingDeal = data.input?.frame || 'past_present_future';
            }
          } else {
            const label = data.input?.card_id ? `card lookup — ${data.input.card_id}` : `${data.name} — ${data.count}`;
            pendingSys.push(`[ ${label} ]`);
          }
        }
      }
    }
    serverDone = true;
    // Held opening: generation is done; now wait for the first gesture (which
    // unlocks audio) before revealing/narrating. Generation already happened on
    // load, so the click incurs no LLM round-trip.
    if (holdForGesture) await holdForGesture;
    const speakNow = holdForGesture ? tarotVoice.ready() : voiceReady;
    // Voice mode: strip any trailing flip-invite BEFORE narrating (so the voice
    // and the typewriter both work from the final text), then start the reader
    // and pace the reveal to it. Silent mode strips after typing (below).
    if (speakNow && pendingDeal) buffered = stripDealInvite(buffered);
    if (speakNow) {
      voiceCtl = tarotVoice.speak(buffered);
      drainAudio(voiceCtl);
    } else if (holdForGesture) {
      drainGuessed();  // gesture came but audio unusable → type now
    }
    // wait for the reveal to catch up — and, in voice mode, for the voice to end
    while (
      displayed.length < buffered.length ||
      (voiceCtl && voiceCtl.ok && !voiceCtl.ended)
    ) {
      await new Promise(r => setTimeout(r, 50));
    }
    cur.remove();
    // The deal turn must end at "let me set the cards." — the flip invite is the
    // frontend's job now (see drawSpread). If the reader tacked one on anyway,
    // strip the trailing invite so it isn't duplicated.
    if (pendingDeal) {
      const stripped = stripDealInvite(buffered);
      if (stripped !== buffered) {
        buffered = stripped;
        body.innerHTML = renderText(buffered);
      }
    }
    // backstop: reader declared the Significator in prose but skipped the
    // set_significator tool call. Match the one court card it named and fill the
    // slot so the flow doesn't stall.
    if (!significator && buffered) {
      const low = buffered.toLowerCase();
      const named = courtList().filter(c => low.includes(c.name.toLowerCase()));
      if (named.length === 1) {
        const c = named[0];
        significator = {card_id: c.card_id, name: c.name, image: c.image};
        localStorage.setItem(LS_SIG, JSON.stringify(significator));
        renderSigCard();
      }
    }
    // reader done speaking — now emit any held sys notes
    for (const m of pendingSys) addMsg('sys', m);
    // voice was on but the narration failed (TTS offline, stalled, can't play) —
    // the reader still read silently. Log it as an action note (not reader prose)
    // so it's visible without breaking the reading.
    if (voiceCtl && !voiceCtl.ok) {
      addMsg('sys', `[ reader voice unavailable: ${voiceCtl.error || 'no audio'} ]`);
    }
    const sysMsgs = terminal.querySelectorAll('.msg.sys');
    for (let i = 0; i < sysMsgs.length - 6; i++) sysMsgs[i].remove();
    if (buffered) {
      messages.push({role: 'assistant', content: buffered});
      localStorage.setItem(LS_MESSAGES, JSON.stringify(messages));
    }
  } catch(e) {
    serverDone = true;
    drainCancelled = true;
    cur.remove();
    // Log the error as an action note (not reader prose). Keep any reader text
    // that already rendered; drop the bubble only if it's empty.
    if (!displayed) div.remove();
    addMsg('sys', '[ error: ' + e.message + ' ]');
    pendingDeal = null;
  }
  streaming = false;
  updateInputBarVisibility();
  // draw the spread only now — after the reader stopped and the note printed
  if (pendingDeal) drawSpread('three', pendingDeal);
  else focusInput();
}
