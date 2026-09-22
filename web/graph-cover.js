/* /graph — the loading cover: the bar, the phase line, and the failure note.
 *
 * Split out of graph-overlay.js at the 500-line cap. Same global scope, loaded
 * before it (routes_graph._GRAPH_OVERLAY_JS decides the order), so this is one
 * file's worth of concern and not a module boundary: `gpCover` is the whole
 * surface, and graph-overlay.js owns everything that touches vis.
 *
 * It is the first thing on the page and the last thing to go, which is why it
 * is worth its own file: #graph sits at opacity 0 until `gp-loaded`, so until
 * this lifts, the cover IS the page.
 */
(function () {
  // Cover the graph while it loads, then reveal the whole fitted graph at once.
  // The bar tracks vis's real `stabilizationProgress` — the CSS keyframe it
  // replaced ran for a flat 3s and then sat full while the layout kept settling,
  // which is how a 20s cap came to lift the cover onto a blank canvas.
  //
  // The cover also REPORTS, because #graph is opacity 0 until `gp-loaded` and a
  // phone reported this page as a crash: tap GPH, nothing, then black — and then
  // the visuals arriving around three minutes later, which is a slow load
  // wearing a dead tab's clothes. There is no way to watch a phone from here, so
  // the cover names the phase it is in and counts the seconds. Whatever is slow,
  // it can be read off the screen it is slow on.
  var LOAD_CAP = 180000;     // hard failsafe — opacity 0 is forever without one
  var SLOW_AFTER = 20000;    // past here, say out loud that this is not normal

  // The cover is ADOPTED, not built: routes_graph serves it as the first markup
  // inside <body> (_GRAPH_BOOT) so it paints with the first chunk, where this
  // file runs only after ~2.2MB of vis bundle + RAW_NODES has parsed — which is
  // to say, after the entire wait the cover exists to explain. It is still
  // created here when absent, so the file stands alone against any page that
  // does not serve one.
  //
  // Until the first real number arrives the track keeps the .gp-indet marquee it
  // was served with, so the bar is MOVING from the first frame; the first
  // progress call (or reveal) switches it to the determinate fill.
  // What the two marks the payload leaves behind add up to. They are recorded BY
  // the payload, so a main thread blocked solid through the build still reports
  // the build honestly once it comes back — which a ticking clock cannot.
  function timings() {
    var start = window.__GP_PAYLOAD_START;
    var end = window.__GP_PAYLOAD_MS;
    if (!start) {
      return '';
    }
    var fetched = Math.round(start) / 1000;
    var out = ' · data ' + fetched.toFixed(1) + 's';
    if (end) {
      out += ' · build ' + ((end - start) / 1000).toFixed(1) + 's';
    }
    return out;
  }

  function showLoading() {
    var overlay = document.getElementById('gp-loading');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'gp-loading';
      overlay.innerHTML = '<div class="gp-load-track gp-indet">' +
        '<div class="gp-load-fill"></div></div>';
      document.body.appendChild(overlay);
    }
    var track = overlay.querySelector('.gp-load-track');
    var fill = overlay.querySelector('.gp-load-fill');
    var line = document.createElement('div');
    line.className = 'gp-load-phase';
    overlay.appendChild(line);
    var t0 = Date.now();
    var label = 'fetching graph data';
    var done = false;
    function paint() {
      var secs = Math.round((Date.now() - t0) / 1000);
      var split = timings();
      // Seconds only once there are some: a counter that opens at 0s makes a
      // fast load look like a stopwatch.
      line.textContent = label + (secs >= 3 ? ' — ' + secs + 's' : '') + split;
      if (!done && Date.now() - t0 > SLOW_AFTER) {
        line.textContent += ' (slower than usual)';
      }
    }
    var tick = setInterval(paint, 250);
    function determinate() {
      if (track) {
        track.classList.remove('gp-indet');
      }
    }
    return {
      phase: function (next) {
        label = next;
        paint();
      },
      elapsed: function () {
        return Date.now() - t0;
      },
      progress: function (frac) {
        determinate();
        fill.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
      },
      reveal: function () {
        if (done) {
          return;
        }
        done = true;
        clearInterval(tick);
        determinate();
        fill.style.width = '100%';
        overlay.classList.add('gp-hide');
        document.body.classList.add('gp-loaded');
        setTimeout(function () { overlay.remove(); }, 800);
      },
    };
  }

  // A page that cannot draw the graph must SAY so, not sit black. Whatever went
  // wrong, the cover is lifted (the nav is under it and a visitor needs a way
  // out) and the reason is printed where the bar was — which also turns an
  // unreproducible phone failure into one line someone can read back.
  function fail(why) {
    var note = document.createElement('div');
    note.className = 'gp-load-note';
    note.textContent = '[ ' + why + ' — reload to retry ]';
    var overlay = document.getElementById('gp-loading');
    if (overlay) {
      var track = overlay.querySelector('.gp-load-track');
      if (track) {
        track.remove();
      }
      overlay.appendChild(note);
      overlay.classList.remove('gp-hide');
    }
    document.body.classList.add('gp-loaded');
  }

  window.gpCover = {
    CAP: LOAD_CAP,
    show: showLoading,
    fail: fail,
  };
})();
