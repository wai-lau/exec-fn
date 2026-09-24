// /graph — THE WAVEFRONT. A big node, when it lights on the beat, sends out ONE
// growing triangle that fades as it reaches the rim of its travel. Loaded before
// graph-pulse.js; drawn where graph-pulse-draw.js says.
//
// THIS FILE OWNS THE EFFECT END TO END — the register, the envelopes AND its own
// pixels — which is deliberately NOT the split graph-lit.js and graph-glow.js use.
// Those are models a draw half reads because SEVERAL passes consume each of them:
// the flash feeds a white pass, a saturated pass, halos, strokes and the punch.
// A wave feeds one stroked path and nothing else, so there is no reuse to protect
// and separating the two would only put one effect in two files.
//
// graph-pulse-draw.js still owns WHEN it draws, which is the thing that genuinely
// is shared: paint ORDER on that canvas is a single global decision.
//
// Three effects, and the division between them is by TIMESCALE and MEANING rather
// than by convenience:
//
//   graph-lit.js    the FLASH  -- a couple of seconds, on the node itself
//   graph-glow.js   the CHARGE -- how opaque a node has become over a track
//   graph-ring.js   the WAVE   -- what a big node throws OFF itself, once
//
// TWO GATES, and they are about different things. ONLY BIG NODES throw a wave
// (WHERE), and only ON THE BEAT (WHEN). A cascade lights its seeds on the grid and
// then walks outward at sixteenth-note hops, so without the second gate a hub
// caught mid-bar threw a front that had nothing to do with anything audible — the
// effect read as random where it is meant to read as the music landing.
//
// ONLY THE BIGGEST NODES DO THIS, on a HIGHER cut than the one that decides which
// nodes occlude their edges. That is deliberate rather than a reuse of a handy number: a
// wave says "something important happened here", and the threshold is a
// percentile of the sizes (`_OCCLUDE_PCTL`, the top fifth as of 2026-09-24), so
// most nodes are not that. Every node throwing one would be the whole picture
// pulsing at once, which says nothing about anywhere.
/* global graphGlyph, graphTempo, graphAudio */
var graphRing = (function () {
  'use strict';

  // WHAT COUNTS AS BIG ENOUGH TO THROW IS THE SERVER'S ANSWER, shipped as
  // `window.GRAPH_WAVE_MIN` — a HIGHER cut than `GRAPH_OCCLUDE_MIN`, and
  // deliberately its own number. The two were one for a while and came apart
  // because they answer different questions about the same distribution: being
  // SOLID is "big enough that an edge should stop here" (the top fifth), where
  // throwing a front is an EVENT, and at 300x one of them fills the screen (the
  // top tenth).
  //
  // Read, never recomputed. A percentile derived again here would be a second
  // chance to disagree with the server about the node sitting exactly on the
  // boundary. Falls back to the occlusion cut, then to a literal, so a missing
  // global degrades to "too many waves" rather than to none.
  var MIN_R_FALLBACK = 20;
  var minR = MIN_R_FALLBACK;

  // ONE TRIANGLE, ALWAYS — not a copy of the node's own shape. The shape a node
  // wears carries its TYPE (up-triangle code, hexagon rationale, down-triangle
  // document), and a front is not a statement about a type: it says the music
  // landed here. Three different silhouettes sweeping outward said the wrong thing
  // three ways, and the upward triangle is what 74% of the graph wears anyway.
  var SHAPE = 'triangle';

  // How far the front travels, as a multiple of the node's own radius. At 300 the
  // largest node's front passes well off every edge of the screen before it is
  // spent, so the effect is the triangle sweeping THROUGH the view rather than
  // expanding inside it. Only affordable because the gates below make it rare:
  // one per beat, from a hub.
  var GROW = 300;

  // THE STROKE SCALES WITH THE SHAPE, STRICTLY PROPORTIONALLY, and that is the
  // whole of what makes this read as ZOOMING IN on the triangle rather than as a
  // ring expanding away from a node. Scaling a stroked shape scales its stroke
  // too; a constant width, or one that thins as it grows, is the giveaway that the
  // thing is being redrawn larger rather than approached.
  //
  // `W_AT_NODE` is therefore NOT a free constant: it is `nodeStroke`'s own
  // lineWidth in graph-pulse-draw.js, so at scale 1 the front IS the node's
  // outline and every frame after is that same outline, nearer. Move the two
  // together or the illusion breaks at the instant it starts.
  //
  // It ends very wide by construction — 1.4px out to 420px at GROW 300 — and that
  // width is the zoom, not a bug. The alpha reaches nothing over the same span, so
  // the last stretch is a wide faint wash rather than a heavy band.
  var W_AT_NODE = 1.4;

  // THE KICK'S PULSE LIVES HERE NOW. It used to swell the halo on every lit node
  // (graph-pulse-draw.js's old HALO_SWELL), which made the whole picture throb in
  // place and said nothing about WHERE anything happened. On a front it says
  // something: a hard low hit throws further.
  //
  // `bloom` is amp x (1 - sharpness) -- loud AND bass-weighted, the part of music
  // you feel rather than hear -- and it is captured ONCE, at release, not read per
  // frame. A front is a one-shot event and should carry the moment it left on,
  // where a per-frame read would have every live front resize together on the next
  // kick, which is a graph breathing rather than a set of waves travelling.
  //
  // 0 with nothing listening, so ambient fronts are exactly GROW.
  var BLOOM_GROW = 0.6;           // extent: up to 1.6x on a full low hit

  // A NODE SNAPS ROUND THE INSTANT BEFORE IT THROWS. A quarter, a half or three
  // quarters of a turn, drawn at random — never 0, because the point is that the
  // glyph visibly MOVES on the frame it fires, and never a small angle, because a
  // few degrees on a triangle reads as a rendering wobble rather than as an event.
  //
  // It is written onto the node's own position record (`pos[id].t`), so every pass
  // that draws that glyph picks it up — halo centre, outline, the interior clear
  // and the punch — and the front is drawn at the same angle, so the wave leaves
  // the shape it came from already aligned with it.
  //
  // The rotation PERSISTS after the wave dies. It is a rotation of the node, not an
  // animation on it, and re-rolling on the next wave is what keeps a hub from
  // looking like it is vibrating in place.
  var TURNS = [Math.PI / 2, Math.PI, 3 * Math.PI / 2];

  // A BIGGER NODE THROWS A SLOWER WAVE. Same argument as degree buying flash time:
  // the wave is proportionally larger, so at a fixed duration it would also be
  // proportionally faster, and the biggest hubs would snap outward while the
  // smallest of the big nodes drifted. Scaling the clock with the radius keeps the
  // apparent speed roughly even and leaves the SIZE as what differs.
  var DUR_BASE = 1600;
  var DUR_PER_R = 12;             // r 20 -> 1840ms, r 88 -> 2656ms

  // Growth is LINEAR in time (exponent 1), and at this GROW that is a deliberate
  // choice rather than the absence of one. An ease-out is what a physical shock
  // does, but the easing compounds against the range: at 0.75 and 50x the front is
  // already past eighteen times the node a QUARTER of the way through its life,
  // so almost all the travel happens in the first few hundred milliseconds and the
  // rest is a huge faint triangle creeping. Linear spends the whole duration
  // actually travelling, which is what reads as a sweep.
  //
  // Raise it above 1 for ease-IN (slow out of the node, accelerating away) or drop
  // it below for ease-out; the constant is here to be turned, and nothing in this
  // file depends on its value.
  var GROW_EASE = 1;
  // And it FADES AS IT GETS THERE, reaching nothing exactly at full extent. Near
  // linear for the same reason: the fade is the whole of what makes this read as
  // spreading out rather than as a shape being scaled up in place.
  var FADE_POW = 1.1;

  // ON THE BEAT, and nowhere else. `graphTempo.onBeat` is 1 exactly on a grid
  // point and 0 exactly between two, squared on the way out so it discriminates
  // rather than sloping. At 0.6 a front releases inside roughly the middle fifth
  // of a beat, which is tight enough that the rings read as the pulse and loose
  // enough to survive the phase lock being a few tens of milliseconds out.
  //
  // IT IS 1 WITH NO LOCK, deliberately and not by accident — graph-tempo.js
  // returns 1 whenever it has no tempo, because raw onset firing is on the beat by
  // construction and an unlocked reading must not be a penalty. So with the audio
  // off this gate is open and the ambient animation throws fronts exactly as it
  // would have, which is the rule every audio term on this page follows: neutral
  // when nothing is listening.
  var ON_BEAT_MIN = 0.6;

  // ONE FRONT PER BEAT, ACROSS THE WHOLE GRAPH — a global gate, not a per-node
  // one. A beat lights several seeds at once and more than one of them can be a
  // hub, so the old per-node rule let a single beat throw several fronts and the
  // accent became a strobe. At 300x especially, one is the whole point.
  //
  // The gap is HALF a beat, not a whole one: the on-beat window is about a fifth of
  // a beat wide (ON_BEAT_MIN below), so half a period is comfortably past the end
  // of the current window and short of the next, where a full-period gap would
  // swallow the following beat whenever the phase lock ran a few ms late.
  var BEAT_GAP = 0.5;
  // With no tempo there is no beat to be one-per, so this is the floor that stops
  // the ambient animation stroking a 300x triangle on every hit.
  var BEAT_FALLBACK_MS = 420;
  // A safety bound, not a design input, and since the one-per-beat gate it is a
  // long way from binding: at 120bpm with a ~2.6s life only about five fronts are
  // ever in flight. It is here so a pathological case cannot put a thousand
  // stroked 300x paths on a single frame.
  var MAX_LIVE = 24;

  // STROKED, NEVER FILLED. A filled copy at GROW times the node's radius is a disc
  // the size of a neighbourhood, and a dozen of them would be the graph
  // disappearing under its own glow. An outline is a FRONT: it says where the wave
  // has reached, which is the whole of what it has to say.
  var A_RING = 0.55;

  // `pos` is graph-pulse.js's position map, handed over at index time so this file
  // can read a node's own radius without a second copy of the size rule.
  var pos = {};
  var waves = [], lastRelease = -1e9;
  // The canvas, handed over once by graph-pulse-draw.js — which owns the context,
  // the camera and the paint order, and calls `draw` at the point in that order
  // where a wavefront belongs.
  var ctx = null, ink = '#ffffff';

  // Guarded like every other cross-file read on this page: the tree is edited
  // live, so a file can reach a browser a moment before its dependency's script
  // tag does. With no tempo module at all the gate is open, which is the same
  // answer graph-tempo.js gives for having no lock.
  function onBeat(now) {
    return typeof graphTempo !== 'undefined' ? graphTempo.onBeat(now) : 1;
  }

  // Half a beat in milliseconds. `hopMs` is a SIXTEENTH (period / 4), which is the
  // only public window onto the period, so a beat is four of them — and it returns
  // 0 with no lock, which is what selects the fallback.
  function beatGap() {
    var hop = typeof graphTempo !== 'undefined' ? graphTempo.hopMs() : 0;
    return hop > 0 ? hop * 4 * BEAT_GAP : BEAT_FALLBACK_MS;
  }

  // 0 with no audio, which leaves a front at its nominal GROW.
  function bloom() {
    return typeof graphAudio !== 'undefined' && graphAudio.isOn()
      ? graphAudio.bloom() : 0;
  }

  return {
    index: function (positions) {
      pos = positions;
      waves = [];
      lastRelease = -1e9;
      // Resolved here rather than at evaluation time: this file is a classic
      // script and the head injection has certainly run by the time the model
      // indexes, where module-evaluation order is a thing to get wrong.
      var v = window.GRAPH_WAVE_MIN;
      if (typeof v !== 'number' || !(v > 0)) {
        v = window.GRAPH_OCCLUDE_MIN;
      }
      minR = typeof v === 'number' && v > 0 ? v : MIN_R_FALLBACK;
    },

    // Called from graph-lit.js's `fire`, through the same guarded shim it uses for
    // graph-glow.js — so there is ONE place a node hit is announced, rather than
    // three call sites in graph-pulse.js to keep in step.
    fire: function (id, now) {
      var p = pos[id];
      if (!p || p.r <= minR) {
        return;                   // not one of the big ones
      }
      if (onBeat(now) < ON_BEAT_MIN) {
        return;                   // not on the beat
      }
      if (now - lastRelease < beatGap()) {
        return;                   // this beat has already thrown one
      }
      lastRelease = now;
      // The node turns FIRST, on this frame, before the front it is about to throw
      // is ever drawn. Written onto the shared position record so every pass that
      // draws this glyph agrees about which way it is facing.
      var turn = TURNS[Math.floor(Math.random() * TURNS.length)];
      p.t = turn;
      waves.push({
        id: id, t0: now, dur: DUR_BASE + DUR_PER_R * p.r,
        grow: GROW * (1 + BLOOM_GROW * bloom()),
        turn: turn,
      });
      if (waves.length > MAX_LIVE) {
        waves.shift();
      }
    },

    // Compacted IN PLACE rather than through a filter, so the array identity never
    // changes while a frame is walking it.
    expire: function (now) {
      var keep = 0;
      for (var i = 0; i < waves.length; i++) {
        if (now - waves[i].t0 < waves[i].dur) {
          waves[keep++] = waves[i];
        }
      }
      waves.length = keep;
    },

    live: function () { return waves; },

    // 0 at the node, 1 at full extent.
    phase: function (w, now) { return (now - w.t0) / w.dur; },
    // Per WAVE, because each carries the extent it was released with.
    scale: function (w, t) {
      return 1 + ((w.grow || GROW) - 1) * Math.pow(t, GROW_EASE);
    },
    fade: function (t) { return Math.pow(1 - t, FADE_POW); },

    bind: function (context, fallbackInk) {
      ctx = context;
      ink = fallbackInk || ink;
    },

    // ONE FRAME of fronts. The camera arrives per call rather than being stored:
    // the layout is frozen but the view is not, so scale and position are
    // recomputed every frame by the file that owns them.
    draw: function (now, scale, view, w, h) {
      if (!ctx) {
        return;
      }
      // ONLY WHERE THE CANVAS ALREADY HAS SOMETHING. See graph-pulse-draw.js's
      // call site for why this is `source-atop` rather than a blend mode.
      ctx.globalCompositeOperation = 'source-atop';
      for (var i = 0; i < waves.length; i++) {
        var wave = waves[i];
        var p = pos[wave.id];
        if (!p) {
          continue;
        }
        var t = (now - wave.t0) / wave.dur;
        if (t < 0 || t >= 1) {
          continue;
        }
        var a = Math.pow(1 - t, FADE_POW);
        if (a <= 0.01) {
          continue;
        }
        var r = Math.max(p.r * scale, 1.2);
        var big = r * (1 + ((wave.grow || GROW) - 1) * Math.pow(t, GROW_EASE));
        var x = (p.x - view.x) * scale + w / 2;
        var y = (p.y - view.y) * scale + h / 2;
        // Culled against the GROWN radius, not the node's: a wave thrown by a node
        // just past the edge still sweeps into view.
        if (x + big < -40 || y + big < -40 || x - big > w + 40 || y - big > h + 40) {
          continue;
        }
        // The centre is taken at the node's OWN radius and held while the radius
        // grows, so the front expands concentrically instead of walking off the
        // node that threw it. That is the whole reason graphGlyph.at exists.
        ctx.strokeStyle = p.c || ink;
        ctx.globalAlpha = a * A_RING;
        // Linear in the front's own size, so the triangle scales stroke and all.
        ctx.lineWidth = W_AT_NODE * (big / Math.max(r, 0.001));
        // ONE shape for every front, at the angle the node snapped to as it fired,
        // and the centre is taken at the NODE's shape so the triangle leaves from
        // exactly where its own glyph sits.
        graphGlyph.at(x, graphGlyph.centre(y, r, p.s), big, SHAPE, wave.turn);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
    },

    busy: function () { return waves.length > 0; },
    reset: function () { waves = []; lastRelease = -1e9; },
  };
})();
