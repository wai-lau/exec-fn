// Shared presence socket for the hosaka voice pages (/hosaka + /tarot).
//
// A dedicated WebSocket, separate from the audio /ws/hosaka (which only opens
// on Speak): the server holds every open presence socket and broadcasts
// {count} -- the TOTAL, including this page's own socket -- on each join/leave.
// Every page that speaks through hosaka holds one, so /tarot readers count as
// people on the voice backend even though /tarot renders no count itself.
//
// The count a page DISPLAYS is "other people", so the render callback gets
// count - 1 (this socket). Reconnects with a capped backoff if it drops.
window.HosakaPresence = (function () {
  "use strict";

  function mount(onOthers) {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    let retry = 0;
    const connect = () => {
      const ws = new WebSocket(`${scheme}://${location.host}/ws/hosaka/presence`);
      ws.onopen = () => { retry = 0; };
      ws.onmessage = (e) => {
        if (!onOthers) return;
        try {
          // Subtract our own socket -- never below 0 if a stale broadcast
          // lands before the server has counted this join.
          onOthers(Math.max(0, JSON.parse(e.data).count - 1));
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        // Keep the last count on screen (never blank) so the line holds its
        // height -- reconnect quietly in the background.
        retry = Math.min(retry + 1, 6);
        setTimeout(connect, retry * 1000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
  }

  return { mount };
})();
