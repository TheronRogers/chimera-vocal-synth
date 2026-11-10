import { DrummerView } from "./DrummerView.tsx";
import { useEffect, useRef, useState } from "react";
import { engine } from "../../audio/AudioEngine.ts";
import { DRUM_NAMES, groove, validDrumScore, type DrumScore } from "../../drums/score.ts";
import { useGuitar } from "../guitar.ts";
import { useStore } from "../store.ts";
import { Chip, Screen } from "./Screen.tsx";

import { DrumScoreEditor } from "./DrumScoreEditor.tsx";

const scoreKey = "chimera.drumScore";

function loadScore(): DrumScore {
  try {
    const saved = JSON.parse(localStorage.getItem(scoreKey) ?? "null");
    if (validDrumScore(saved)) return saved;
  } catch {
    // Storage can be unavailable in private or restricted sessions.
  }
  return groove(0);
}

export function DrumsPanel() {
  const epoch = useRef(0);
  const level = useGuitar(s => s.drumLevel);
  const pedal = useGuitar(s => s.hatPedal);
  const startError = useStore(s => s.startError);

  const [score, setScore] = useState(loadScore);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);

  useEffect(() => () => { epoch.current++; }, []);

  useEffect(() => {
    try { localStorage.setItem(scoreKey, JSON.stringify(score)); } catch { /* Storage is optional. */ }
  }, [score]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = -1;
    function follow() {
      const next = engine.drumScoreStep;
      if (previous !== next) {
        setStep(next);
        previous = next;
      }
      frame = requestAnimationFrame(follow);
    }
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function prepareKit() {
    const settings = useGuitar.getState();
    engine.guitar(8, 1, settings.drumLevel);
    engine.guitar(10, settings.hatPedal);
  }

  async function playScore() {
    const current = epoch.current;
    setPlaying(true);
    await useStore.getState().start();
    const state = useStore.getState();
    if (current !== epoch.current || state.mode !== "drums") return;
    if (!state.started) {
      setPlaying(false);
      return;
    }
    prepareKit();
    engine.playDrumScore(score);
  }

  function stop() {
    epoch.current++;
    engine.guitar(5);
    setPlaying(false);
    setStep(-1);
  }

  async function hit(index: number) {
    const current = epoch.current;
    await useStore.getState().start();
    const state = useStore.getState();
    if (current !== epoch.current || state.mode !== "drums" || !state.started) return;
    prepareKit();
    engine.guitar(9, index, .8, .28);
  }


  return <div className="guitar-workspace">
    <Screen title="Drums" sub="Rock kit · eight playable surfaces">
      <div className="guitar-instrument">
        <DrummerView />
        <div className="guitar-controls" role="group" aria-label="Play drum kit">
          {DRUM_NAMES.map((name, i) => <Chip key={name} toggle={false} onClick={() => void hit(i)}>{name}</Chip>)}
          <Chip toggle={false} onClick={stop}>Stop drums</Chip>
        </div>
        <div className="guitar-mix">
          <label>Drum level <input type="range" min={0} max={1} step={.01} value={level}
            onChange={e => {
              const drumLevel = Number(e.target.value);
              useGuitar.setState({ drumLevel });
              engine.guitar(8, 1, drumLevel);
            }} /></label>
          <label>Hi-hat pedal <input type="range" min={0} max={1} step={.01} value={pedal}
            aria-valuetext={pedal < .65 ? "Open" : pedal < .9 ? "Closed" : "Tight"}
            onChange={e => useGuitar.getState().setHatPedal(Number(e.target.value))} /></label>
        </div>
        <DrumScoreEditor score={score} setScore={setScore} playing={playing} step={step} play={() => void playScore()} stop={stop} />
        {startError && <p role="alert">{startError}</p>}
      </div>
    </Screen>
  </div>;
}
