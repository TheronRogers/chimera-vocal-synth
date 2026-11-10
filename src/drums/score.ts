export const DRUM_NAMES = ["Kick", "Snare", "High tom", "Low tom", "Floor tom", "Hi-hat", "Crash", "Ride"];
export const COUNTS = ["1", "&", "2", "&", "3", "&", "4", "&"];
export const MAX_BARS = 8;

export interface DrumScore {
  bpm: number;
  steps: number[];
}

export const GROOVES = [
  { name: "Rock backbeat", bpm: 112, lanes: { 0: [0, 4, 5], 1: [2, 6], 5: [0, 1, 2, 3, 4, 5, 6, 7] } },
  { name: "Disco four-on-the-floor", bpm: 120, lanes: { 0: [0, 2, 4, 6], 1: [2, 6], 5: [1, 3, 5, 7] } },
  { name: "Funk break", bpm: 100, lanes: { 0: [0, 3, 4, 7], 1: [2, 6], 5: [0, 1, 2, 3, 4, 5, 6, 7] } },
  { name: "Reggae one drop", bpm: 76, lanes: { 0: [4], 1: [4], 5: [0, 1, 2, 3, 4, 5, 6, 7] } },
];

export function groove(index: number): DrumScore {
  const { bpm, lanes } = GROOVES[index];
  const steps = COUNTS.map(() => 0);
  for (const [surface, hits] of Object.entries(lanes)) {
    for (const step of hits) steps[step] |= 1 << Number(surface);
  }
  return { bpm, steps };
}

export function validDrumScore(score: unknown): score is DrumScore {
  if (!score || typeof score !== "object") return false;
  const { bpm, steps } = score as DrumScore;
  return Number.isFinite(bpm) && bpm >= 40 && bpm <= 200 &&
    Array.isArray(steps) && steps.length >= COUNTS.length &&
    steps.length <= MAX_BARS * COUNTS.length && steps.length % COUNTS.length === 0 &&
    steps.every(step => Number.isInteger(step) && step >= 0 && step < 1 << DRUM_NAMES.length);
}
