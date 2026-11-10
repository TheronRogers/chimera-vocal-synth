import type { StageRender } from "../../show/stage-render.ts";
import { GuitarView3D } from "./GuitarView3D.tsx";
import { DrummerView, type PerformerInput } from "./DrummerView.tsx";
import { ELECTRIC_BODIES, guitarInstruments } from "../../guitar/instruments.ts";
import { chordByName, fingerChord } from "../../guitar/model.ts";
import { useEffect, useRef, useState } from "react";
import { playStage, prepareStage, STAGE_BPM, STAGE_CAST, STAGE_CHORDS, STAGE_SONG, type Musician, type StageInstrument } from "../../show/stage.ts";
import { useStore } from "../store.ts";
import { Screen } from "./Screen.tsx";

const INSTRUMENTS: readonly StageInstrument[] = ["none", "rhythm guitar", "lead guitar", "bass guitar", "drums"];
const MAX_CAST = 12;

const IDLE_BASS = fingerChord([0, 0, 0, 0, -1, -1]);
const ignoreContact = () => {};

function StageFigure({ musician, playback }: { musician: Musician; playback: PerformerInput }) {
  if (!musician.instrument.includes("guitar")) {
    return <DrummerView kit={musician.instrument === "drums"} playback={playback} />;
  }
  const bass = musician.instrument === "bass guitar";
  const lead = musician.instrument === "lead guitar";
  return <GuitarView3D profile={guitarInstruments().bodies[0]}
    electricBody={ELECTRIC_BODIES[bass ? 3 : lead ? 0 : 1]}
    bass={bass} leftHanded={musician.leftHanded} chord={bass ? IDLE_BASS : chordByName("G")}
    singer={Boolean(musician.lyrics.trim())} pickup={bass ? 2 : 1} pickupPosition={bass ? .76 : .87}
    fingerstyle={lead || bass} playback={playback} onEngage={ignoreContact} onRelease={ignoreContact} />;
}

