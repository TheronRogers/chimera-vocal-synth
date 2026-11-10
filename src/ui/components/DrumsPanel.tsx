import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { engine } from "../../audio/AudioEngine.ts";
import { DRUM_NAMES, groove, validDrumScore, type DrumScore } from "../../drums/score.ts";
import { useGuitar } from "../guitar.ts";
import { Drummer } from "../render/drummer.ts";
import { Performer } from "../render/performer.ts";
import { useStore } from "../store.ts";
import { useModel } from "../useModel.ts";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const model = useModel();
  const [failed, setFailed] = useState(false);
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


  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const drums = new Drummer();
    const performer = new Performer();
    drums.performerMount.add(performer.group);
    scene.add(drums.group);
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 20);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.minDistance = .6;
    controls.target.set(0, .58, .12);
    let width = 0, height = 0, raf = 0, last = performance.now();
    function frame(now: number) {
      const dt = Math.min(.1, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h) {
        if (w !== width || h !== height) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          const distance = Math.max(2.8, 2.5 / camera.aspect);
          if (!width) camera.position.copy(controls.target).add(new THREE.Vector3(.75, .8, distance));
          renderer.setSize(w, h, false);
          width = w;
          height = h;
        }
        controls.update();
        const tele = engine.latestDrums;
        const clock = (tele?.clock ?? 0) + Math.min(.05, Math.max(0, (now - engine.latestDrumsAt) / 1000));
        drums.update(tele, clock, dt);
        performer.headMount.rotation.x = drums.nod;
        const { artic, view } = useStore.getState();
        if (model.current) performer.update(model.current, artic, null, view, camera, w, h, dt, null);
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      performer.dispose();
      drums.dispose();
      renderer.dispose();
    };
  }, [model]);

  return <div className="guitar-workspace">
    <Screen title="Drums" sub="Rock kit · eight playable surfaces">
      <div className="guitar-instrument">
        <div className="guitar-canvas drums-canvas">
          <canvas ref={canvasRef} role="img" aria-label="3D drummer and rock drum kit. Drag to orbit." />
        </div>
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
        {failed && <p role="alert">3D rendering unavailable. The drum pads still work.</p>}
        {startError && <p role="alert">{startError}</p>}
      </div>
    </Screen>
  </div>;
}
