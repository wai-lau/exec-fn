// AudioWorklet that plays a queue of float32 PCM chunks (24 kHz mono) pushed
// from the main thread over the port. Underruns emit silence rather than
// glitching, so a slow stream just gaps instead of crashing playback.
//
// Port messages:
//   Float32Array  -> enqueue a PCM chunk
//   null          -> flush the queue (new utterance / cancel)
//   {gain: n}     -> set the client playback gain
class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._cur = null;
    this._pos = 0;
    this._gain = 1.0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === null) {
        this._queue.length = 0;
        this._cur = null;
        this._pos = 0;
      } else if (d instanceof Float32Array) {
        this._queue.push(d);
      } else if (d && typeof d.gain === "number") {
        this._gain = d.gain;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const g = this._gain;
    for (let i = 0; i < out.length; i++) {
      if (!this._cur || this._pos >= this._cur.length) {
        this._cur = this._queue.shift() || null;
        this._pos = 0;
      }
      out[i] = this._cur ? this._cur[this._pos++] * g : 0;
    }
    return true;
  }
}

registerProcessor("pcm-player", PCMPlayer);
