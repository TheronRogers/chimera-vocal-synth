import { readDrumTelemetry } from "../wasm/drum-wire.ts";
import { readGuitarTelemetry, writeGuitarEvents } from "../wasm/guitar-wire.ts";
import { writeGestures } from "../wasm/wire.ts";
import type { GuitarScore } from "../guitar/model.ts";
import type { BodyMix, Plan } from "../wasm/types.ts";
import type { GuitarTelemetry, DrumTelemetry } from "../worklet/protocol.ts";
import type { Musician } from "./stage.ts";

type Exports = { memory: WebAssembly.Memory } & Record<string, (...args: number[]) => number>;

export interface StageFrame {
  guitar?: GuitarTelemetry;
  drums?: DrumTelemetry;
  artic?: Float32Array;
}

export interface StageTrack {
  frames: StageFrame[];
  secondsPerFrame: number;
  syllables: string[];
  lead: number;
}

export interface StageRender {
  left: Float32Array;
  right: Float32Array;
  tracks: Map<number, StageTrack>;
}

interface RenderRequest {
  module: WebAssembly.Module;
  sampleRate: number;
  duration: number;
  partCount: number;
  parts: { index: number; musician: Musician; body: BodyMix; voice: Plan | null; guitar?: GuitarScore; syllables: string[] }[];
}

function renderStage({ module, sampleRate, duration, partCount, parts }: RenderRequest): StageRender {
  const x = new WebAssembly.Instance(module, {}).exports as Exports;
  const length = Math.ceil((duration + .45) * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  const tracks = new Map<number, StageTrack>();
  const interval = Math.min(4096, Math.round(sampleRate / 30));
  const lead = .25;
  const gain = .82 / Math.sqrt(partCount);

  parts.forEach(({ musician, body, voice, guitar, syllables, index }) => {
    const h = x.engine_new(sampleRate);
    const frames: StageFrame[] = [];
    const pan = partCount === 1 ? .5 : .275 + .45 * index / (partCount - 1);
    const leftGain = gain * Math.cos(pan * Math.PI / 2);
    const rightGain = gain * Math.sin(pan * Math.PI / 2);
    const drums = musician.instrument === "drums";
    try {
      x.engine_set_body(h, body.female, body.child);
      x.engine_set_gate(h, 0);
      if (voice) {
        const count = writeGestures(x.memory.buffer, x.engine_records(h), voice.gestures, 4000);
        x.engine_schedule(h, count, lead, 1);
      }
      if (guitar) {
        x.engine_guitar(h, 0, 1, 0, 0);
        x.engine_guitar(h, 6, .63, voice ? .86 : 0, 0);
        if (drums) x.engine_guitar(h, 8, 1, .5, 0);
        else {
          const bass = musician.instrument === "bass guitar";
          x.engine_guitar(h, 14, Number(bass), 0, 0);
          x.engine_guitar(h, 11, 0, bass ? 4 : 1, 0);
          x.engine_guitar(h, 12, bass ? 2 : 1, bass ? .76 : .87, 0);
        }
        const count = writeGuitarEvents(x.memory.buffer, x.engine_guitar_records(h), guitar.events);
        x.engine_guitar_schedule(h, count, lead, guitar.duration, 0, guitar.bpm);
      }
      for (let offset = 0; offset < length; offset += interval) {
        const frame: StageFrame = {};
        if (drums) frame.drums = readDrumTelemetry(x.memory.buffer, x.engine_drum_telemetry(h));
        else if (guitar) frame.guitar = readGuitarTelemetry(x.memory.buffer, x.engine_guitar_telemetry(h));
        if (voice) {
          const p = x.engine_telemetry(h);
          const header = new Float64Array(x.memory.buffer, p, 16);
          frame.artic = Float32Array.from(new Float64Array(x.memory.buffer, p + 16 * 8, header[11]));
        }
        frames.push(frame);
        const count = Math.min(interval, length - offset);
        const p = x.engine_render(h, count);
        const samples = new Float32Array(x.memory.buffer, p, count);
        for (let j = 0; j < count; j++) {
          left[offset + j] += samples[j] * leftGain;
          right[offset + j] += samples[j] * rightGain;
        }
      }
    } finally {
      x.engine_free(h);
    }
    tracks.set(musician.id, { frames, secondsPerFrame: interval / sampleRate, syllables, lead });
  });

  return { left, right, tracks };
}

self.onmessage = ({ data }: MessageEvent<RenderRequest>) => {
  try {
    const result = renderStage(data);
    self.postMessage(result, { transfer: [result.left.buffer, result.right.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
