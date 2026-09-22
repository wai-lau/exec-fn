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
    if (window.__GP_PLACE_MS) {
      out += ' · place ' + (window.__GP_PLACE_MS / 1000).toFixed(1) + 's';
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
    // Paint once now, not on the first tick: the line is created empty and the
    // interval is 250ms away, which is a quarter second of blank under the bar.
    paint();
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
      // Back to the marquee. Used for the BUILD, where there is no fraction to
      // report and — the part that decides it — no main thread to report one
      // with: the payload executes in one synchronous block, so a JS-driven
      // width freezes where it stood, while a CSS transform keeps moving on the
      // compositor. A frozen bar reads as a hung page; a moving one is the truth
      // (working, duration unknown).
      // The build: hold the width the download earned, and breathe instead of
      // sliding. The marquee below is for the phase BEFORE there is a position
      // to hold.
      building: function (on) {
        if (track) {
          track.classList[on ? 'add' : 'remove']('gp-build');
        }
      },
      indeterminate: function () {
        // Clearing the inline width is half the switch, not tidying: the
        // marquee's 35% segment lives in the stylesheet, and an inline
        // width:100% left over from the download beats it — the bar then slides
        // full-width across the track, which reads as a bar that finished and
        // then started moving.
        fill.style.width = '';
        if (track) {
          track.classList.add('gp-indet');
        }
      },
      reveal: function () {
        if (done) {
          return;
        }
        done = true;
        clearInterval(tick);
        determinate();
        if (track) {
          track.classList.remove('gp-build');
        }
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

  // ── the payload, fetched here so the bar can track bytes ──────────────────
  //
  // The page hands us a URL (window.GRAPH_BOOT_URL) instead of a <script defer
  // src>, because a script tag reports nothing until it is finished: the bar
  // could only guess. A streamed fetch gives a real fraction for the one phase
  // that has one, and on a phone the download is exactly the phase worth
  // watching.
  //
  // The bytes are handed back to the browser as a Blob <script src> rather than
  // eval'd: same global scope as the inline block it replaced (the payload's
  // top-level `const RAW_NODES` / `network` have to stay reachable from
  // graph-overlay.js), and the browser still compiles it on its own path.
  // Last resort. The page carries no <script src> for the payload any more, so
  // every way of not getting one ends in a page with no graph — and the fetch
  // path has more ways to fail on a real phone than it does in a headless
  // browser here. If the payload has not RUN a while after we handed it over,
  // hand it to the browser the ordinary way instead. Idempotent: the payload is
  // immutable-cached, so the second request is a cache hit, and it re-runs
  // nothing if the first copy did execute.
  var RESCUE_MS = 25000;
  var rescued = false;

  function rescue(url) {
    if (rescued || window.__GP_PAYLOAD_MS) {
      return;
    }
    rescued = true;
    var el = document.createElement('script');
    el.src = url;
    document.head.appendChild(el);
  }

  function inject(url, revoke, ondone) {
    var el = document.createElement('script');
    el.src = url;
    // Dynamically inserted scripts are async by default; ordering against the
    // deferred vis bundle is handled by waiting for DOMContentLoaded below, but
    // this keeps insertion order among anything we add later.
    el.async = false;
    el.onload = function () {
      if (revoke) {
        URL.revokeObjectURL(url);
      }
      if (ondone) {
        ondone();
      }
    };
    el.onerror = function () {
      rescue(window.GRAPH_BOOT_URL);
    };
    document.head.appendChild(el);
  }

  // vis-network is a DEFERRED script, so it has not run during parsing and the
  // payload would throw on `vis.Network`. Every deferred script has run by
  // DOMContentLoaded, which is therefore the earliest safe moment.
  function whenParsed(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  // What the bar is a fraction OF. Bytes alone cannot answer that: measured in
  // WebKit against this payload, the reader returns all 2,204,421 of them in ONE
  // chunk, so a byte bar fires once, at 100%, and correlates with nothing. The
  // download only reports progressively on a link slow enough to split it —
  // which is exactly the phone this is for, and exactly not the loopback it gets
  // tested on, so it cannot be the whole story either.
  //
  // So the bar is a fraction of the WORK, cut by what each phase actually costs
  // (measured here: data ~1.4s, build ~1.1s, draw the remainder), and every step
  // in it is a real thing finishing. Inside a phase it tracks bytes where the
  // stream gives them and runs the marquee where it cannot — which is also the
  // truth, since the build blocks the main thread solid and no JS-driven bar can
  // move through it at all.
  // Re-weighted once the lite payload landed: a phone downloads ~30KB gzipped
  // and builds 600 nodes, so both finish almost at once — the bar hit 90% in a
  // blink and then sat there, which is what "fills immediately, then pauses"
  // was. The pause is AFTER the build, and measuring it corrected the first
  // guess: the lattice snap, suspected of being the long pole, measures 0.0s.
  // What is actually in that gap is vis's first full draw at the new camera
  // (every node, edge and label) and the pulse indexing the graph. So the last
  // 40% is cut across those, and each step is still a real thing finishing.
  var FETCHED = 0.35;    // payload downloaded
  var BUILT = 0.6;       // payload executed: DataSets + network constructed
  var PLACED = 0.75;     // snapped onto the lattice, camera set
  var DRAWN = 0.9;       // vis has painted the graph at that camera

  function loadPayload(cover, url) {
    window.__GP_BOOT_STARTED = 1;
    var run = function (src, revoke) {
      whenParsed(function () {
        cover.progress(FETCHED);
        cover.phase('building the graph');
        cover.building(true);
        // onload fires AFTER the script has executed, so it is the one honest
        // marker for "the build is over" available from out here.
        // Keeps BREATHING and keeps the phase: what follows is the snap, which
        // blocks just as hard as the build did, and graph-overlay.js owns the
        // phase text from here (it is the one that knows which step it is in).
        inject(src, revoke, function () {
          cover.progress(BUILT);
        });
      });
    };
    var plain = function () { run(url, false); };
    if (!window.fetch || !window.ReadableStream || !window.URL || !URL.createObjectURL) {
      return plain();
    }
    fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok || !res.body) {
        throw new Error('boot ' + res.status);
      }
      // See the route: Content-Length is the GZIPPED size, the reader yields
      // decoded bytes, so the real length rides in its own header.
      var total = +(res.headers.get('x-payload-bytes') || 0);
      var reader = res.body.getReader();
      var chunks = [];
      var got = 0;
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            return chunks;
          }
          chunks.push(r.value);
          got += r.value.length;
          if (total) {
            cover.progress(FETCHED * (got / total));
          }
          return pump();
        });
      })();
    }).then(function (chunks) {
      var blob = new Blob(chunks, { type: 'application/javascript' });
      run(URL.createObjectURL(blob), true);
    })['catch'](function () {
      // A failed stream must not cost the page the graph — hand it back to the
      // browser the ordinary way and lose only the progress.
      plain();
    });
  }

  // One controller, created as soon as this file is parsed. graph-overlay.js is
  // deferred and calls show() much later; the bar has to be live before then,
  // since the download it reports on starts here.
  var shared = document.getElementById('gp-loading') ? showLoading() : null;

  if (shared && window.GRAPH_BOOT_URL) {
    loadPayload(shared, window.GRAPH_BOOT_URL);
    setTimeout(function () { rescue(window.GRAPH_BOOT_URL); }, RESCUE_MS);
  }

  window.gpCover = {
    CAP: LOAD_CAP,
    // The two milestones graph-overlay.js owns: it is the file that knows when
    // the camera is set and when vis has painted at it.
    PLACED: PLACED,
    DRAWN: DRAWN,
    show: function () {
      if (!shared) {
        shared = showLoading();
      }
      return shared;
    },
    fail: fail,
  };
})();
