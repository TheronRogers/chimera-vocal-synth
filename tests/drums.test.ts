import { expect, test } from "bun:test";
import { DRUM_LAYOUT_VERSION, DRUM_TELE_LEN, readDrumTelemetry } from "../src/wasm/drum-wire.ts";
import { wasmModule } from "./harness.ts";

test("physical rock kit matches native samples at 44.1 and 48 kHz", async () => {
  type X = {memory:WebAssembly.Memory}&Record<string,(...args:number[])=>number>;
  const x=new WebAssembly.Instance(wasmModule,{}).exports as X;
  const actual=new Float32Array(65536);
  let offset=0;
  for(const fs of [44100,48000]) {
    const h=x.engine_new(fs);
    x.engine_guitar(h,0,1,0,0); x.engine_guitar(h,6,0,0,0); x.engine_guitar(h,8,1,.5,0);
    for(let block=0;block<256;block++) {
      if(block%32===0)x.engine_guitar(h,9,block/32,.8,0);
      actual.set(new Float32Array(x.memory.buffer,x.engine_render(h,128),128),offset);offset+=128;
    }
    x.engine_guitar(h,5,0,0,0);
    const p=x.engine_render(h,128);
    expect(new Float32Array(x.memory.buffer,p,128).every(v=>v===0)).toBe(true);
    x.engine_free(h);
  }
  const native=await Bun.file(new URL("../crates/chimera/tests/golden/drums.f32",import.meta.url)).arrayBuffer();
  expect(new Uint8Array(actual.buffer)).toEqual(new Uint8Array(native));
});


test("queued pad strikes expose prediction, physical head displacement and snare-wire telemetry",()=>{
  type X={memory:WebAssembly.Memory}&Record<string,(...args:number[])=>number>;
  const x=new WebAssembly.Instance(wasmModule,{}).exports as X;
  expect(x.engine_drum_layout_version()).toBe(DRUM_LAYOUT_VERSION);
  expect(x.engine_drum_telemetry_len()).toBe(DRUM_TELE_LEN);
  const h=x.engine_new(48000);x.engine_guitar(h,0,1,0,0);x.engine_guitar(h,6,0,0,0);x.engine_guitar(h,8,1,.5,0);
  const tele=()=>readDrumTelemetry(x.memory.buffer,x.engine_drum_telemetry(h));
  x.engine_guitar(h,9,1,.8,.28);
  expect(tele().next[1]).toBe(.28);expect(tele().last[1]).toBe(-1);
  for(let i=0;i<105;i++)x.engine_render(h,128);
  expect(tele().last[1]).toBe(-1);
  x.engine_render(h,128);expect(tele().last[1]).toBe(.28);
  expect(tele().modes[1].some(v=>Math.abs(v)>1e-5)).toBe(true);
  x.engine_render(h,512);expect(tele().rattle).toBeGreaterThan(0);
  x.engine_guitar(h,5,0,0,0);expect(tele().wires.every(v=>v===0)).toBe(true);
  expect(tele().next.every(v=>v<0)).toBe(true);x.engine_free(h);
});

test("constrained sticks approach the struck surfaces across the supported groove tempos",async()=>{
  const {DrummerMotion,DRUM_SURFACES,drumHand}=await import("../src/ui/render/drummer-motion.ts");
  type X={memory:WebAssembly.Memory}&Record<string,(...args:number[])=>number>;
  for(const bpm of [40,120,200]) {
    const x=new WebAssembly.Instance(wasmModule,{}).exports as X,h=x.engine_new(48000);
    x.engine_guitar(h,0,1,0,0);x.engine_guitar(h,8,1,.5,0);x.engine_guitar_schedule(h,0,.35,240/bpm,1,bpm);
    const rig=new DrummerMotion();let last=Array(8).fill(-1);
    for(let frame=0;frame<180;frame++) {
      const t=readDrumTelemetry(x.memory.buffer,x.engine_drum_telemetry(h)),arms=rig.update(t,t.clock,1/60);
      for(let id=1;id<8;id++)if(t.last[id]>=0&&t.last[id]!==last[id]) {
        const s=DRUM_SURFACES[id],p=arms[drumHand(id)].tip;
        expect(Math.abs(p.y-s.position[1]-s.depth/2)).toBeLessThan(.07);
        expect(Math.hypot(p.x-s.position[0],p.z-s.position[2])).toBeLessThan(s.radius);
      }
      last=t.last;for(let block=0;block<5;block++)x.engine_render(h,160);
    }
    x.engine_free(h);
  }
});

test("layered score hits sound at the same sample and stop clears future hits", () => {
  type X = { memory: WebAssembly.Memory } & Record<string, (...args: number[]) => number>;
  const x = new WebAssembly.Instance(wasmModule, {}).exports as X;
  const h = x.engine_new(48000);
  x.engine_guitar(h, 0, 1, 0, 0);
  x.engine_guitar(h, 8, 1, .5, 0);
  const tele = () => readDrumTelemetry(x.memory.buffer, x.engine_drum_telemetry(h));
  x.engine_drum_score_hit(h, 5, .6, .02);
  x.engine_drum_score_hit(h, 6, .8, .02); // Hi-hat and crash share the manual strike hand.
  x.engine_drum_score_hit(h, 1, .8, .04);
  expect(tele().next.slice(5, 7)).toEqual([.02, .02]);
  for (let i = 0; i < 8; i++) x.engine_render(h, 128);
  expect(tele().last.slice(5, 7)).toEqual([.02, .02]);
  x.engine_guitar(h, 5, 0, 0, 0);
  for (let i = 0; i < 8; i++) x.engine_render(h, 128);
  expect(tele().last[1]).toBe(-1);
  x.engine_free(h);
});
