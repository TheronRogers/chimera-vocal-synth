import { handPlan, packFrets } from "../guitar/physical.ts";
import { create } from "zustand";
import { engine } from "../audio/AudioEngine.ts";
import { CHORDS, DEFAULT_PATTERN, DEFAULT_PROGRESSION, demoProgression, planGuitar, type Chord, type ProgressionStep, type StrumPattern } from "../guitar/model.ts";
import { DEMO_SONGS, playDemo, stopSinging, tickSinging, useSing } from "./singing.ts";
import type { BodyMix } from "./body.ts";

interface GuitarState {
  bodyProfile: number;
  stringProfile: number;
  chord: Chord;
  draft: Chord;
  progression: ProgressionStep[];
  pattern: StrumPattern;
  bpm: number;
  singer: boolean;
  drummer: boolean;
  drumLevel: number;
  hatPedal: number;
  song: string;
  playing: boolean;
  starting: boolean;
  guitarLevel: number;
  singerLevel: number;
  error: string | null;
  setChord: (chord: Chord) => void;
  setDrummer: (on: boolean) => void;
  setDrumLevel: (level: number) => void;
  setHatPedal: (travel: number) => void;
  setSong: (song: string) => void;
  setSinger: (on: boolean) => void;
  setLevels: (guitar: number, singer: number) => void;
}

/** Session state survives navigation; audio ownership is cleared by stopGuitar. */
export const useGuitar = create<GuitarState>((set,get) => ({
  bodyProfile: 0,
  stringProfile: 0,
  chord: CHORDS.find(c => c.name === "Em")!,
  draft: CHORDS.find(c => c.name === "Em")!,
  progression: DEFAULT_PROGRESSION,
  pattern: DEFAULT_PATTERN,
  bpm: 84,
  singer: false,
  drummer: false,
  drumLevel: .5,
  hatPedal: .8,
  song: DEMO_SONGS[0].name,
  playing: false,
  starting: false,
  guitarLevel: 0.7,
  singerLevel: 0.8,
  error: null,
  setChord: chord => { const plan=handPlan(chord);set({draft:chord,error:plan.valid?null:plan.error});if(plan.valid){set({chord});applyChord(chord);} },
  setDrummer: drummer => { set({drummer}); engine.guitar(8,drummer?1:0,get().drumLevel); },
  setDrumLevel: drumLevel => { set({drumLevel}); engine.guitar(8,get().drummer?1:0,drumLevel); },
  setHatPedal: hatPedal => {
    set({ hatPedal });
    engine.guitar(10, hatPedal);
  },
  setSong: song => {
    const demo = DEMO_SONGS.find(s => s.name === song);
    if (!demo) return;
    stopGuitar();
    set({ song, bpm:demo.bpm, progression:demoProgression(song) });
  },
  setSinger: singer => {
    stopGuitar();
    set({ singer });
    if (singer) get().setSong(get().song);
  },
  setLevels: (guitarLevel,singerLevel) => { set({guitarLevel,singerLevel}); engine.guitar(6,guitarLevel,singerLevel); },
}));

export function applyInstrument(): void {
  const {bodyProfile, stringProfile} = useGuitar.getState();
  engine.guitar(11, bodyProfile, stringProfile);
}

export function chooseInstrument(bodyProfile: number, stringProfile: number): void {
  stopGuitar();
  useGuitar.setState({bodyProfile, stringProfile});
  applyInstrument();
  applyChord();
}

export function applyChord(chord = useGuitar.getState().chord): void {
  engine.guitar(7,packFrets(chord),1);
}

let token = 0;
let observedPlaying = false;

export function stopGuitar(): void {
  token++;
  observedPlaying = false;
  engine.guitar(5);
  stopSinging();
  useGuitar.setState({playing:false,starting:false});
}

export async function playGuitar(ready: () => Promise<void>, body: () => BodyMix, active: () => boolean): Promise<void> {
  stopGuitar();
  const run = token;
  const s = useGuitar.getState();
  useGuitar.setState({playing:true,starting:true,error:null});
  try {
    await ready();
    if (run !== token) return;
    if (!active()) throw new Error("Guitar audio could not start.");
    const live=useGuitar.getState();
    applyInstrument();
    engine.guitar(6,live.guitarLevel,live.singerLevel);
    engine.guitar(8,live.drummer?1:0,live.drumLevel);
    engine.guitar(10,live.hatPedal);
    const song = DEMO_SONGS.find(d => d.name === s.song)!;
    const beats = s.singer ? song.notes.reduce((sum,n) => sum+n[1],0) : undefined;
    for(const step of s.progression){const pose=handPlan(step.chord);if(!pose.valid)throw new Error(`${step.chord.name}: ${pose.error}`);}
    const guitar = planGuitar(s.progression,s.pattern,s.bpm,beats);
    if (s.singer) {
      await playDemo(s.song,body(),undefined,{bpm:s.bpm,guitar});
      if (run !== token) return;
      if (useSing.getState().demo !== s.song) throw new Error("The singer could not start.");
    } else engine.schedule({gestures:[],segments:[],end:guitar.leadIn+guitar.duration,guitar});
    if (run === token) useGuitar.setState({starting:false});
  } catch (e) {
    if (run !== token) return;
    stopGuitar();
    useGuitar.setState({error:e instanceof Error ? e.message : String(e)});
  }
}

export function tickGuitar(): void {
  tickSinging();
  const s = useGuitar.getState();
  if (!s.playing || s.starting) return;
  if (engine.latestGuitar?.playing) observedPlaying = true;
  else if (observedPlaying) { observedPlaying = false; useGuitar.setState({playing:false}); }
}
