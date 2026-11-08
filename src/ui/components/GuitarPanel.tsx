import { useEffect, useRef, useState } from "react";
import { engine } from "../../audio/AudioEngine.ts";
import { useStore } from "../store.ts";
import { usePhosphor } from "../usePhosphor.ts";
import { V } from "../colors.ts";
import { Screen } from "./Screen.tsx";

/** Pointer ownership is per finger, so a touch on the fret never steals the pluck. */
export function GuitarPanel() {
  const [fretted, setFretted] = useState(false);
  const [status, setStatus] = useState("Open E2 · fingers released");
  const fretSources = useRef(new Map<string, number>());
  const pointers = useRef(new Map<number, "fret" | "pluck">());
  const epoch = useRef(0);
  const pullTarget = useRef({ x: 0.8, displacement: 0 });
  const started = useStore(s => s.started);
  const error = useStore(s => s.startError);
  const pressure = () => Math.max(0, ...fretSources.current.values());
  const fret = (source: string, on: boolean, amount = 1) => {
    if (on) fretSources.current.set(source, amount); else fretSources.current.delete(source);
    setFretted(pressure() > 0.99); engine.guitar(1, pressure());
  };
  const clear = () => {
    epoch.current++; pointers.current.clear(); fretSources.current.clear();
    setFretted(false); engine.guitar(1, 0); engine.guitar(3);
  };
  const ready = async () => {
    const current = epoch.current;
    await useStore.getState().start();
    return current === epoch.current && useStore.getState().mode === "guitar" && useStore.getState().started;
  };
  const pluck = async () => { if (await ready()) engine.guitar(4); };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.matches("input,textarea,select") || e.target.isContentEditable)) return;
      if (e.code === "Space" && e.target instanceof HTMLElement && e.target.closest("button")) return;
      if (e.code !== "KeyF" && e.code !== "Space") return;
      e.preventDefault(); if (e.repeat) return;
      if (e.code === "KeyF") {
        fret("key", true);
        void ready().then(ok => { if (ok) engine.guitar(1, pressure()); });
      } else void pluck();
    };
    const up = (e: KeyboardEvent) => { if (e.code === "KeyF") fret("key", false); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      const t = engine.latestGuitar;
      setStatus(t ? `${t.fret > 0.99 ? "Fretted F2" : t.fret > 0.01 ? "Light fret touch · damping" : "Open E2"} · ${t.held ? "Plucking finger in contact" : "Plucking finger released"}` : "Open E2 · fingers released");
    }, 100);
    return () => {
      clear(); clearInterval(timer); window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up); window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const canvas = usePhosphor(({ctx, w, h}) => {
    const left = 35, span = w-70, y = h*0.43;
    const t = engine.latestGuitar;
    const line = (points: number[][], color: string, width = 1.2) => {
      ctx.strokeStyle=color; ctx.lineWidth=width; ctx.beginPath();
      points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke();
    };
    ctx.font = '13px Hershey, monospace';
    ctx.fillStyle=V.blue; ctx.fillText("NUT",left,y-55); ctx.fillText("BRIDGE",w-85,y-55);
    line([[left,y-35],[w-35,y-35],[w-35,y+35],[left,y+35],[left,y-35]], V.blueDim);
    line([[left,y-40],[left,y+40]], V.blue,3);
    line([[w-35,y-40],[w-35,y+40]], V.blue,3);
    const fx = left+span*14/256;
    line([[fx,y-32],[fx,y+32]],V.blue,3);
    ctx.fillText("FRET 1",left,y+60);
    // All displacement is in metres; display gain is intentionally explicit below.
    if (t) {
      const env = Math.min(70,t.envelope*18000);
      ctx.globalAlpha=0.18;
      line(Array.from({length:65},(_,i)=>[left+span*i/64,y+Math.sin(Math.PI*i/64)*env]),V.amber);
      line(Array.from({length:65},(_,i)=>[left+span*i/64,y-Math.sin(Math.PI*i/64)*env]),V.amber);
      ctx.globalAlpha=1;
    }
    line(Array.from({length:257},(_,i)=>[left+span*i/256,y+(t?.displacement[i] ?? 0)*18000]),V.amber,1.8);
    const hand = (x: number, tipY: number, below: boolean, color: string) => {
      const s = below ? 1 : -1;
      // Index finger joins a palm with curled remaining fingers and a thumb.
      line([[x-12,tipY+s*95],[x-12,tipY+s*12],[x-8,tipY+s*3],[x,tipY],
        [x+9,tipY+s*7],[x+11,tipY+s*48],[x+23,tipY+s*38],
        [x+34,tipY+s*42],[x+37,tipY+s*63],[x+46,tipY+s*50],
        [x+58,tipY+s*56],[x+62,tipY+s*93],[x+50,tipY+s*117],
        [x+3,tipY+s*117],[x-23,tipY+s*91],[x-28,tipY+s*63],
        [x-20,tipY+s*59],[x-12,tipY+s*75]],V.blue);
      ctx.strokeStyle=color; ctx.beginPath(); ctx.arc(x,tipY,11,0,Math.PI*2);ctx.stroke();
    };
    hand(fx, y+22*(1-(t?.fret ?? (fretted ? 1 : 0))),true,V.green);
    const px=left+span*(t?.position ?? 0.8);
    hand(px,y+(t?.held ? t.pull*18000 : -22),false,V.pink);
    ctx.fillStyle=V.amber; ctx.fillText("VIBRATION 18 PX/MM · ENVELOPE",left,h-30);
  });
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const role=pointers.current.get(e.pointerId);
    if (!role) return;
    const r=e.currentTarget.getBoundingClientRect();
    if (role === "fret") {
      const amount=Math.max(0,Math.min(1,1-(e.clientY-r.top-r.height*0.43-12)/45));
      fret(`pointer${e.pointerId}`,true,amount); return;
    }
    const x=(e.clientX-r.left-35)/(r.width-70);
    const displacement=(e.clientY-r.top-r.height*0.43)/18000;
    pullTarget.current={x,displacement};
    engine.guitar(2,x,displacement,1);
  };
  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const role=pointers.current.get(e.pointerId); pointers.current.delete(e.pointerId);
    if (role === "fret") fret(`pointer${e.pointerId}`,false);
    if (role === "pluck") engine.guitar(3);
  };
  return <Screen title="Guitar" sub="One string · two fingers" className="s-guitar">
    <div className="guitar-instrument">
      <p role="status">{status}</p>
      <div className="guitar-canvas">
        <canvas ref={canvas} aria-label="String and two hands: touch the fret at the left, or drag the plucking finger on the right"
          onPointerDown={e => {
            const r=e.currentTarget.getBoundingClientRect();
            const role=e.clientX-r.left < 35+(r.width-70)*0.15 ? "fret" : "pluck";
            if ([...pointers.current.values()].includes(role)) return;
            e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId,role);
            if (role === "fret") fret(`pointer${e.pointerId}`,true);
            move(e);
            const id=e.pointerId;
            void ready().then(ok => {
              if (!ok || !pointers.current.has(id)) return;
              engine.guitar(1,pressure());
              if (role === "pluck") {
                const {x,displacement}=pullTarget.current; engine.guitar(2,x,displacement,1);
              }
            });
          }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}/>
      </div>
      <div className="guitar-controls">
        <button className={`chip slot0${fretted ? " on" : ""}`} aria-pressed={fretted} onClick={() => {
          const on=!fretSources.current.has("button"); fret("button",on);
          void ready().then(ok => { if (ok) engine.guitar(1,pressure()); });
        }}>Hold fret</button>
        <button className="chip slot2" onClick={() => void pluck()}>Pluck</button>
        <button className="chip" onClick={() => { clear(); engine.guitar(5); }}>Mute</button>
      </div>
      <p>Hold F to fret. Pull the right finger away from the string, then release. Space plucks.</p>
      <p>Touch: hold left and pull right. Lower the left finger for a light damping touch. 648 mm · E2 82.41 Hz · bare pickup</p>
      {!started && <button className="primary" onClick={() => void ready()}>Start guitar audio</button>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Screen>;
}
