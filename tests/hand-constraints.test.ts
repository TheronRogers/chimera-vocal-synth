import { beforeAll, expect, test } from "bun:test";
import { Vector3 } from "three";
import { initEngine } from "./harness.ts";
import { call } from "../src/wasm/chimera.ts";
import { CHORDS, fingerChord, type Frets } from "../src/guitar/model.ts";
import type { HandPlan } from "../src/guitar/physical.ts";
import { frettingArm, pickingArm, pickingPose, PERFORMER_GUITAR_DROP } from "../src/ui/render/guitar-hand.ts";
import { HAND_LIMITS, interpolateHand, palmBones, segmentDistance, METACARPAL_LENGTHS } from "../src/ui/render/hand-palm.ts";

beforeAll(initEngine);
const v=(p:number[])=>new Vector3(...p);
function plan(frets: Frets): HandPlan {
  const p=call<HandPlan>("guitarHand",{frets,fingers:fingerChord(frets).fingers});
  expect(p.valid,`${frets}: ${p.error}`).toBe(true);return p;
}
function joints(fingers: HandPlan["fingers"]) {
  for(const f of fingers) {
    const b=f.points.slice(1).map((p,i)=>v(p).sub(v(f.points[i])).normalize());
    expect(b[0].angleTo(b[1])).toBeLessThanOrEqual((f.finger===0?HAND_LIMITS.thumbMcp:HAND_LIMITS.pip)+1e-8);
    expect(b[1].angleTo(b[2])).toBeLessThanOrEqual((f.finger===0?HAND_LIMITS.thumbIp:HAND_LIMITS.dip)+1e-8);
    if(f.finger>0) {
      expect(Math.abs(Math.atan2(b[0].x,-b[0].y))).toBeLessThanOrEqual(HAND_LIMITS.mcpSpread[f.finger-1]+1e-8);
      const flex=Math.atan2(b[0].z,Math.hypot(b[0].x,b[0].y));
      expect(flex).toBeGreaterThanOrEqual(HAND_LIMITS.mcpFlex[0]-1e-8);
      expect(flex).toBeLessThanOrEqual(HAND_LIMITS.mcpFlex[1]+1e-8);
      expect(Math.abs(b[0].clone().cross(b[1]).dot(b[2]))).toBeLessThan(1e-8);
    }
  }
}
function palm(fingers: HandPlan["fingers"],forward: Vector3) {
  const bones=palmBones(fingers,forward);
  for(const bone of bones)if(bone.finger>0) {
    const delta=bone.to.clone().sub(bone.from);
    expect(delta.length()).toBeCloseTo(METACARPAL_LENGTHS[bone.finger-1],9);
    expect(delta.normalize().dot(forward)).toBeCloseTo(1,9);
  }
  for(let i=0;i<bones.length;i++)for(let j=i+1;j<bones.length;j++) {
    const a=bones[i],b=bones[j];
    expect(segmentDistance(a.from,a.to,b.from,b.to)-a.radius-b.radius,`palm bones ${a.finger}/${b.finger}`).toBeGreaterThan(.001);
    expect(a.to.distanceTo(b.to)).toBeGreaterThanOrEqual((a.finger===0?.006:.007)+(b.finger===0?.006:.007)-1e-9);
  }
}

test("native grips and transitions respect finger hinges and fixed non-crossing palm bones",()=>{
  const chords=[...CHORDS.map(c=>c.frets),[2,4,4,3,2,2] as Frets];
  const plans=chords.map(plan);
  for(const p of plans) {
    const settled=interpolateHand(p,p,1);
    settled.fingers.forEach(f=>f.points.forEach((point,i)=>{
      expect(v(point).distanceTo(v(p.fingers.find(g=>g.finger===f.finger)!.points[i]))).toBeLessThan(1e-8);
    }));
  }
  for(const frets of chords)for(const shift of [0,5,8]) {
    const p=plan(frets.map(f=>f>0?f+shift:f) as Frets);
    joints(p.fingers);palm(p.fingers,frettingArm(p).palmForward);
  }
  for(const from of plans)for(const to of plans)for(let i=0;i<=16;i++) {
    const p=interpolateHand(from,to,i/16);
    joints(p.fingers);palm(p.fingers,frettingArm(p).palmForward);
    p.fingers.forEach(f=>f.points.slice(1).forEach((point,j)=>{
      const original=to.fingers.find(g=>g.finger===f.finger)!;
      expect(v(point).distanceTo(v(f.points[j]))).toBeCloseTo(v(original.points[j+1]).distanceTo(v(original.points[j])),9);
    }));
  }
});

