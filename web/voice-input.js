/* Hands-free chat input, on the browser's own speech recognition.
 *
 * The keyboard's dictation key already types into these fields, so this is not
 * about making speech possible -- it is about not needing the keyboard at all:
 * tap once, talk, and the message sends itself when you stop. That matters on a
 * surface whose whole use is one-handed at odd hours.
 *
 * SHARED by /cc (cc-mic.js) and the Exec panel (exec-mic.js). It was written
 * for /cc and every comment below is a bug that was paid for there; a second
 * near-copy for the panel would have drifted a fix at a time, which is exactly
 * what the shared chat CSS was split up to stop.
 *
 * webkitSpeechRecognition is the native API (Safari, Chrome); Firefox has none,
 * and a home-screen launch on iOS has historically been the flakiest host for
 * it. Where it is missing the caller wires nothing and the prompt stays an
 * ordinary `$` -- a missing API costs an affordance, never a dead control that
 * does nothing when tapped.
 *
 * THE CONTROL IS THE PROMPT on both surfaces. A separate button belongs at the
 * right end of the input line, which is where the Exec bubble rests (right:
 * 14px, bottom nav + 10) -- it intercepted the taps, measured. The `$` is
 * already a one-character cell in the shared 1ch gutter, so using it costs no
 * width, cannot collide, and keeps the composer aligned with the transcript
 * above it. It turns into a filled dot while listening.
 *
 * Every function below takes the session object `s` rather than closing over
 * it: the whole thing lived inside create() once and blew the 100-line
 * per-function cap.
 */
'use strict';

