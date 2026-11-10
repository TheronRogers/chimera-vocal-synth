import { chimeraModule } from "../wasm/chimera.ts";
import type { StageRender } from "./stage-render.ts";
import { CHORDS, chordByName, planBass, planGuitar, type GuitarScore, type StrumPattern } from "../guitar/model.ts";
import { planTab } from "../guitar/tab.ts";
import { lyricsToSyllables, planSong } from "../wasm/engine.ts";
import { PRESETS } from "../ui/body.ts";

export type StageInstrument = "none" | "rhythm guitar" | "lead guitar" | "bass guitar" | "drums";
export interface Musician {
  id: number;
  name: string;
  instrument: StageInstrument;
  leftHanded: boolean;
  lyrics: string;
  melody: string;
  tab?: string;
}

export const STAGE_BPM = 126;
export const STAGE_CHORDS = "G Em C D G C D G";
export const STAGE_SONG = "The Morning Comes Around";
const lyrics = "Stay till dawn turns gold and blue. Take my hand, this road is new.";
export const STAGE_CAST: readonly Musician[] = [
  { id: 1, name: "Rhythm & lead vocal", instrument: "rhythm guitar", leftHanded: false, lyrics,
    melody: "59 62 64 62 59 57 55 59 60 64 66 62 59 55" },
  { id: 2, name: "Lead & high harmony", instrument: "lead guitar", leftHanded: false, lyrics,
    melody: "62 67 67 66 62 60 60 62 64 67 69 66 62 59" },
  { id: 3, name: "Bass & low harmony", instrument: "bass guitar", leftHanded: true, lyrics,
    melody: "55 55 59 57 55 52 52 55 55 60 62 57 55 55" },
  { id: 4, name: "Drums", instrument: "drums", leftHanded: false, lyrics: "", melody: "" },
];

function stageScore(instrument: StageInstrument, chords: string[], bpm: number, beats: number): GuitarScore | undefined {
  if (instrument === "none") return;
  const progression = chords.map(name => ({ chord: chordByName(name), beats: 4 }));
  if (instrument === "rhythm guitar" || instrument === "lead guitar") {
    const pattern: StrumPattern = instrument === "rhythm guitar" ? [1, 0, -1, 0, 1, 0, -1, -1] : [];
    return { ...planGuitar(progression, pattern, bpm, beats, instrument === "lead guitar"), leadIn: 0 };
  }

  if (instrument === "bass guitar") return { ...planBass(progression, bpm, beats), leadIn: 0 };
  return { events: [], duration: beats * 60 / bpm, looping: false, bpm, leadIn: 0 };
}

export function prepareStage(ctx: AudioContext, cast: readonly Musician[], progression: string, bpm: number) {
  const chords = progression.trim().split(/\s+/);
  if (chords.length > 16 || chords.some(name => !CHORDS.some(chord => chord.name === name)))
    throw new Error("Enter 1–16 chords using C, D, E, G, A, Am, Dm, Em, F or Bm.");
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 200) throw new Error("Choose a tempo from 40 to 200 BPM.");

  const beats = chords.length * 4;
  const parts = cast.map(musician => {
    const syllables = lyricsToSyllables(musician.lyrics.trim());
    const pitches = musician.melody.trim() ? musician.melody.trim().split(/\s+/).map(Number) : [];
    if (syllables.length !== pitches.length || pitches.some(pitch => !Number.isInteger(pitch) || pitch < 36 || pitch > 84))
      throw new Error(`${musician.name}: enter one MIDI pitch (36–84) per syllable, or clear both vocal fields.`);
    if (pitches.length > beats) throw new Error(`${musician.name}: the melody exceeds the length of the progression.`);
    const notes = pitches.map((midi, i) => ({ midi, beats: 1, syl: syllables[i] }));
    const body = { ...PRESETS.male, female: musician.id % 3 * .12 };
    const voice = notes.length ? planSong(notes, { body, bpm, t0: 0, vibrato: 18 }) : null;
    let guitar = stageScore(musician.instrument, chords, bpm, beats);
    if (musician.instrument.includes("guitar") && musician.tab?.trim()) {
      try {
        guitar = { ...planTab(musician.tab, bpm, musician.instrument === "bass guitar"), leadIn: 0 };
        if (guitar.duration > beats * 60 / bpm + 1e-8) throw new Error("The tab exceeds the length of the progression.");
      } catch (e) {
        throw new Error(`${musician.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { musician, body, voice, guitar, syllables: syllables.map(syllable => syllable.text) };
  }).filter(part => part.voice || part.guitar);
  if (!parts.length) throw new Error("Give at least one musician a vocal or instrument part.");

  const duration = beats * 60 / bpm;
  const module = chimeraModule();
  const sampleRate = ctx.sampleRate;
  const batches = Array.from({ length: Math.min(4, parts.length) }, () => [] as (typeof parts[number] & { index: number })[]);
  parts.forEach((part, index) => batches[index % batches.length].push({ ...part, index }));
  const workers: Worker[] = [];
  let rejectRender: (error: Error) => void = () => {};
  function dispose() {
    workers.forEach(worker => worker.terminate());
    workers.length = 0;
  }
  const result = new Promise<StageRender[]>((resolve, reject) => {
    rejectRender = reject;
    const renders = batches.map(batch => new Promise<StageRender>((resolveBatch, rejectBatch) => {
      const worker = new Worker(new URL("./stage-render.ts", import.meta.url), { type: "module" });
      workers.push(worker);
      worker.onmessage = ({ data }: MessageEvent<StageRender | { error: string }>) => {
        if ("error" in data) rejectBatch(new Error(data.error));
        else resolveBatch(data);
      };
      worker.onerror = event => rejectBatch(new Error(event.message || "Stage rendering failed."));
      worker.postMessage({ module, sampleRate, duration, parts: batch, partCount: parts.length });
    }));
    void Promise.all(renders).then(resolve, reject);
  }).then(([mix, ...stems]) => {
    for (const stem of stems) {
      for (let i = 0; i < mix.left.length; i++) {
        mix.left[i] += stem.left[i];
        mix.right[i] += stem.right[i];
      }
      for (const [id, track] of stem.tracks) mix.tracks.set(id, track);
    }
    let peak = 1;
    for (let i = 0; i < mix.left.length; i++) peak = Math.max(peak, Math.abs(mix.left[i]), Math.abs(mix.right[i]));
    const fadeFrames = Math.round(sampleRate * .03);
    for (let i = 0; i < mix.left.length; i++) {
      const gain = Math.min(1, (mix.left.length - 1 - i) / fadeFrames) / peak;
      mix.left[i] *= gain;
      mix.right[i] *= gain;
    }
    return mix;
  }).finally(dispose);
  return { result, cancel: () => rejectRender(new Error("Stage preparation cancelled.")) };
}

export function playStage(ctx: AudioContext, render: StageRender, volume: number) {
  const buffer = ctx.createBuffer(2, render.left.length, ctx.sampleRate);
  buffer.getChannelData(0).set(render.left);
  buffer.getChannelData(1).set(render.right);
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(master);
  const startAt = ctx.currentTime + .03;
  source.start(startAt);
  return {
    startAt,
    duration: buffer.duration,
    tracks: render.tracks,
    stop: () => { source.stop(); source.disconnect(); master.disconnect(); },
    setVolume: (level: number) => { master.gain.value = level; },
  };
}
