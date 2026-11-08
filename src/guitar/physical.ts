import { call } from "../wasm/chimera.ts";
import { type Chord, fingerChord } from "./model.ts";
export interface HandPlan {
  valid: boolean;
  error: string | null;
  palm: number[];
  forces: number[];
  fingers: { finger: number; barre: boolean; points: number[][] }[];
}
export const handPlan = (chord: Chord) =>
  call<HandPlan>("guitarHand", {
    frets: chord.frets,
    fingers: fingerChord(chord.frets).fingers,
  });
/** Six base-14 fret digits: skip=0, open=1, fret twelve=13. */
export const packFrets = (chord: Chord) =>
  chord.frets.reduce((n, f, i) => n + (f + 1) * 14 ** i, 0);
