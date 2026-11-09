/** Messages between the main thread and the CHIMERA AudioWorklet. */
import type { HumanArtic } from "../wasm/types.ts";
import type { VoiceSource, VoiceTelemetry } from "../wasm/types.ts";
import type { Segment, PlannedSegment } from "../wasm/types.ts";
import type { Gesture } from "../wasm/types.ts";
import type { CreatureTelemetry } from "../wasm/types.ts";
import type { BeatStep, BodyMix } from "../wasm/types.ts";

export interface PhraseMsg {
  segments: Segment[];
  intonation?: "statement" | "question" | "flat";
  pause?: number;
}

export type BodyName = "male" | "female" | "child";

/** Guitar ABI v3: activate, string fret, held mute, string pluck, strum, stop, mix, grip, drum mix, drum hit. */
/** op 9: a=surface, b=strength, c=travel lead in seconds (0 means immediate). */
/** op 10: a=hi-hat pedal travel from released to tight (0–1). */
export type GuitarOp = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export interface GuitarStringTelemetry {
  fret: number; muted: boolean; plucking: boolean; position: number; pull: number;
  envelope: number; rms: number; displacement: Float32Array;
}
export interface DrumTelemetry {
  clock: number; enabled: boolean; playing: boolean; bpm: number; start: number; duration: number; looping: boolean;
  kickCompression: number; hatTravel: number; hatGap: number; hatPressure: number; hatClose: number;
  rattle: number; next: number[]; last: number[]; strength: number[]; modes: number[][]; wires: number[];
}
export interface GuitarTelemetry {
  contactForces:number[];
  gripPhase:number; targetFrets:number[];
  bridge:number; cavity:number; modes:{q:number;velocity:number}[];
  clock: number; rms: number; playing: boolean; step: number; bpm: number; looping: boolean;
  duration: number; playhead: number; bodyEnvelope: number; direction: number; strumTime: number;
  eventCount: number; droppedEvents: number; strings: GuitarStringTelemetry[];
}

export type ToWorklet =
  | { type: "guitar"; op: GuitarOp; a?: number; b?: number; c?: number }
  | { type: "body"; body: BodyMix }
  | { type: "artic"; values: Partial<HumanArtic>; tipFree?: boolean }
  | { type: "source"; values: Partial<VoiceSource> }
  | { type: "gate"; level: number }
  | { type: "telemetry"; enabled: boolean }
  /** gestures planned on the main thread with times relative to "now" (the worklet adds its clock) */
  | { type: "schedule"; gestures: Gesture[]; segments: PlannedSegment[]; end: number; id: number; replace: boolean; lead?: number; guitar?: import("../guitar/model.ts").GuitarScore }
  | { type: "stopSpeech" }
  /** switch the active voice: "human" or a creature id */
  | { type: "creature"; id: string; params?: Record<string, number> }
  | { type: "cparams"; values: Record<string, number> }
  | { type: "call"; id: string; pitch?: number; amp?: number }
  | { type: "stopCall" }
  /** beatbox sequencer: any subset of its state */
  | { type: "beat"; steps?: (BeatStep | null)[]; bpm?: number; swing?: number; playing?: boolean }
  /** end the open-ended gestures with this tag now (a sung note released) */
  | { type: "release"; tag: number }
  /** play one beatbox sound as soon as the mouth can make it */
  | { type: "beatHit"; id: string; note?: number; accent?: number };

export interface TelemetryMessage {
  type: "telemetry";
  t: VoiceTelemetry;
  /** fraction of the render-quantum budget used by the engine (smoothed) */
  load: number;
  body: BodyMix;
  nPh: number;
  nOr: number;
  /** beatbox step under the playhead (−1 when the sequencer is stopped) */
  beatStep: number;
}

export interface PlannedMessage {
  type: "planned";
  id: number;
  t0: number;
  end: number;
  segments: PlannedSegment[];
}

export interface CreatureTelemetryMessage {
  type: "ctelemetry";
  t: CreatureTelemetry;
  load: number;
}

export type FromWorklet =
  | { type: "dtelemetry"; t: DrumTelemetry }
  | { type: "gtelemetry"; t: GuitarTelemetry; load: number }
  | { type: "ready"; sampleRate: number; body: BodyMix; nPh: number; nOr: number; creature: string }
  | TelemetryMessage
  | CreatureTelemetryMessage
  | PlannedMessage
  | { type: "error"; message: string };
