import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { engine } from "../../audio/AudioEngine.ts";
import { useGuitar } from "../guitar.ts";
import { Drummer } from "../render/drummer.ts";
import { Performer } from "../render/performer.ts";
import { useStore } from "../store.ts";
import { useModel } from "../useModel.ts";
import { Chip, Screen } from "./Screen.tsx";

const pads = ["Kick", "Snare", "High tom", "Low tom", "Floor tom", "Hi-hat", "Crash", "Ride"];

export function DrumsPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const epoch = useRef(0);
  const model = useModel();
  const level = useGuitar(s => s.drumLevel);
  const pedal = useGuitar(s => s.hatPedal);
  const startError = useStore(s => s.startError);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => { epoch.current++; }, []);

  async function hit(index: number) {
    const current = epoch.current;
    await useStore.getState().start();
    const state = useStore.getState();
    if (current !== epoch.current || state.mode !== "drums" || !state.started) return;
    const settings = useGuitar.getState();
    engine.guitar(8, 1, settings.drumLevel);
    engine.guitar(10, settings.hatPedal);
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
          {pads.map((name, i) => <Chip key={name} toggle={false} onClick={() => void hit(i)}>{name}</Chip>)}
          <Chip toggle={false} onClick={() => { epoch.current++; engine.guitar(5); }}>Stop drums</Chip>
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
        {failed && <p role="alert">3D rendering unavailable. The drum pads still work.</p>}
        {startError && <p role="alert">{startError}</p>}
      </div>
    </Screen>
  </div>;
}
