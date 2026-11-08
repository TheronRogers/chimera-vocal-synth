import { expect, test } from "bun:test";
import { wasmModule } from "./harness.ts";
import { CHORDS, DEFAULT_PATTERN, DEFAULT_PROGRESSION, fingerChord, planGuitar, type GuitarEvent } from "../src/guitar/model.ts";
import { GUITAR_LAYOUT_VERSION, GUITAR_TELE_LEN, readGuitarTelemetry, writeGuitarEvents } from "../src/wasm/guitar-wire.ts";
import { guitarCamera, muteStringAt } from "../src/ui/render/guitar.ts";

test("six-string guitar score and human mix match native audio byte for byte", () => {
  const native=Bun.spawnSync(["cargo","run","-q","--release","-p","chimera-wasm","--example","render_guitar"]);
  expect(native.exitCode).toBe(0);
  type X={memory:WebAssembly.Memory}&Record<string,(...a:number[])=>number>;
  const x=new WebAssembly.Instance(wasmModule,{}).exports as X;
  expect(x.engine_guitar_layout_version()).toBe(GUITAR_LAYOUT_VERSION);
  expect(x.engine_guitar_telemetry_len()).toBe(GUITAR_TELE_LEN);
  const audio=new Float32Array(2*280*128);
  let offset=0;
  const events:GuitarEvent[]=[
    {time:0,frets:[0,2,2,0,0,0],direction:1,strength:.8,step:0},
    {time:.24,frets:[-1,3,2,0,1,0],direction:-1,strength:.7,step:1},
    {time:.5,frets:[1,3,3,2,1,1],direction:1,strength:.8,step:2},
  ];
  for(const fs of [44100,48000]) {
    const h=x.engine_new(fs);
    x.engine_guitar(h,0,1,0,0);x.engine_set_gate(h,.7);
    writeGuitarEvents(x.memory.buffer,x.engine_guitar_records(h),events);
    x.engine_guitar_schedule(h,3,.05,.6,1,100);
    for(let block=0;block<280;block++) {
      if(block===80)x.engine_guitar(h,4,-1,.8,0);
      if(block===110)x.engine_guitar(h,2,2,1,0);
      if(block===125)x.engine_guitar(h,3,2,.8,0);
      if(block===160)x.engine_guitar(h,2,2,0,0);
      if(block===220)x.engine_set_gate(h,0);
      if(block===230)x.engine_guitar(h,5,0,0,0);
      const p=x.engine_render(h,128);
      audio.set(new Float32Array(x.memory.buffer,p,128),offset);offset+=128;
      const at=x.engine_guitar_telemetry(h);
      expect(new Float64Array(x.memory.buffer,at,GUITAR_TELE_LEN).every(Number.isFinite)).toBe(true);
      const t=readGuitarTelemetry(x.memory.buffer,at);
      expect(t.clock).toBe((block+1)*128/fs);
      if(block>235)expect(t.rms).toBe(0);
      if(block===130)expect(t.strings[2].muted).toBe(true);
    }
    x.engine_free(h);
  }
  expect(Buffer.from(audio.buffer).equals(native.stdout)).toBe(true);
  expect(audio.some(s=>Math.abs(s)>.01)).toBe(true);
},120000);

test("progressions retain rests, repeat for the singer, and stop at its last beat",()=>{
  const loop=planGuitar(DEFAULT_PROGRESSION,DEFAULT_PATTERN,84);
  expect(loop.looping).toBe(true);
  expect(loop.duration).toBe(16*60/84);
  expect(loop.events.filter(e=>e.direction===0)).toHaveLength(4);
  expect(loop.events.slice(0,3).map(e=>[e.time,e.direction])).toEqual([[0,0],[0,1],[60/84,1]]);
  const sung=planGuitar([{chord:CHORDS[0],beats:3}],DEFAULT_PATTERN,100,16);
  expect(sung.looping).toBe(false);
  expect(sung.duration).toBe(9.6);
  expect(sung.events.every(e=>e.time<sung.duration)).toBe(true);
  expect(sung.events.filter(e=>e.direction===0)).toHaveLength(6);
  const silent=planGuitar(DEFAULT_PROGRESSION,Array(8).fill(0),100);
  expect(silent.events).toHaveLength(4);
  expect(()=>planGuitar([],DEFAULT_PATTERN,84)).toThrow();
  expect(()=>planGuitar(DEFAULT_PROGRESSION,DEFAULT_PATTERN,NaN)).toThrow();
  expect(planGuitar(Array.from({length:32},()=>({chord:CHORDS[0],beats:16})),Array(8).fill(1),200).events.length).toBeLessThan(2048);
});

test("custom hand assignments keep four fretting fingers and explicit excess contacts",()=>{
  expect(fingerChord([1,3,3,2,1,1]).barre?.finger).toBe(1);
  const custom=fingerChord([1,2,3,4,5,6]);
  expect(custom.fingers).toEqual([1,2,3,4,0,0]);
  expect(custom.name).toBe("Custom");
  expect(fingerChord([2,4,4,3,2,2]).barre?.fret).toBe(2);
});

test("mute hit testing identifies the same string through desktop and portrait cameras",()=>{
  for(const [w,h] of [[1200,570],[340,540]]) {
    const c=guitarCamera(w,h);
    for(let i=0;i<6;i++) {
      const x=c.x+(c.portrait?540-(240+i*13):813)*c.scale;
      const y=c.y+(c.portrait?813:240+i*13)*c.scale;
      expect(muteStringAt(w,h,x,y)).toBe(i);
    }
    expect(muteStringAt(w,h,0,0)).toBe(null);
  }
});
