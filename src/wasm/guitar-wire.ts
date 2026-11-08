import type { GuitarEvent } from "../guitar/model.ts";
import type { GuitarTelemetry } from "../worklet/protocol.ts";

export const GUITAR_LAYOUT_VERSION = 2;
export const GUITAR_EVENT_BYTES = 80;
export const GUITAR_MAX_EVENTS = 2048;
export const GUITAR_TELE_HEADER = 16;
export const GUITAR_STRING_STRIDE = 264;
export const GUITAR_TELE_LEN = GUITAR_TELE_HEADER + 6*GUITAR_STRING_STRIDE;

/** Ten little-endian f64s: time, six frets, direction, strength, progression step. */
export function writeGuitarEvents(buffer: ArrayBuffer, at: number, events: readonly GuitarEvent[]): number {
  if (events.length > GUITAR_MAX_EVENTS) throw new Error("Guitar score exceeds capacity");
  const view = new DataView(buffer,at,events.length*GUITAR_EVENT_BYTES);
  events.forEach((e,i) => [e.time,...e.frets,e.direction,e.strength,e.step].forEach((v,j) => view.setFloat64(i*GUITAR_EVENT_BYTES+j*8,v,true)));
  return events.length;
}

/** Copy every view before another wasm call can grow or reuse its memory. */
export function readGuitarTelemetry(buffer: ArrayBuffer, at: number): GuitarTelemetry {
  const b = new Float64Array(buffer,at,GUITAR_TELE_LEN);
  return {
    clock:b[0], rms:b[1], playing:!!b[2], step:b[3], bpm:b[4], looping:!!b[5], duration:b[6], playhead:b[7],
    bodyEnvelope:b[8], direction:b[9], strumTime:b[10], eventCount:b[11], droppedEvents:b[12],
    strings:Array.from({length:6},(_,i) => {
      const o=GUITAR_TELE_HEADER+i*GUITAR_STRING_STRIDE;
      return { fret:b[o], muted:!!b[o+1], plucking:!!b[o+2], position:b[o+3], pull:b[o+4], envelope:b[o+5], rms:b[o+6], displacement:Float32Array.from(b.subarray(o+7,o+264)) };
    }),
  };
}
