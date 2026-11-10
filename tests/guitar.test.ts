import { expect, test } from "bun:test";
import { EXAMPLE_BASS_TAB, EXAMPLE_TAB, planTab } from "../src/guitar/tab.ts";
import { wasmModule } from "./harness.ts";
import { CHORDS, DEFAULT_PATTERN, DEFAULT_PROGRESSION, fingerChord, planBass, planGuitar, type GuitarEvent } from "../src/guitar/model.ts";
import { GUITAR_LAYOUT_VERSION, GUITAR_TELE_LEN, readGuitarTelemetry, writeGuitarEvents } from "../src/wasm/guitar-wire.ts";
import { guitarCamera, guitarScreenPoint, muteStringAt, TUNERS, NUT, BRIDGE, STRING_TOP, STRING_GAP, frettingHandPose, handFingers } from "../src/ui/render/guitar.ts";

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
    x.engine_guitar(h,0,1,0,0);
    if(fs===48000)x.engine_guitar(h,11,5,4,0);
    x.engine_set_gate(h,.7);
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

test("right-handed front view keeps mute contacts aligned after mirroring and phone rotation",()=>{
  for(const [w,h] of [[1200,570],[340,540]]) {
    const c=guitarCamera(w,h);
    const neck=guitarScreenPoint(w,h,NUT,STRING_TOP), bridge=guitarScreenPoint(w,h,BRIDGE,STRING_TOP);
    if(c.portrait)expect(neck[1]).toBeLessThan(bridge[1]);
    else expect(neck[0]).toBeGreaterThan(bridge[0]);
    for(let i=0;i<6;i++) {
      const x=c.x+(c.portrait?240+i*13:1000-813)*c.scale;
      const y=c.y+(c.portrait?813:240+i*13)*c.scale;
      expect(guitarScreenPoint(w,h,813,240+i*13)).toEqual([x,y]);
      expect(muteStringAt(w,h,x,y)).toBe(i);
    }
    expect(muteStringAt(w,h,0,0)).toBe(null);
  }
});

test("bass tuner posts run E A D from the nut outward without crossed strings",()=>{
  const bass=TUNERS.slice(0,3),treble=TUNERS.slice(3);
  expect(bass.map(t=>t.post[0])).toEqual([...treble.map(t=>t.post[0])].reverse());
  for(let i=0;i<2;i++) {
    expect(bass[i].post[0]).toBeGreaterThan(bass[i+1].post[0]);
    expect(treble[i].post[0]).toBeLessThan(treble[i+1].post[0]);
  }
  for(const {post,key} of TUNERS)expect(post[0]).toBe(key[0]);
  // At every shared x, the six routes must retain their string order.
  for(let x=56;x<=NUT;x++) {
    const ys=TUNERS.flatMap(({post:[px,py]},i)=>x<px?[]:[py+(STRING_TOP+i*STRING_GAP-py)*(x-px)/(NUT-px)]);
    for(let i=1;i<ys.length;i++)expect(ys[i]).toBeGreaterThanOrEqual(ys[i-1]);
  }
});

test("long fretting reaches paint on top while every preset fingertip reaches its string unobstructed",()=>{
  for(const chord of CHORDS) {
    const p=frettingHandPose(chord.frets), fingers=handFingers(p.x,p.y,p.tips,false,p.barreFinger);
    expect(fingers).toHaveLength(5);
    for(let i=1;i<fingers.length;i++)expect(fingers[i].reach).toBeGreaterThanOrEqual(fingers[i-1].reach);
    for(const finger of fingers) {
      if(finger.finger===0||!chord.fingers?.includes(finger.finger))continue;
      const tip=finger.points.at(-1)!;
      const strings=chord.fingers.flatMap((f,i)=>f===finger.finger?[i]:[]);
      expect(strings.map(i=>STRING_TOP+i*STRING_GAP)).toContain(tip[1]);
      for(const other of fingers) {
        if(other===finger)continue;
        for(let i=1;i<other.points.length;i++) {
          const [ax,ay]=other.points[i-1], [bx,by]=other.points[i];
          const dx=bx-ax,dy=by-ay;
          const t=Math.max(0,Math.min(1,((tip[0]-ax)*dx+(tip[1]-ay)*dy)/(dx*dx+dy*dy)));
          const distance=Math.hypot(tip[0]-ax-t*dx,tip[1]-ay-t*dy);
          expect(distance,`${chord.name}: finger ${finger.finger} ends on finger ${other.finger}`).toBeGreaterThan(other.finger===0?7.5:6.5);
        }
      }
    }
  }
});

