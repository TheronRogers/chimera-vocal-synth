/** Guitar scores are planned off the audio thread; Rust owns every sounding event. */
export type Frets = [number, number, number, number, number, number];
export type StrumDirection = -1 | 0 | 1;
export interface Barre { fret: number; from: number; to: number; finger: number }
export interface Chord { name: string; frets: Frets; fingers?: Frets; barre?: Barre }
export interface ProgressionStep { chord: Chord; beats: number }
export type StrumPattern = StrumDirection[];
export type GuitarAction = StrumDirection | 2 | 3 | 4 | 5 | 6 | 7;
export const pickString = (index: number) => (index + 2) as GuitarAction;
export interface GuitarEvent { time: number; frets: Frets; direction: GuitarAction; strength: number; step: number }
export interface GuitarScore { events: GuitarEvent[]; duration: number; looping: boolean; bpm: number; leadIn: number }

export const BASS_STRING_NAMES = ["E1", "A1", "D2", "G2"];
export const STRING_NAMES = ["E2", "A2", "D3", "G3", "B3", "E4"];
export const CHORDS: readonly Chord[] = [
  { name: "C", frets: [-1,3,2,0,1,0], fingers: [0,3,2,0,1,0] },
  { name: "D", frets: [-1,-1,0,2,3,2], fingers: [0,0,0,1,3,2] },
  { name: "E", frets: [0,2,2,1,0,0], fingers: [0,2,3,1,0,0] },
  { name: "G", frets: [3,2,0,0,0,3], fingers: [2,1,0,0,0,3] },
  { name: "A", frets: [-1,0,2,2,2,0], fingers: [0,0,1,2,3,0] },
  { name: "Am", frets: [-1,0,2,2,1,0], fingers: [0,0,2,3,1,0] },
  { name: "Dm", frets: [-1,-1,0,2,3,1], fingers: [0,0,0,2,3,1] },
  { name: "Em", frets: [0,2,2,0,0,0], fingers: [0,2,3,0,0,0] },
  { name: "F", frets: [1,3,3,2,1,1], fingers: [1,3,4,2,1,1], barre: { fret: 1, from: 0, to: 5, finger: 1 } },
  { name: "Bm", frets: [-1,2,4,4,3,2], fingers: [0,1,3,4,2,1], barre: { fret: 2, from: 1, to: 5, finger: 1 } },
];
export const chordByName = (name: string): Chord => CHORDS.find(c => c.name === name) ?? CHORDS[0];
export const DEFAULT_PATTERN: StrumPattern = [1,0,1,-1,0,-1,1,-1];
export const DEFAULT_PROGRESSION: ProgressionStep[] = ["C","G","Am","F"].map(name => ({ chord: chordByName(name), beats: 4 }));

export function demoProgression(name: string): ProgressionStep[] {
  const entries: [string, number][] = name === "Made of air"
    ? [["Am",4],["Am",4],["Dm",2],["G",2],["C",2],["Am",2]]
    : [["C",4],["F",2],["C",2],["F",2],["C",2],["G",2],["C",2]];
  return entries.map(([name, beats]) => ({ chord: chordByName(name), beats }));
}

/** Exact presets retain their authored fingering; custom shapes never invent extra fingers. */
export function fingerChord(frets: Frets): Chord {
  const preset = CHORDS.find(c => c.frets.every((f,i) => f === frets[i]));
  if (preset) return preset;
  const fingers: Frets = [0,0,0,0,0,0];
  const contacts = frets.map((f,i) => ({ f,i })).filter(x => x.f > 0).sort((a,b) => a.f-b.f || a.i-b.i);
  let finger = 1;
  let barre: Barre | undefined;
  // A low-fret barre is possible only if it does not cross an open or lower-fretted string.
  if (contacts.length > 4) {
    const lowest = contacts[0].f;
    const same = contacts.filter(x => x.f === lowest);
    const from = Math.min(...same.map(x => x.i)), to = Math.max(...same.map(x => x.i));
    if (same.length > 1 && frets.slice(from,to+1).every(f => f >= lowest || f === -1)) {
      barre = { fret: lowest, from, to, finger: 1 };
      same.forEach(x => fingers[x.i] = 1);
      finger++;
    }
  }
  for (const {i} of contacts) if (!fingers[i] && finger <= 4) fingers[i] = finger++;
  return { name: "Custom", frets: [...frets], fingers, barre };
}

