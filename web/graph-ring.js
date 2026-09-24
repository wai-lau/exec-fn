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
// ONLY THE BIG NODES DO THIS, on the same threshold that decides which nodes
// occlude their edges. That is deliberate rather than a reuse of a handy number: a
// wave says "something important happened here", and the threshold is the 90th
// percentile of the sizes, so nine nodes in ten are not that. Every node throwing
// one would be the whole picture pulsing at once, which says nothing about
// anywhere.
/* global graphGlyph, graphTempo, graphAudio */
var graphRing = (function () {
  'use strict';

  // WHAT COUNTS AS BIG IS THE SERVER'S ANSWER, shipped as
  // `window.GRAPH_OCCLUDE_MIN`: the percentile of the real size distribution that
  // graph_style computed while deciding which nodes occlude their edges. Three
  // layers gate on that one number — the unlit fill, the lit punch and this — and
  // they are one answer to "is this node one of the big ones". A second
  // implementation of the percentile here would be a second chance to disagree
  // about the node sitting exactly on the boundary, and a node that occludes but
  // throws no wave reads as a bug rather than as a rule.
  var MIN_R_FALLBACK = 20;
  var minR = MIN_R_FALLBACK;

  // ONE TRIANGLE, ALWAYS — not a copy of the node's own shape. The shape a node
  // wears carries its TYPE (up-triangle code, hexagon rationale, down-triangle
  // document), and a front is not a statement about a type: it says the music
  // landed here. Three different silhouettes sweeping outward said the wrong thing
  // three ways, and the upward triangle is what 74% of the graph wears anyway.
  var SHAPE = 'triangle';

  // How far the front travels, as a multiple of the node's own radius. At 50 the
  // largest node's front reaches on the order of twenty lattice steps, so it
  // crosses a good part of the picture rather than ringing its own neighbourhood
  // — which is what earns it being released only on a beat and only from a hub.
  var GROW = 50;

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

  // A node hit twice inside this keeps the wave it has instead of starting a
  // second one on top of it. Past it, waves DO stack -- a hub caught by three
  // cascades in a bar should read as three waves, which is the honest picture, and
  // concentric fronts are what that looks like.
  var MIN_GAP_MS = 260;
  // A safety bound, not a design input. A tenth of the graph can throw one, but a
  // cascade only lights a few dozen nodes and only the big ones among those throw,
  // so this is not reached in ordinary play — it is here so a pathological burst
  // cannot put a thousand stroked paths on one frame.
  var MAX_LIVE = 24;

  // STROKED, NEVER FILLED. A filled copy at GROW times the node's radius is a disc
  // the size of a neighbourhood, and a dozen of them would be the graph
  // disappearing under its own glow. An outline is a FRONT: it says where the wave
  // has reached, which is the whole of what it has to say.
  var A_RING = 0.55;
  var RING_W = 2.2;
  // The line THINS as it grows: a front spread over a longer circumference has the
  // same energy in more of it. Alongside the fade, this is what stops the largest,
  // faintest rings reading as hard geometry.
  var W_FALL = 0.6;

  // `pos` is graph-pulse.js's position map, handed over at index time so this file
  // can read a node's own radius without a second copy of the size rule.
  var pos = {};
  var waves = [], lastAt = {};
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

  // 0 with no audio, which leaves a front at its nominal GROW.
  function bloom() {
    return typeof graphAudio !== 'undefined' && graphAudio.isOn()
      ? graphAudio.bloom() : 0;
  }

  return {
    index: function (positions) {
      pos = positions;
      waves = [];
      lastAt = {};
      // Resolved here rather than at evaluation time: this file is a classic
      // script and the head injection has certainly run by the time the model
      // indexes, where module-evaluation order is a thing to get wrong.
      var v = window.GRAPH_OCCLUDE_MIN;
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
      if (lastAt[id] !== undefined && now - lastAt[id] < MIN_GAP_MS) {
        return;
      }
      lastAt[id] = now;
      waves.push({
        id: id, t0: now, dur: DUR_BASE + DUR_PER_R * p.r,
        grow: GROW * (1 + BLOOM_GROW * bloom()),
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
        ctx.lineWidth = RING_W * (1 - W_FALL * t);
        // ONE shape for every front, and the centre is taken at the NODE's shape
        // so the triangle starts exactly where the node's own glyph sits.
        graphGlyph.at(x, graphGlyph.centre(y, r, p.s), big, SHAPE);
        ctx.stroke();
      }
    },

    busy: function () { return waves.length > 0; },
    reset: function () { waves = []; lastAt = {}; },
  };
})();
