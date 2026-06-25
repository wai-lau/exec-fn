// /tarot ambient background music. A looping <audio> element streamed lazily:
// preload="none" means nothing is fetched until play(), so it adds ZERO to page
// load -- the browser then streams the file progressively as it plays. Fully
// independent of the WebAudio TTS pipeline (hosaka-audio.js); the two mix at the
// OS level.
//
// VOLUME: the 15% bed level is BAKED INTO THE FILE (re-encoded at 0.15 gain).
// iOS makes HTMLMediaElement.volume read-only (el.volume is a no-op) AND silences
// any element routed through a WebAudio MediaElementSource -- so neither JS path
// can attenuate the bed on iPhone. Baking it into the file is the only thing that
// gives a quiet bed on BOTH desktop and iOS with a plain, reliably-playing
// <audio>. el.volume is then used ONLY for the desktop fade-in (0 -> 1); iOS
// ignores it and simply starts at the file's level.
const TAROT_MUSIC_SRC = "/tarot-ambient.m4a?v=3"; // re-encoded at 15% (see above)
const LS_MUSIC = "tarot.music"; // "0" = user stopped it; default on
const FADE_MS = 4000; // first-start fade-in duration (desktop only)

const tarotMusic = (() => {
  let el = null;
  let btn = null;
  let silentEl = null; // iOS Ring/Silent-switch defeat (see enablePlaybackSession)
  let faded = false; // first-start fade-in has run
  let on = localStorage.getItem(LS_MUSIC) !== "0";

  // iOS mutes a plain <audio> under the hardware Ring/Silent switch. Looping a
  // silent HTMLMediaElement (started in a gesture) moves the page audio session
  // to the "playback" category, which the switch does NOT mute -- so the music
  // is then audible even in silent mode. Must be kept looping so the session
  // stays in that category. Same trick hosaka-audio.js uses for the TTS path.
  function enablePlaybackSession() {
    if (!silentEl) {
      silentEl = document.createElement("audio");
      silentEl.src = "/silence.wav?v=1";
      silentEl.loop = true;
      silentEl.playsInline = true;
      silentEl.setAttribute("playsinline", "");
    }
    silentEl.play().catch(() => {
      /* no gesture yet -- retried on the gesture that starts the music */
    });
  }

  function ensureEl() {
    if (el) return el;
    el = document.createElement("audio");
    el.src = TAROT_MUSIC_SRC;
    el.loop = true;
    el.preload = "none"; // lazy: no fetch until play() -> no page-load cost
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.volume = 0; // fade up to 1 in fadeIn() (desktop); iOS ignores el.volume
    // Drop the playhead to a random point once duration is known (range request,
    // not a full download). Looping then continues from there around the track.
    el.addEventListener(
      "loadedmetadata",
      () => {
        const d = el.duration;
        if (isFinite(d) && d > 0) {
          try {
            el.currentTime = Math.random() * d;
          } catch {
            /* seek unsupported -- start from 0 */
          }
        }
      },
      { once: true },
    );
    return el;
  }

  // Ramp el.volume 0 -> 1 over FADE_MS on first start (the file already carries
  // the 15% level). Desktop only -- iOS ignores el.volume and starts at 15%.
  function fadeIn() {
    if (faded) {
      el.volume = 1;
      return;
    }
    faded = true;
    const start = performance.now();
    function step(now) {
      if (!on) return; // user stopped mid-fade
      const t = Math.min(1, (now - start) / FADE_MS);
      el.volume = t;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function startPlayback() {
    enablePlaybackSession(); // in-gesture -> play through the iOS Ring/Silent switch
    return ensureEl()
      .play()
      .then(() => fadeIn());
  }

  // Start (and fade in) on the first user tap/keypress. Autoplay of audible
  // media is gated on a gesture anyway, and the fade must only begin after the
  // user taps -- so arm a one-shot gesture rather than playing on load.
  function arm() {
    if (!on) return;
    function go() {
      document.removeEventListener("pointerdown", go, true);
      document.removeEventListener("keydown", go, true);
      if (on) startPlayback().catch(() => {});
    }
    document.addEventListener("pointerdown", go, true);
    document.addEventListener("keydown", go, true);
  }

  // Toggle-on is itself a tap, so start immediately; fall back to arm() if the
  // browser still refuses (e.g. the click wasn't counted as activation).
  function play() {
    if (!on) return;
    startPlayback().catch(() => arm());
  }

  function stop() {
    if (el) el.pause();
  }

  function setOn(v) {
    on = v;
    localStorage.setItem(LS_MUSIC, v ? "1" : "0");
    if (btn) {
      btn.dataset.on = v ? "true" : "false";
      btn.setAttribute("aria-pressed", String(v));
    }
    if (v) play();
    else stop();
  }

  // Stop button, below the reset button in the controls column (reset is the
  // column's only child in the HTML, so appendChild lands this beneath it).
  function mount() {
    const controls = document.getElementById("spread-controls");
    if (!controls) return;
    btn = document.createElement("button");
    btn.className = "spread-btn music-btn";
    btn.id = "music-btn";
    btn.title = "Ambient music";
    btn.setAttribute("aria-label", "Toggle ambient music");
    btn.setAttribute("aria-pressed", String(on));
    btn.dataset.on = on ? "true" : "false";
    btn.innerHTML = '[<span class="music-glyph">&#9834;</span>]'; // eighth note
    btn.addEventListener("click", () => setOn(!on));
    controls.appendChild(btn);
  }

  return { play, stop, setOn, mount, arm };
})();

tarotMusic.mount();
tarotMusic.arm(); // start + fade on the first user tap
window.tarotMusic = tarotMusic;