window.VoiceInput = (function () {
  const IDLE = '$';
  const LIVE = '●';   // the prompt itself, lit while listening

  // NO held getUserMedia stream, deliberately. One was added to keep iOS's
  // audio session warm across a long silence, and it worked, but Safari gates
  // getUserMedia (microphone) and speech recognition SEPARATELY -- so opening a
  // voice session asked for permission twice, which is a worse bug than the one
  // it fixed. The recovery path carries it instead: every error is silent,
  // every restart builds a fresh recognizer, and a refused start is retried. If
  // `audio-capture` ever becomes common again, the held stream is the fix, and
  // the second prompt is its price.
  const RETRY_MS = 300;
  // Consecutive failed restarts. A recognizer that cannot be restarted must not
  // be retried forever; ten is far past any transient hiccup.
  const MAX_FAILS = 10;
  // A recognizer that never fires `end` holds the microphone open for as long
  // as the page lives. Safari has done exactly that when a handler threw, so
  // the watchdog is a second line of defence rather than a nicety. Generous,
  // because a session is meant to span several turns -- it is a stuck-mic
  // backstop, not an utterance timer.
  const MAX_MS = 180000;
  // Long enough for the reply to finish rendering, short enough to feel like a
  // conversation rather than a form.
  const REARM_MS = 350;

  function supported() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /** Is anything being said or streamed AT her right now? That is the one state
   *  whose audio must never become her next message. */
  function busy(s) {
    try { return !!s.opts.busy(); } catch { return false; }
  }

  function setLive(s, v) {
    s.on = v;
    s.btn.textContent = v ? LIVE : IDLE;
    s.btn.dataset.live = v ? 'true' : 'false';
    s.btn.title = v ? 'Stop listening' : 'Speak';
    s.btn.setAttribute('aria-pressed', String(v));
  }

  /** Dim the dot while a reply is streaming: the mic is open but nothing said
   *  into it will be kept, and a control that looks identical either way is how
   *  you end up talking into a bin. */
  function paint(s) {
    s.btn.dataset.drop = s.on && busy(s) ? 'true' : 'false';
  }

  function fill(s, text) {
    try { s.opts.fill(text); } catch { /* composer gone */ }
  }

  /** Tear the recognizer down completely.
   *
   * Handlers are detached first: an aborted instance still fires `end`, and a
   * corpse calling back into the restart path is how one dead recognizer turned
   * into a mic that no tap could revive. */
  function kill(s) {
    clearTimeout(s.timer);
    if (!s.rec) return;
    s.rec.onresult = null;
    s.rec.onend = null;
    s.rec.onerror = null;
    try { s.rec.abort(); } catch { /* already gone */ }
    s.rec = null;
  }

  /** End the session and put the prompt back, without sending. Every caller is
   *  a deliberate stop or a failure. */
  function stop(s) {
    s.mode = false;
    s.fails = 0;
    kill(s);
    setLive(s, false);
    paint(s);
  }

  function onResult(s, e) {
    try {
      // DROP whatever is heard while a reply is streaming (or being spoken).
      // The mic cannot be paused and resumed -- stop() needs no gesture but
      // start() does, so a pause would be one-way and the session could never
      // restart itself. So it stays open and the bytes go in the bin: the
      // results are marked consumed so they can never surface as part of the
      // next utterance, and the composer is left empty. Talking over the answer
      // costs nothing rather than sending half a sentence.
      if (busy(s)) {
        s.base = e.results.length;
        fill(s, '');
        paint(s);
        return;
      }
      let text = '';
      let done = false;
      // INDEX LOOP, not for...of. SpeechRecognitionResultList is array-LIKE in
      // Safari with no Symbol.iterator, so for...of threw TypeError here --
      // which killed the handler before it could fill the composer or call
      // stop(), leaving the recognizer running with its audio session hot. That
      // is what "it never sends" and "the whole page freezes" both were.
      for (let i = s.base; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (alt && alt.transcript) text += alt.transcript;
        if (res.isFinal) done = true;
      }
      fill(s, text.trim());
      // Sending happens HERE, not in onend: the recognizer is never stopped
      // between turns, so there is no end to hang it off.
      if (done) {
        s.base = e.results.length;
        if (text.trim()) { s.opts.send(); paint(s); }
      }
    } catch {
      // A throw in here once killed the handler before it could send or stop,
      // which is how the mic silently stopped working. Swallow it, mark what
      // arrived as consumed so it cannot resurface glued to the next utterance,
      // and let the session carry on -- one lost sentence beats a dead mic.
      try { s.base = e.results.length; } catch { /* nothing usable */ }
    }
  }

  /** Configure a fresh recognizer. CONTINUOUS is the whole fix for "it didn't
   *  re-arm": iOS refuses recognition.start() outside a user gesture, so
   *  re-opening the mic a few hundred ms after a reply -- nowhere near a tap --
   *  is simply denied. One gesture has to cover the whole session, so the
   *  recognizer is never stopped between turns: it stays open, the send happens
   *  on each final result, and the next thing said is the next result. */
  function build(s) {
    const Rec = supported();
    const rec = new Rec();
    rec.lang = navigator.language || 'en-US';
    // Interim results are what make it feel like dictation rather than a form:
    // the words appear while you are still saying them.
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => onResult(s, e);
    // NOTHING here is shown. `no-speech` after a pause, `audio-capture` when
    // iOS drops an idle audio session, `network` on a flaky connection -- these
    // are weather, not failures, and a red line in the transcript for each one
    // made a working session look broken. `end` follows every error, so the
    // restart path there is the single place that decides what happens next.
    // The one thing an error must not do is end a session she never ended.
    rec.onerror = () => {};
    // iOS ends a recognizer on silence even in continuous mode, so `end` is an
    // ordinary mid-session event rather than the end of one. A session ends
    // when it is tapped off, and not before. A FRESH recognizer every time:
    // restarting an ended instance is what Safari is least reliable about, and
    // a dead one still holding the audio session is how the mic stopped
    // answering any tap at all.
    rec.onend = () => {
      clearTimeout(s.timer);
      if (!s.mode) { setLive(s, false); return; }   // tapped off
      setTimeout(() => { if (s.mode) start(s); }, RETRY_MS);
    };
    return rec;
  }

  function start(s) {
    if (!supported()) return;
    kill(s);          // never two recognizers, never a corpse still wired up
    // Drop the keyboard if it is up. Voice mode does not need it, and on a
    // phone the keyboard is what shrinks the viewport and takes the nav bar
    // with it -- the whole screen reshuffles for an input nobody types into.
    if (s.opts.blur) { try { s.opts.blur(); } catch { /* nothing focused */ } }
    s.base = 0;
    s.rec = build(s);
    try {
      s.rec.start();
      s.fails = 0;
      setLive(s, true);
      clearTimeout(s.timer);
      s.timer = setTimeout(() => { try { s.rec.stop(); } catch { /* gone */ } }, MAX_MS);
    } catch {
      // Refused (no gesture, or one still winding down). Retry quietly; give up
      // silently rather than ever printing at her, and leave the prompt idle so
      // a tap is obviously the way back.
      setLive(s, false);
      if (s.mode && ++s.fails < MAX_FAILS) {
        setTimeout(() => { if (s.mode) start(s); }, RETRY_MS);
      } else {
        stop(s);
      }
    }
  }

  function toggle(s) {
    if (s.on && s.rec) {
      const r = s.rec;
      stop(s);
      try { r.abort(); } catch { /* gone */ }
      return;
    }
    s.mode = true;          // a tap opens a session, not one dictation
    start(s);
    paint(s);
  }

  /** The reply has finished. In a continuous session the recognizer never
   *  stopped and this only repaints; it is the fallback for a browser that ends
   *  recognition per utterance anyway. */
  function replyDone(s) {
    paint(s);
    if (!s.mode || s.on) return;
    setTimeout(() => { if (s.mode && !s.on) start(s); }, REARM_MS);
  }

  function active(s) { return s.mode || s.on; }

  /** One voice session bound to one composer.
   *
   * opts: { btn, fill(text), send(), busy(), blur() } -- `btn` is the prompt
   * element, `fill` puts what has been heard into the composer as if typed,
   * `send` sends it the way Enter would, `busy` is the drop-everything state
   * above, and `blur` drops the soft keyboard.
   *
   * `mode` is a voice SESSION, not a single dictation: tapping the prompt
   * starts a back-and-forth and the mic re-opens as soon as the reply is
   * finished. Scoped deliberately -- a turn you typed never opens the
   * microphone, because a page that starts listening on its own is a page you
   * have to remember to switch off.
   */
  function create(opts) {
    // `base` is the results already sent: with a continuous session e.results
    // KEEPS every result of the session, so without a floor each new utterance
    // would resend the whole conversation so far.
    const s = { btn: opts.btn, opts, rec: null, on: false, timer: 0, base: 0, fails: 0, mode: false };
    s.btn.classList.add('mic');
    setLive(s, false);
    s.btn.addEventListener('click', () => toggle(s));
    // Backgrounding the tab with the mic live leaves iOS holding the audio
    // session.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && active(s)) stop(s);
    });
    return {
      toggle: () => toggle(s),
      stop: () => stop(s),
      paint: () => paint(s),
      replyDone: () => replyDone(s),
      active: () => active(s),
    };
  }

  /** Bind the engine to a composer: a prompt to tap and a box to fill.
   *
   * Three surfaces wire this engine and two of them are exactly this shape, so
   * the shape lives here rather than three-quarters-identical in each binding.
   * The Exec panel builds its composer inside a closure, so it passes its own
   * fill/blur instead of ids; everything else is the same.
   *
   * `busy` is a LIST of predicates, OR'd. Every surface has at least two (a
   * reply still streaming, its own narrator speaking out of the speaker Wai is
   * holding), and a list of named reasons reads better than one long boolean.
   *
   * Returns null when the speech API is missing or the composer is not there:
   * the caller wires nothing and the prompt stays an ordinary `$`. A missing
   * API costs an affordance, never a dead control.
   */
  function bindComposer(o) {
    const el = (v) => (typeof v === 'string' ? document.getElementById(v) : v);
    const btn = el(o.btn);
    const input = el(o.input);
    if (!btn || !supported()) return null;
    if (!input && !(o.fill && o.blur)) return null;
    const busy = o.busy || [];
    const mic = create({
      btn: btn,
      busy: () => busy.some((f) => !!f()),
      send: o.send,
      fill: o.fill || function (text) {
        input.textContent = text;
        if (o.afterFill) o.afterFill();
      },
      blur: o.blur || function () {
        if (document.activeElement === input) input.blur();
      },
    });
    // A reply finished: repaint, and re-arm on a browser that ends recognition
    // per utterance.
    if (o.replyDoneOn && o.replyDoneEvent) {
      o.replyDoneOn.addEventListener(o.replyDoneEvent, () => mic.replyDone());
    }
    // The page stopped talking: the dot goes from dim (dropping what it hears)
    // back to lit.
    if (o.idleEvent) document.addEventListener(o.idleEvent, () => mic.paint());
    return mic;
  }

  return { supported, create, bindComposer };
})();
