import { useEffect, useRef, useState } from "react";
import { engine } from "../../audio/AudioEngine.ts";
import { CHORDS, STRING_NAMES, chordByName, fingerChord, type Frets, type StrumDirection } from "../../guitar/model.ts";
import type { GuitarTelemetry } from "../../worklet/protocol.ts";
import { useStore } from "../store.ts";
import { applyChord, playGuitar, stopGuitar, tickGuitar, useGuitar } from "../guitar.ts";
import { DEMO_SONGS, useSing } from "../singing.ts";
import { PRESETS, presetOf } from "../body.ts";
import { usePhosphor } from "../usePhosphor.ts";
import { drawGuitar, muteStringAt } from "../render/guitar.ts";
import { AnatomyView } from "./AnatomyView.tsx";
import { singInfo, singWords } from "./SingPanel.tsx";
import { PianoRoll } from "./PianoRoll.tsx";
import { Chip, Screen } from "./Screen.tsx";

/** Contacts own a string until release. Pointer movement deliberately has no handler. */
export function GuitarPanel() {
  const g=useGuitar();
  const body=useStore(s=>s.body);
  const started=useStore(s=>s.started);
  const startError=useStore(s=>s.startError);
  const demo=useSing(s=>s.demo);
  const [tele,setTele]=useState<GuitarTelemetry|null>(null);
  const [held,setHeld]=useState<number[]>([]);
  const contacts=useRef(new Map<string,number>());
  const epoch=useRef(0);
  const ready=async()=>{
    const current=epoch.current;
    await useStore.getState().start();
    const ok=current===epoch.current&&useStore.getState().mode==="guitar"&&useStore.getState().started;
    if(ok) {
      const s=useGuitar.getState();
      engine.guitar(6,s.guitarLevel,s.singerLevel);
      if(!s.playing)applyChord();
    }
    return ok;
  };
  const mute=(source:string,index:number|null)=>{
    if(index===null)contacts.current.delete(source);else contacts.current.set(source,index);
    const active=[...new Set(contacts.current.values())];
    setHeld(active);
    for(let i=0;i<6;i++)engine.guitar(2,i,active.includes(i)?1:0);
  };
  const clearContacts=()=>{
    epoch.current++;contacts.current.clear();setHeld([]);
    for(let i=0;i<6;i++)engine.guitar(2,i,0);
  };
  const engage=(source:string,index:number)=>{
    mute(source,index);
    void ready().then(ok=>{if(ok&&contacts.current.has(source))mute(source,index);});
  };
  const strum=async(direction:StrumDirection)=>{if(await ready())engine.guitar(4,direction,.8);};
  const stop=()=>{clearContacts();stopGuitar();};
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.code!=="Space"||e.repeat)return;
      if(e.target instanceof HTMLElement&&(e.target.closest("input,textarea,select,button")||e.target.isContentEditable))return;
      e.preventDefault();void strum(e.shiftKey?-1:1);
    };
    const visibility=()=>{if(document.hidden)clearContacts();};
    const timer=setInterval(()=>{tickGuitar();setTele(engine.latestGuitar);},80);
    window.addEventListener("keydown",key);window.addEventListener("blur",clearContacts);document.addEventListener("visibilitychange",visibility);
    return()=>{clearContacts();stopGuitar();clearInterval(timer);window.removeEventListener("keydown",key);window.removeEventListener("blur",clearContacts);document.removeEventListener("visibilitychange",visibility);};
  },[]);
  useEffect(()=>{clearContacts();},[body]);
  const canvas=usePhosphor(({ctx,w,h})=>drawGuitar(ctx,w,h,g.chord,engine.latestGuitar));
  const shown=tele?.strings.length?fingerChord(tele.strings.map(s=>s.fret) as Frets):g.chord;
  const beat=tele?.playing?Math.max(0,tele.playhead)*tele.bpm/60:0;
  const updateStep=(i:number,patch:Partial<(typeof g.progression)[number]>)=>useGuitar.setState({progression:g.progression.map((s,k)=>k===i?{...s,...patch}:s)});
  const end=(e:React.PointerEvent<HTMLElement>)=>mute(`p${e.pointerId}`,null);
  const choose=(frets:Frets)=>{g.setChord(fingerChord(frets));void ready();};
  return <div className="guitar-workspace">
    <Screen title="Acoustic guitar" sub="Six strings · two hands" className="s-guitar">
      <div className="guitar-instrument">
        <div className="guitar-status" role="status">
          <span className="guitar-chord-name">{shown.name}</span>
          <span>{tele?.playing?`Bar ${Math.floor(beat/4)+1} · beat ${Math.floor(beat%4)+1}`:"Ready to play"}</span>
          <span>{held.length?`${held.length} string${held.length===1?"":"s"} muted`:"Touch holds a string quiet"}</span>
        </div>
        <div className="guitar-canvas">
          <canvas ref={canvas} aria-label="Six-string acoustic guitar with two five-finger hands. Hold a string near the picking hand to mute it."
            onPointerDown={e=>{
              const r=e.currentTarget.getBoundingClientRect();
              const index=muteStringAt(r.width,r.height,e.clientX-r.left,e.clientY-r.top);
              if(index===null)return;
              e.currentTarget.setPointerCapture(e.pointerId);
              engage(`p${e.pointerId}`,index);
            }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}/>
        </div>
        <div className="guitar-controls">
          <Chip tone="slot2" toggle={false} onClick={()=>void strum(1)}>Strum down ↓</Chip>
          <Chip tone="slot2" toggle={false} onClick={()=>void strum(-1)}>Strum up ↑</Chip>
          <Chip toggle={false} onClick={stop}>Stop all</Chip>
        </div>
        <p className="dim">Space strums down · Shift+Space strums up. Hold a string or its Mute control to damp it; release stays quiet.</p>
        {!started&&<button className="primary" onClick={()=>void ready()}>Start guitar audio</button>}
        {(startError||g.error)&&<p role="alert">{startError||g.error}</p>}
      </div>
    </Screen>
    <div className="guitar-editors">
      <Screen title="Chords" sub="Shape the fretting hand" className="s-guitar-chords">
        <div className="guitar-editor-body">
          <div className="guitar-chord-pads" role="group" aria-label="Chord presets">
            {CHORDS.map(c=><Chip key={c.name} tone="slot0" on={g.chord.name===c.name} onClick={()=>{g.setChord(c);void ready();}}>{c.name}</Chip>)}
          </div>
          <div className="guitar-string-controls" role="group" aria-label="String controls">
            {STRING_NAMES.map((name,i)=><div className="guitar-string-row" key={name}>
              <label htmlFor={`guitar-fret-${i}`}>{name}</label>
              <select id={`guitar-fret-${i}`} aria-label={`${name} fret`} value={g.chord.frets[i]} onChange={e=>{
                const frets=[...g.chord.frets] as Frets;frets[i]=Number(e.target.value);choose(frets);
              }}><option value={-1}>× Skip</option><option value={0}>Open</option>{Array.from({length:12},(_,f)=><option key={f+1} value={f+1}>Fret {f+1}</option>)}</select>
              <Chip toggle={false} aria-label={`Pluck ${name}`} onClick={()=>void ready().then(ok=>{if(ok)engine.guitar(3,i,.8);})}>Pluck</Chip>
              <Chip className="guitar-hold" tone="slot3" on={held.includes(i)} aria-label={`Hold mute ${name}`}
                onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);engage(`p${e.pointerId}`,i);}}
                onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
                onKeyDown={e=>{if((e.code==="Space"||e.code==="Enter")&&!e.repeat){e.preventDefault();engage(`k${i}`,i);}}}
                onKeyUp={e=>{if(e.code==="Space"||e.code==="Enter"){e.preventDefault();mute(`k${i}`,null);}}}
                onBlur={()=>mute(`k${i}`,null)}>Mute</Chip>
            </div>)}
          </div>
          {g.chord.frets.some((f,i)=>f>0&&!g.chord.fingers?.[i])&&<p className="dim">Amber contacts exceed four fretting fingers; the custom chord still plays.</p>}
          <div className="guitar-mix">
            <label>Guitar <input aria-label="Guitar level" type="range" min={0} max={1} step={.01} value={g.guitarLevel} onChange={e=>g.setLevels(Number(e.target.value),g.singerLevel)}/></label>
            <label>Singer <input aria-label="Singer level" type="range" min={0} max={1} step={.01} value={g.singerLevel} onChange={e=>g.setLevels(g.guitarLevel,Number(e.target.value))}/></label>
          </div>
        </div>
      </Screen>
      <Screen title="Accompaniment" sub="Chords on the audio clock" className="s-guitar-score">
        <div className="guitar-editor-body">
          <div className="guitar-transport">
            <button className="primary" onClick={()=>{
              if(g.playing)stop();
              else void playGuitar(()=>useStore.getState().start(),()=>useStore.getState().body,()=>useStore.getState().mode==="guitar"&&useStore.getState().started);
            }}>{g.starting?"Cancel start":g.playing?"Stop accompaniment":"Play accompaniment"}</button>
            <label>Tempo <input aria-label="Guitar tempo" type="number" min={40} max={200} value={g.bpm} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))useGuitar.setState({bpm:Math.max(40,Math.min(200,n))});}}/> BPM</label>
          </div>
          <div className="guitar-rhythm" role="group" aria-label="Strumming pattern">
            {g.pattern.map((direction,i)=><button key={i} className={`chip${direction?" on":""}`} aria-label={`Strum step ${i+1}: ${direction===1?"down":direction===-1?"up":"rest"}`} onClick={()=>{
              const pattern=g.pattern.slice();pattern[i]=direction===1?-1:direction===-1?0:1;useGuitar.setState({pattern});
            }}><small>{i%2?"&":i/2+1}</small><span>{direction===1?"↓":direction===-1?"↑":"–"}</span></button>)}
          </div>
          <ol className="guitar-progression" aria-label="Chord progression">
            {g.progression.map((s,i)=><li key={i} className={tele?.playing&&tele.step===i?"playing":""}>
              <span className="dim">{i+1}</span>
              <select aria-label={`Chord ${i+1}`} value={s.chord.name} onChange={e=>updateStep(i,{chord:e.target.value==="Custom"?{...g.chord,name:"Custom"}:chordByName(e.target.value)})}>
                {CHORDS.map(c=><option key={c.name}>{c.name}</option>)}<option value="Custom">Custom shape</option>
              </select>
              <label><input aria-label={`Chord ${i+1} beats`} type="number" min={1} max={16} value={s.beats} onChange={e=>updateStep(i,{beats:Math.max(1,Math.min(16,Math.round(Number(e.target.value)||1)))})}/> beats</label>
              <button className="chip" disabled={g.progression.length===1} aria-label={`Remove chord ${i+1}`} onClick={()=>useGuitar.setState({progression:g.progression.filter((_,k)=>i!==k)})}>×</button>
            </li>)}
          </ol>
          <Chip toggle={false} disabled={g.progression.length>=32} onClick={()=>useGuitar.setState({progression:[...g.progression,{chord:g.chord,beats:4}]})}>Add current chord</Chip>
          <p className="dim">{g.playing?"Tempo, rhythm, and progression edits play on the next start.":g.singer?"The progression follows the song, repeating as needed.":"The progression loops until stopped."}</p>
          <label className="guitar-singer-toggle"><input type="checkbox" checked={g.singer} onChange={e=>g.setSinger(e.target.checked)}/> With singer</label>
          {g.singer&&<div className="guitar-song-controls">
            <label>Song <select aria-label="Guitar singer song" value={g.song} onChange={e=>g.setSong(e.target.value)}>{DEMO_SONGS.map(s=><option key={s.name}>{s.name}</option>)}</select></label>
            <label>Voice <select aria-label="Guitar singer voice" value={presetOf(body)??"custom"} onChange={e=>useStore.getState().setBody(PRESETS[e.target.value as keyof typeof PRESETS])}>{!presetOf(body)&&<option value="custom" disabled>Blended</option>}<option value="male">Male</option><option value="female">Female</option><option value="child">Child</option></select></label>
          </div>}
        </div>
      </Screen>
    </div>
    {g.singer&&<Screen title="Singer" sub={demo??g.song} className="s-guitar-singer">
      <div className="guitar-singer-view">
        <div className="guitar-singer-face"><AnatomyView info={singInfo} overlay={singWords}/></div>
        <div className="guitar-singer-score"><div className="guitar-piano-roll"><PianoRoll/></div><p>{DEMO_SONGS.find(s=>s.name===g.song)?.lyrics}</p></div>
      </div>
    </Screen>}
  </div>;
}
