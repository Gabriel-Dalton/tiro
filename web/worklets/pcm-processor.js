// Audio-thread side of capture. Deliberately dumb: copy mono Float32 frames and
// post them to the main thread. Ring buffer, resampling and state all live in
// src/audio.js — never add logic here.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      // copy: the engine reuses the underlying buffer between calls
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
