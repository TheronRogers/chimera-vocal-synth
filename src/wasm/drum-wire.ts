import type { DrumTelemetry } from "../worklet/protocol.ts";
/** Matches chimera::drums; independent of the guitar and gesture layouts. */
export const DRUM_LAYOUT_VERSION = 2;
export const DRUM_TELE_LEN = 93;
export function readDrumTelemetry(buffer: ArrayBuffer, at: number): DrumTelemetry {
  const b=new Float64Array(buffer,at,DRUM_TELE_LEN);
  return {clock:b[0],enabled:!!b[1],playing:!!b[2],bpm:b[3],start:b[4],duration:b[5],looping:!!b[6],rattle:b[7],
    next:Array.from(b.subarray(8,16)),last:Array.from(b.subarray(16,24)),strength:Array.from(b.subarray(24,32)),
    modes:Array.from({length:8},(_,i)=>Array.from(b.subarray(32+i*4,36+i*4))),wires:Array.from(b.subarray(64,88)),
    kickCompression:b[88],hatTravel:b[89],hatGap:b[90],hatPressure:b[91],hatClose:b[92]};
}