export function StagePanel() {
  const [cast, setCast] = useState<Musician[]>(() => STAGE_CAST.map(m => ({ ...m })));
  const [chords, setChords] = useState(STAGE_CHORDS);
  const [bpm, setBpm] = useState(STAGE_BPM);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const context = useRef<AudioContext | null>(null);
  const run = useRef<ReturnType<typeof playStage> | null>(null);
  const frame = useRef(0);
  const cached = useRef<{ cast: Musician[]; bpm: number; chords: string; render: StageRender } | null>(null);
  const pending = useRef<ReturnType<typeof prepareStage> | null>(null);
  const generation = useRef(0);
  const nextId = useRef(5);

  function stop() {
    generation.current++;
    cancelAnimationFrame(frame.current);
    pending.current?.cancel();
    pending.current = null;
    run.current?.stop();
    run.current = null;
  }

  useEffect(() => () => {
    stop();
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
  }, []);

  async function play() {
    if (playing) {
      stop();
      setPlaying(false);
      setPreparing(false);
      return;
    }
    const token = ++generation.current;
    setError("");
    setPlaying(true);
    setPreparing(true);
    try {
      const ctx = context.current ??= new AudioContext({ latencyHint: "playback" });
      await ctx.resume();
      if (generation.current !== token) return;
      if (ctx.state !== "running") throw new Error("Stage audio could not start.");
      const previous = cached.current;
      let render: StageRender;
      if (previous?.cast === cast && previous.bpm === bpm && previous.chords === chords) {
        render = previous.render;
      } else {
        const preparation = prepareStage(ctx, cast, chords, bpm);
        pending.current = preparation;
        render = await preparation.result;
        if (generation.current !== token) return;
        pending.current = null;
        cached.current = { cast, bpm, chords, render };
      }
      if (ctx.state !== "running") throw new Error("Audio was interrupted. Press Play performance to retry.");
      const playback = playStage(ctx, render, useStore.getState().volume);
      setPreparing(false);
      run.current = playback;
      const tick = () => {
        if (generation.current !== token) return;
        if (ctx.state !== "running" || ctx.currentTime >= playback.startAt + playback.duration + .1) {
          stop();
          setPlaying(false);
          setPreparing(false);
        } else {
          playback.setVolume(useStore.getState().volume);
          frame.current = requestAnimationFrame(tick);
        }
      };
      frame.current = requestAnimationFrame(tick);
    } catch (e) {
      if (generation.current !== token) return;
      stop();
      setPlaying(false);
      setPreparing(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function edit(id: number, patch: Partial<Musician>) {
    setCast(previous => previous.map(m => m.id === id ? { ...m, ...patch } : m));
  }

  return <Screen title="Stage" sub="Arrange an ensemble" className="s-stage">
    <div className="stage-workspace">
      <h2>{STAGE_SONG}</h2>
      <p className="dim">An original Merseybeat number for three voices, two guitars, left-handed bass and drums.</p>
      <div className="guitar-controls">
        <button className="primary" onClick={() => void play()}>{preparing ? "Cancel preparation" : playing ? "Stop performance" : "Play performance"}</button>
        <button className="chip" disabled={playing} onClick={() => {
          setCast(STAGE_CAST.map(m => ({ ...m })));
          setChords(STAGE_CHORDS);
          setBpm(STAGE_BPM);
          setError("");
        }}>Load demo</button>
        <label>Tempo <input aria-label="Stage tempo" type="number" min={40} max={200} value={bpm} disabled={playing} onChange={e => setBpm(e.target.valueAsNumber || 0)} /> BPM</label>
        <label>Chords <input aria-label="Stage chords" value={chords} disabled={playing} onChange={e => setChords(e.target.value)} /></label>
      </div>
      {preparing && <p role="status">Preparing stage audio…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="stage-cast" aria-label="Musicians on stage">
        {cast.map(m => <figure key={m.id}>
          <StageFigure musician={m} playback={() => {
            const playback = run.current, ctx = context.current;
            const track = playback?.tracks.get(m.id);
            if (!ctx || !playback || !track) return;
            const stamp = ctx.getOutputTimestamp?.().contextTime;
            const time = Math.max(0, (stamp || ctx.currentTime - ctx.baseLatency) - playback.startAt);
            const index = Math.min(track.frames.length - 1, Math.floor(time / track.secondsPerFrame));
            const syllable = track.syllables[Math.floor((time - track.lead) * bpm / 60)] ?? null;
            return { ...track.frames[index], time, syllable };
          }} />
          <figcaption>{m.name || "Unnamed musician"}</figcaption>
        </figure>)}
      </div>
      <p className="dim">Each chord lasts four beats. Enter one MIDI note per lyric syllable, one beat per note.</p>
      <div className="stage-parts">
        {cast.map((m, index) => <fieldset key={m.id} disabled={playing}>
          <legend>Musician {index + 1}</legend>
          <label>Name <input value={m.name} onChange={e => edit(m.id, { name: e.target.value })} /></label>
          <label>Instrument <select value={m.instrument} onChange={e => edit(m.id, { instrument: e.target.value as StageInstrument, tab: "" })}>
            {INSTRUMENTS.map(instrument => <option key={instrument} value={instrument}>{instrument === "none" ? "Voice only" : instrument}</option>)}
          </select></label>
          {m.instrument.includes("guitar") && <label><input type="checkbox" checked={m.leftHanded}
            onChange={e => edit(m.id, { leftHanded: e.target.checked })} /> Left-handed</label>}
          {m.instrument.includes("guitar") && <label>Tab override (optional)
            <textarea rows={2} spellCheck={false} value={m.tab ?? ""} onChange={e => edit(m.id, { tab: e.target.value })}
              placeholder={m.instrument === "bass guitar" ? "G, D, A, E rows" : "e, B, G, D, A, E rows"} />
          </label>}
          <label>Lyrics <input value={m.lyrics} onChange={e => edit(m.id, { lyrics: e.target.value })} /></label>
          <label>Vocal MIDI notes <input value={m.melody} onChange={e => edit(m.id, { melody: e.target.value })} /></label>
          <button className="chip" onClick={() => setCast(cast.filter(other => other.id !== m.id))}>Remove musician</button>
        </fieldset>)}
      </div>
      <button className="chip" disabled={playing || cast.length >= MAX_CAST} onClick={() => {
        const id = nextId.current++;
        setCast([...cast, { id, name: `Musician ${id}`, instrument: "none", leftHanded: false, lyrics: "", melody: "" }]);
      }}>Add musician</button>
    </div>
  </Screen>;
}
