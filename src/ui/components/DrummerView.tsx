import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { engine } from "../../audio/AudioEngine.ts";
import type { StageFrame } from "../../show/stage-render.ts";
import { VoiceModel } from "../analysis.ts";
import { Drummer } from "../render/drummer.ts";
import { Performer } from "../render/performer.ts";
import { useStore } from "../store.ts";
import { useModel } from "../useModel.ts";

export type PerformerInput = () => (StageFrame & { time: number; syllable: string | null }) | undefined;

export function DrummerView({ kit = true, playback }: { kit?: boolean; playback?: PerformerInput }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const input = useRef(playback);
  input.current = playback;
  const model = useModel();
  const [failed, setFailed] = useState(false);
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
    const drums = kit ? new Drummer() : null;
    const performer = new Performer();
    if (drums) {
      drums.performerMount.add(performer.group);
      scene.add(drums.group);
    } else scene.add(performer.group);
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 20);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.minDistance = .6;
    controls.target.set(0, .58, .12);
    let width = 0, height = 0, raf = 0, last = performance.now();
    function frame(now: number) {
      if (input.current && width) {
        const bounds = canvas.getBoundingClientRect();
        if (bounds.bottom < 0 || bounds.top > innerHeight) {
          raf = requestAnimationFrame(frame);
          return;
        }
      }
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
        const staged = input.current?.();
        const tele = input.current ? staged?.drums ?? null : engine.latestDrums;
        const clock = staged?.time ?? ((tele?.clock ?? 0) + Math.min(.05, Math.max(0, (now - engine.latestDrumsAt) / 1000)));
        if (drums) {
          drums.update(tele, clock, dt);
          performer.headMount.rotation.x = drums.nod;
        }
        const { artic, view } = useStore.getState();
        if (model.current) performer.update(model.current, staged?.artic ? VoiceModel.articFromArray(staged.artic) : artic, null, view, camera, w, h, dt, staged?.syllable ?? null);
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      performer.dispose();
      drums?.dispose();
      renderer.dispose();
    };
  }, [model, kit]);

  return <>
    <div className="guitar-canvas drums-canvas">
      <canvas ref={canvasRef} role="img" aria-label={kit ? "3D drummer and rock drum kit. Drag to orbit." : "3D singer. Drag to orbit."} />
    </div>
    {failed && <p role="alert">3D rendering unavailable.</p>}
  </>;
}
