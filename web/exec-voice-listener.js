// Exec voice on the non-planning pages — the ones with the link-bubble (no chat
// panel). Loads the same glados HosakaAudio player as the planning panel and
// speaks Exec's UNSOLICITED turns — monitor comments + timed nudges — that
// arrive on the /api/monitor/stream SSE channel, so a nudge narrates on
// whatever page Wai is on, not only /rd + /hq. There is no chat here,
// so assistant replies don't apply. Mute is the same global localStorage flag
// (`exec.voice`) the planning panel's button toggles.
(function () {
  "use strict";
  if (!window.execVoice) return; // TTS scripts didn't load

  // Persisted-on but no gesture yet -> unlock on the first tap/keypress so a
  // nudge narrates without needing the chat panel (iOS audio-unlock rule).
  execVoice.armUnlock();

  // Same SSE channel the exec bubble subscribes to; we only voice the comments
  // (the {thinking} pings drive the panel's typing dots, which don't exist here).
  function connect() {
    var src = new EventSource("/api/monitor/stream");
    src.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.comment) execVoice.speak(data.comment);
      } catch (_) {
        /* ignore malformed frame */
      }
    };
    src.onerror = function () {
      src.close();
      setTimeout(connect, 5000);
    };
  }
  connect();
})();
