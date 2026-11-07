// "Tap to hear" — the one tap that takes the audio session, asked for only when
// a voice actually has something to say.
//
// Taking the session is not free on iOS: unlocking audio starts the silent
// loop that defeats the Ring/Silent switch (hosaka-audio.js), and that loop puts
// the page in the "playback" category, which stops whatever else is playing.
// The Exec voice used to unlock on the first tap ANYWHERE on a nav page, so
// opening the site paused Wai's music even with the voice off. Now nothing
// unlocks until Exec has a line to say; then this overlay asks for the tap,
// and the tap is the gesture iOS needs. "skip" drops the line and leaves the
// music alone.
//
// One overlay per page, built on first show, hidden (not removed) after — the
// Exec panel's click-outside test reads `#voice-gate` as inside the panel, so a
// tap here never closes it. Its stylesheet is loaded from here because the
// non-planning pages carry no voice CSS at all.
(function () {
  "use strict";

  let el = null;
  let label = null;
  let onGo = null;
  let onSkip = null;

  function ensure() {
    if (el) return el;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/voice-gate.css?v=1";
    document.head.appendChild(css);
    el = document.createElement("div");
    el.id = "voice-gate";
    el.hidden = true;
    el.innerHTML =
      '<button type="button" class="vg-go"></button>' +
      '<button type="button" class="vg-skip">skip</button>';
    label = el.querySelector(".vg-go");
    // The whole scrim is the target, not just the words: a phone in one hand
    // should not need to find a button.
    el.addEventListener("click", function (e) {
      const skip = e.target.closest(".vg-skip");
      const go = onGo;
      const drop = onSkip;
      hide();
      if (skip) { if (drop) drop(); } else if (go) go();
    });
    document.body.appendChild(el);
    return el;
  }

  /** Ask for the tap. `go` runs INSIDE the click (the iOS unlock rule);
   *  `skip` runs when she says no. A second show() while open just takes the
   *  newer callbacks — the narrator holds every waiting line itself. */
  function show(text, go, skip) {
    ensure();
    label.textContent = "[ " + text + " ]";
    onGo = go;
    onSkip = skip;
    el.hidden = false;
  }

  function hide() {
    if (el) el.hidden = true;
    onGo = null;
    onSkip = null;
  }

  window.VoiceGate = { show, hide };
})();