/** A half-beat grid repeats across chord boundaries; rests still change the fretting hand. */
export function planGuitar(progression: readonly ProgressionStep[], pattern: readonly StrumDirection[], bpm: number, totalBeats?: number, fingerstyle = false): GuitarScore {
  const steps = progression.slice(0,32).map(s => ({ chord: s.chord, beats: Math.max(1,Math.min(16,Math.round(s.beats))) }));
  if (!steps.length || !Number.isFinite(bpm) || bpm < 40 || bpm > 200) throw new Error("Choose a progression and a tempo from 40 to 200 BPM.");
  const cycle = steps.reduce((sum,s) => sum+s.beats,0);
  const beats = totalBeats ?? cycle;
  if (!Number.isFinite(beats) || beats <= 0 || beats > 512) throw new Error("Guitar scores support up to 512 beats.");
  const seconds = 60/bpm;
  const events: GuitarEvent[] = [];
  let beat = 0, step = 0;
  while (beat < beats) {
    const s = steps[step];
    const end = Math.min(beats,beat+s.beats);
    const frets = s.chord.frets.map(f => Number.isFinite(f) ? Math.max(-1,Math.min(12,Math.round(f))) : -1) as Frets;
    events.push({ time: beat*seconds, frets, direction: 0, strength: 0, step });
    const bassStrings = [0, 1, 2].filter(string => frets[string] >= 0);
    let nextBass = 0;
    for (let tick = Math.ceil(beat*2); tick/2 < end; tick++) {
      const slot = tick % 4;
      let index = slot + 2;
      if (slot === 0) {
        index = bassStrings[nextBass] ?? -1;
        if (++nextBass >= bassStrings.length) nextBass = 0;
      }
      const direction = fingerstyle
        ? (index >= 0 && frets[index] >= 0 ? pickString(index) : 0)
        : (pattern[tick%8] ?? 0);
      if (direction) events.push({ time: tick/2*seconds, frets, direction, strength: tick%2 ? 0.64 : 0.8, step });
    }
    beat = end; step = (step+1)%steps.length;
  }
  if (events.length > 2048) throw new Error("The guitar score is too long.");
  return { events, duration: beats*seconds, looping: totalBeats === undefined, bpm, leadIn: 0.35 };
}

const BASS_ROOTS: Record<string, readonly [number, number]> = {
  E: [0, 0], Em: [0, 0], F: [0, 1], G: [0, 3],
  A: [1, 0], Am: [1, 0], Bm: [1, 2], C: [1, 3], D: [2, 0], Dm: [2, 0],
};

/** Quarter-note bass line with a fifth on beat three. Custom shapes use the lowest sounding string. */
export function planBass(progression: readonly ProgressionStep[], bpm: number, totalBeats?: number): GuitarScore {
  const score = planGuitar(progression, [], bpm, totalBeats);
  const beatSeconds = 60 / bpm;
  const events: GuitarEvent[] = [];
  const changes = score.events;
  let change = 0;
  for (let beat = 0; beat * beatSeconds < score.duration - 1e-8; beat++) {
    while (change + 1 < changes.length && changes[change + 1].time <= beat * beatSeconds) change++;
    const chord = changes[change];
    const custom = chord.frets.slice(0, 4).findIndex(fret => fret >= 0);
    const root = BASS_ROOTS[progression[chord.step].chord.name] ?? (custom >= 0 ? [custom, chord.frets[custom]] : null);
    if (!root) continue;
    const [string, fret] = root;
    const fifth = string < 3 && fret <= 10 && Math.round(beat - chord.time / beatSeconds) % 4 === 2;
    const picked = fifth ? string + 1 : string;
    const frets: Frets = [-1, -1, -1, -1, -1, -1];
    frets[picked] = fret + (fifth ? 2 : 0);
    events.push({ time: beat * beatSeconds, frets, direction: pickString(picked), strength: fifth ? .68 : .85, step: chord.step });
  }
  return { ...score, events };
}
