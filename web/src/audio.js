// Mic capture, resampling, and the pre-roll ring buffer.
//
// The engine runs "warm": the mic stays open while idle and a rolling
// PRE_ROLL_SEC of 16 kHz Int16 audio is kept, so words spoken slightly before
// the hotkey still make it into the take (upstream's key behaviour). While
// recording, every chunk is also handed to `onChunk` for streaming.

import { PRE_ROLL_SEC, TARGET_SAMPLE_RATE } from "./tokens.js";

const PRE_ROLL_SAMPLES = Math.round(PRE_ROLL_SEC * TARGET_SAMPLE_RATE);

/** General-ratio linear-interpolation resampler. Carries fractional position
 * across chunks so long takes do not drift. Never assume the context rate. */
class Resampler {
  constructor(fromRate, toRate) {
    this.ratio = fromRate / toRate;
    this.pos = 0;        // fractional read position into the stream
    this.prev = 0;       // last sample of the previous chunk
    this.hasPrev = false;
  }

  /** Float32 [-1,1] at fromRate -> Int16Array at toRate */
  process(input) {
    const out = [];
    let pos = this.pos;
    while (pos < input.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === -1 ? this.prev : input[i];
      const b = i + 1 < input.length ? input[i + 1] : input[input.length - 1];
      const s = a + (b - a) * frac;
      const clamped = Math.max(-1, Math.min(1, s));
      out.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      pos += this.ratio;
    }
    this.pos = pos - input.length; // usually in [0, ratio)
    this.prev = input[input.length - 1];
    this.hasPrev = true;
    return Int16Array.from(out);
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.resampler = null;
    this.running = false;
    this.recording = false;
    this.recordedSamples = 0;
    this.level = 0; // RMS 0..1, decays while silent
    this.ring = new Int16Array(PRE_ROLL_SAMPLES);
    this.ringLen = 0;
    this.ringPos = 0;
    /** called with Int16Array chunks while recording (first call = pre-roll) */
    this.onChunk = null;
    /** called when the input dies (device unplugged) and a rebuild starts */
    this.onDeviceChange = null;
    this._visHandler = () => this._onVisibility();
    document.addEventListener("visibilitychange", this._visHandler);
  }

  get isRunning() {
    return this.running;
  }

  /** Must be called from a user gesture the first time (iOS requirement). */
  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this._workletLoaded) {
      await this.ctx.audioWorklet.addModule("./worklets/pcm-processor.js");
      this._workletLoaded = true;
    }
    this.resampler = new Resampler(this.ctx.sampleRate, TARGET_SAMPLE_RATE);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.node.port.onmessage = (e) => this._onFrames(e.data);
    source.connect(this.node);
    this._source = source;

    // Headphones unplugged / device gone: the track ends. Rebuild instead of
    // dying — this crashed upstream on macOS, treat it as expected.
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener("ended", () => this._rebuild());

    this.running = true;
  }

  stop() {
    this.running = false;
    this.recording = false;
    if (this.node) {
      this.node.port.onmessage = null;
      try { this._source && this._source.disconnect(this.node); } catch {}
      this.node = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.ringLen = 0;
    this.ringPos = 0;
    this.level = 0;
  }

  /** Adopt the pre-roll ring as the head of the take, then stream live. */
  beginRecording() {
    this.recording = true;
    this.recordedSamples = 0;
    const preRoll = this._drainRing();
    if (preRoll.length && this.onChunk) {
      this.recordedSamples += preRoll.length;
      this.onChunk(preRoll);
    }
  }

  /** Stop feeding onChunk. Returns the take duration in seconds (billable). */
  endRecording() {
    this.recording = false;
    const sec = this.recordedSamples / TARGET_SAMPLE_RATE;
    this.recordedSamples = 0;
    return sec;
  }

  _onFrames(float32) {
    // RMS with decay, for the level meter
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    const rms = Math.sqrt(sum / float32.length);
    this.level = Math.max(rms, this.level * 0.86);

    const int16 = this.resampler.process(float32);
    if (!int16.length) return;
    if (this.recording) {
      this.recordedSamples += int16.length;
      if (this.onChunk) this.onChunk(int16);
    } else {
      this._pushRing(int16);
    }
  }

  _pushRing(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      this.ring[this.ringPos] = chunk[i];
      this.ringPos = (this.ringPos + 1) % PRE_ROLL_SAMPLES;
      if (this.ringLen < PRE_ROLL_SAMPLES) this.ringLen++;
    }
  }

  _drainRing() {
    const out = new Int16Array(this.ringLen);
    const start = (this.ringPos - this.ringLen + PRE_ROLL_SAMPLES) % PRE_ROLL_SAMPLES;
    for (let i = 0; i < this.ringLen; i++) out[i] = this.ring[(start + i) % PRE_ROLL_SAMPLES];
    this.ringLen = 0;
    this.ringPos = 0;
    return out;
  }

  async _rebuild() {
    if (!this.running) return;
    this.stop();
    if (this.onDeviceChange) this.onDeviceChange();
    try {
      await this.start();
    } catch {
      // Mic is genuinely gone; the app surfaces this when recording is next tried.
    }
  }

  async _onVisibility() {
    // iOS suspends the context when the PWA is backgrounded; resume on return
    // or the mic silently produces nothing.
    if (document.visibilityState === "visible" && this.running && this.ctx?.state === "suspended") {
      try { await this.ctx.resume(); } catch {}
    }
  }
}

/** Debug helper for the acceptance test: Int16 16 kHz mono -> playable WAV blob. */
export function int16ToWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return new Blob([buf], { type: "audio/wav" });
}