test("tab releases only the selected strings, including simultaneous notes", () => {
  const score = planTab(EXAMPLE_TAB, 120);
  expect(score.duration).toBe(2);
  expect(score.events.filter(e=>e.time===1).map(e=>[e.direction,e.frets[0],e.frets[5]])).toEqual([[2,3,3],[7,3,3]]);
  expect(()=>planTab(EXAMPLE_TAB.replace("0 3 0","0 13 0"),120)).toThrow("Column 5");

  type X={memory:WebAssembly.Memory}&Record<string,(...a:number[])=>number>;
  const x=new WebAssembly.Instance(wasmModule,{}).exports as X;
  const h=x.engine_new(48000);
  try {
    x.engine_guitar(h,0,1,0,0);
    const count=writeGuitarEvents(x.memory.buffer,x.engine_guitar_records(h),score.events);
    x.engine_guitar_schedule(h,count,.35,score.duration,0,120);
    for(let i=0;i<140;i++) x.engine_render(h,128);
    let t=readGuitarTelemetry(x.memory.buffer,x.engine_guitar_telemetry(h));
    expect(t.strokeReleases.filter(n=>n>=0)).toEqual([.35]);
    expect(t.strings[1].fret).toBe(3);
    expect(t.strings[1].rms).toBeGreaterThan(0);
    for(let i=140;i<515;i++) x.engine_render(h,128);
    t=readGuitarTelemetry(x.memory.buffer,x.engine_guitar_telemetry(h));
    expect(t.strokeReleases[0]).toBe(1.35);
    expect(t.strokeReleases[5]).toBe(1.35);
  } finally {
    x.engine_free(h);
  }
});

test("fingerstyle follows each chord's bass and picks the treble strings separately", () => {
  const score=planGuitar(DEFAULT_PROGRESSION,DEFAULT_PATTERN,120,undefined,true);
  const notes=score.events.filter(e=>e.direction!==0);
  expect(notes.slice(0,4).map(e=>[e.time,e.direction])).toEqual([[0,3],[.25,5],[.5,6],[.75,7]]);
  expect(notes.filter(e=>e.step===0 && e.time % 1 === 0).map(e=>e.direction)).toEqual([3,4]);
  expect(notes.find(e=>e.step===1)?.direction).toBe(2);
  const extended=planGuitar([{chord:CHORDS[2],beats:8}],DEFAULT_PATTERN,120,undefined,true);
  expect(extended.events.filter(e=>e.direction!==0 && e.time % 1 === 0).map(e=>e.direction)).toEqual([2,3,4,2]);
  const trebleOnly=planGuitar([{chord:fingerChord([-1,-1,-1,0,0,0]),beats:2}],DEFAULT_PATTERN,120,undefined,true);
  expect(trebleOnly.events.filter(e=>e.direction!==0).map(e=>e.direction)).toEqual([5,6,7]);
});

test("bass tab and accompaniment only address the four bass strings", () => {
  const tab = planTab(EXAMPLE_BASS_TAB, 120, true);
  expect(tab.events.map(event => event.direction)).toEqual([2, 3, 4, 3]);
  expect(tab.events.every(event => event.frets.slice(4).every(fret => fret === -1))).toBe(true);
  expect(() => planTab(EXAMPLE_TAB, 120, true)).toThrow("four tab rows");

  const score = planBass([{ chord: CHORDS[3], beats: 4 }, { chord: CHORDS[0], beats: 4 }], 120, 8);
  expect(score.duration).toBe(4);
  expect(score.looping).toBe(false);
  expect(score.events.map(event => event.direction)).toEqual([2, 2, 3, 2, 3, 3, 4, 3]);
  expect(score.events[2].frets).toEqual([-1, 5, -1, -1, -1, -1]);
});