test("palm clearance detects crossed, parallel and degenerate bone segments",()=>{
  expect(segmentDistance(new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(.5,-1,0),new Vector3(.5,1,0))).toBeCloseTo(0,9);
  expect(segmentDistance(new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(0,0,.02),new Vector3(1,0,.02))).toBeCloseTo(.02,9);
  expect(segmentDistance(new Vector3(0,0,0),new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(2,0,0))).toBeCloseTo(1,9);
});

test("mirrored pick palms keep their bones separated throughout the wrist stroke",()=>{
  for(const hand of [-1,1] as const)for(let i=0;i<=64;i++) {
    const phase=i/64,p=pickingPose(hand,.20*Math.sin(phase*Math.PI*2),.008*Math.sin(phase*Math.PI));
    palm(p.fingers,p.palmForward);
    const thumb=p.fingers.find(f=>f.finger===0)!.points.map(v);
    expect(thumb[1].clone().sub(thumb[0]).angleTo(thumb[2].clone().sub(thumb[1]))).toBeLessThanOrEqual(HAND_LIMITS.thumbMcp+1e-8);
    expect(thumb[2].clone().sub(thumb[1]).angleTo(thumb[3].clone().sub(thumb[2]))).toBeLessThanOrEqual(HAND_LIMITS.thumbIp+1e-8);
  }
});

test("the full thickness of the strumming arm clears the extruded guitar throughout both strokes",()=>{
  const g=call<{outline:number[][];depth:number}>("guitarGeometry");
  function distance(p: Vector3) {
    let inside=false,edge=Infinity;
    for(let i=0,j=g.outline.length-1;i<g.outline.length;j=i++) {
      const [ax,ay]=g.outline[j],[bx,by]=g.outline[i],dx=bx-ax,dy=by-ay;
      const t=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.y-ay)*dy)/(dx*dx+dy*dy||1)));
      edge=Math.min(edge,(p.x-ax-t*dx)**2+(p.y-ay-t*dy)**2);
      if((ay>p.y)!==(by>p.y)&&p.x<dx*(p.y-ay)/dy+ax)inside=!inside;
    }
    return Math.hypot(inside?0:Math.sqrt(edge),Math.max(-g.depth-.003-p.z,p.z-.001,0));
  }
  for(const shoulder of [undefined,new Vector3(.74,-.035-PERFORMER_GUITAR_DROP,-.18)])
    for(const direction of [-1,1])for(let i=0;i<=64;i++) {
      const phase=i/64,p=pickingPose(1,direction*.20*Math.sin(phase*Math.PI*2),direction*.008*Math.sin(phase*Math.PI));
      const a=pickingArm(p,shoulder);
      expect(a.reachable).toBe(true);
      expect(a.shoulder.distanceTo(a.elbow)).toBeCloseTo(.29,9);
      expect(a.elbow.distanceTo(a.wrist)).toBeCloseTo(.24,9);
      for(const [from,to,r0,r1] of [[a.shoulder,a.elbow,.034,.028],[a.elbow,a.wrist,.028,.014]] as const)
        for(let k=0;k<=64;k++) {
          const t=k/64;
          expect(distance(from.clone().lerp(to,t))-(r0+(r1-r0)*t)).toBeGreaterThan(.004);
        }
    }
});
