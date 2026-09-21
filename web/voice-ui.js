// The controls every speaking surface shares.
//
// /tarot's reader toggle and the Exec panel's mute button were two buttons with
// the same glyph, the same job and two state contracts (`data-on` against
// `data-muted`), and /cc was about to get a third. They are one element now,
// built here, wired to a narrator (voice-narrator.js) and styled by
// voice-ui.css — which is deliberately POSITION-FREE, the same split
// chat-msg.css makes: the look is shared, where it sits is the page's business.
//
// /tarot layers its own `.spread-btn` body and pulse on top of the same element
// and the same `data-on`, which is the point: one contract, three placements.
(function () {
  "use strict";

  /** The narrator on/off toggle, wired and ready to place.
   *
   * `data-on` is the state, and it is the narrator's real state — off means
   * nothing is synthesized and the page types at its own pace, not that the
   * volume went to zero. */
  function muteButton(narrator, opts) {
    const o = opts || {};
    const b = document.createElement("button");
    b.type = "button";
    b.className = "voice-mute" + (o.className ? " " + o.className : "");
    if (o.id) b.id = o.id;
    b.innerHTML = '[<span class="voice-glyph">&#10022;</span>]';

    function sync() {
      const on = narrator.isOn();
      b.dataset.on = on ? "true" : "false";
      b.title = on ? (o.offTitle || "Turn the voice off") : (o.onTitle || "Turn the voice on");
      b.setAttribute("aria-label", b.title);
      b.setAttribute("aria-pressed", String(on));
    }

    b.addEventListener("click", function () {
      narrator.setOn(!narrator.isOn());
      sync();
    });
    sync();
    // A persisted-on narrator has no gesture behind it after a reload; the first
    // tap anywhere is the one that unlocks audio (iOS rule).
    narrator.armUnlock();
    return b;
  }

  /** The clickable leading glyph on a spoken message: tap to hear it again.
   *
   * The click is a real user gesture, so it also unlocks audio the first time —
   * which makes it the one control that fixes its own silence. `>` for a reply,
   * `~` for a nudge or monitor comment, matching the gutter markers the chat
   * surfaces already draw in CSS (chat-msg.css hands the column to a real
   * element when one is present). */
  function replayMark(narrator, role, text) {
    const mk = document.createElement("span");
    mk.className = "msg-mark";
    mk.textContent = role === "probe" ? "~" : ">";
    mk.title = "replay voice";
    mk.addEventListener("click", function () { narrator.speak(text); });
    return mk;
  }

  window.VoiceUI = { muteButton, replayMark };
})();
