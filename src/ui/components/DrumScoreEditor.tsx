import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { COUNTS, DRUM_NAMES, GROOVES, MAX_BARS, groove, type DrumScore } from "../../drums/score.ts";
import { Chip } from "./Screen.tsx";

interface Props {
  score: DrumScore;
  setScore: Dispatch<SetStateAction<DrumScore>>;
  playing: boolean;
  step: number;
  play: () => void;
  stop: () => void;
}

export function DrumScoreEditor({ score, setScore, playing, step, play, stop }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const bars = score.steps.length / COUNTS.length;

  useEffect(() => {
    const viewport = track.current;
    const cell = viewport?.querySelector<HTMLElement>("[aria-current='step']");
    if (!viewport || !cell) return;
    const offset = cell.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
    const labelWidth = cell.parentElement?.firstElementChild?.getBoundingClientRect().width ?? 0;
    if (step === 0 || offset < labelWidth || offset + cell.offsetWidth > viewport.clientWidth) {
      viewport.scrollLeft += offset - labelWidth;
    }
  }, [step]);

  return <section className="drum-score" aria-label="Drum score">
    <h3>Drum score</h3>
    <div className="drum-score-controls">
      <label>Classic groove <select value="" disabled={playing} onChange={e => {
        if (e.target.value !== "") setScore(groove(Number(e.target.value)));
      }}>
        <option value="" disabled>Load a groove…</option>
        {GROOVES.map(({ name }, i) => <option key={name} value={i}>{name}</option>)}
      </select></label>
      <label>Tempo <input type="number" min={40} max={200} key={score.bpm} defaultValue={score.bpm} disabled={playing}
        onBlur={e => {
          const bpm = e.target.valueAsNumber;
          if (bpm >= 40 && bpm <= 200) setScore(s => ({ ...s, bpm }));
          else e.target.value = String(score.bpm);
        }} /> BPM</label>
      <Chip toggle={false} onClick={playing ? stop : play}>{playing ? "Stop score" : "Play score"}</Chip>
      <Chip toggle={false} disabled={playing || bars >= MAX_BARS}
        onClick={() => setScore(s => ({ ...s, steps: [...s.steps, ...COUNTS.map(() => 0)] }))}>Add bar</Chip>
      <Chip toggle={false} disabled={playing || bars === 1}
        onClick={() => setScore(s => ({ ...s, steps: s.steps.slice(0, -COUNTS.length) }))}>Remove last bar</Chip>
      <Chip toggle={false} disabled={playing}
        onClick={() => setScore(s => ({ ...s, steps: s.steps.map(() => 0) }))}>Clear hits</Chip>
    </div>
    <p>Toggle hits on the eighth-note grid, then play the score on loop. Stop playback to edit.</p>
    <div className="drum-track" ref={track}>
      <table>
        <thead>
          <tr>
            <th scope="col">Kit</th>
            {score.steps.map((_, i) => {
              const count = i % COUNTS.length;
              const bar = Math.floor(i / COUNTS.length) + 1;
              return <th key={i} scope="col" className={count === 0 ? "drum-bar" : undefined}
                aria-current={step === i ? "step" : undefined}>
                {count === 0 && <span className="drum-bar-number">Bar {bar}</span>}
                {COUNTS[count]}
              </th>;
            })}
          </tr>
        </thead>
        <tbody>
          {DRUM_NAMES.map((name, surface) => <tr key={name}>
            <th scope="row">{name}</th>
            {score.steps.map((mask, i) => {
              const bit = 1 << surface;
              const on = Boolean(mask & bit);
              const count = i % COUNTS.length;
              const beat = Math.floor(count / 2) + 1;
              const bar = Math.floor(i / COUNTS.length) + 1;
              return <td key={i} className={count === 0 ? "drum-bar" : undefined} data-playing={step === i}>
                <button type="button" aria-label={`${name}, bar ${bar}, beat ${beat}${count % 2 ? " and" : ""}`}
                  aria-pressed={on} disabled={playing}
                  onClick={() => setScore(s => ({
                    ...s, steps: s.steps.map((value, index) => index === i ? value ^ bit : value),
                  }))}>
                  <span aria-hidden="true">{on ? "●" : "·"}</span>
                </button>
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
