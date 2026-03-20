class MemoryEngineRecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !input[0]) {
      if (output) {
        for (const channel of output) {
          channel.fill(0);
        }
      }
      return true;
    }

    const mono = input[0];
    this.port.postMessage(mono.slice());

    if (output) {
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        const source = input[channelIndex] || mono;
        output[channelIndex].set(source);
      }
    }

    return true;
  }
}

class MemoryEngineBitcrushProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions || {};
    this.bitDepth = config.bitDepth || 16;
    this.step = Math.pow(0.5, this.bitDepth);
    this.holdN = Math.max(1, config.holdN || 1);
    this.noiseAmp = config.noiseAmp || 0.0;
    this.dropoutProb = config.dropoutProb || 0.0;
    this.holdCounters = [];
    this.heldSamples = [];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) {
      return true;
    }

    for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
      const source = (input && (input[channelIndex] || input[0])) || null;
      const target = output[channelIndex];
      if (!source) {
        target.fill(0);
        continue;
      }

      if (this.holdCounters[channelIndex] === undefined) {
        this.holdCounters[channelIndex] = 0;
      }
      if (this.heldSamples[channelIndex] === undefined) {
        this.heldSamples[channelIndex] = 0.0;
      }

      for (let i = 0; i < source.length; i += 1) {
        if (this.holdCounters[channelIndex] === 0) {
          this.heldSamples[channelIndex] = source[i];
        }
        this.holdCounters[channelIndex] = (this.holdCounters[channelIndex] + 1) % this.holdN;

        let sample = Math.round(this.heldSamples[channelIndex] / this.step) * this.step;
        if (Math.random() < this.dropoutProb) {
          sample = 0.0;
        }
        sample += (Math.random() * 2 - 1) * this.noiseAmp;
        target[i] = sample;
      }
    }

    return true;
  }
}

registerProcessor("memory-engine-recorder", MemoryEngineRecorderProcessor);
registerProcessor("memory-engine-bitcrush", MemoryEngineBitcrushProcessor);
