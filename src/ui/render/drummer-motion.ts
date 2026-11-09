import * as THREE from "three";
import type { DrumTelemetry } from "../../worklet/protocol.ts";

export const DRUM_SURFACES = [
  {position:[0,.29,.42], radius:.28, depth:.34, kick:true},
  {position:[-.18,.50,.22], radius:.18, depth:.13},
  {position:[-.16,.70,.30], radius:.13, depth:.20},
  {position:[.14,.70,.30], radius:.16, depth:.22},
  {position:[.38,.46,.24], radius:.21, depth:.32},
  {position:[-.43,.81,.32], radius:.18, depth:0},
  {position:[-.32,.98,.38], radius:.23, depth:0},
  {position:[.43,.91,.32], radius:.26, depth:0},
];
export const ARM = {upper:.29, forearm:.24, minFlex:12*Math.PI/180, maxFlex:140*Math.PI/180,
  maxWrist:75*Math.PI/180, speed:2.4, acceleration:32, stick:.28};
const UP=new THREE.Vector3(0,1,0);
const clamp=THREE.MathUtils.clamp;
export const drumHand=(id:number)=>[2,5,6].includes(id)?0:1;
export const shoulder=(side:number)=>new THREE.Vector3(side*.16,.85,-.27);
export function shoulderAllowed(upper:THREE.Vector3,side:number):boolean {
  return upper.y<=ARM.upper*.574+1e-8 && upper.z>=-.145-1e-8 && side*upper.x>=-.19-1e-8;
}
/** Exact two-bone IK with a stable outward/downward elbow pole and bounded shoulder cone. */
export function drumArm(target:THREE.Vector3,side:number) {
  const origin=shoulder(side), delta=target.clone().sub(origin);
  delta.x=clamp(delta.x,-.48,.48); delta.y=clamp(delta.y,-.48,.28); delta.z=clamp(delta.z,.20,.58);
  const length=(flex:number)=>Math.sqrt(ARM.upper**2+ARM.forearm**2+2*ARM.upper*ARM.forearm*Math.cos(flex));
  const distance=clamp(delta.length(),length(ARM.maxFlex),length(ARM.minFlex));
  delta.normalize();
  const wrist=origin.clone().addScaledVector(delta,distance);
  const along=(ARM.upper**2-ARM.forearm**2+distance**2)/(2*distance);
  const radius=Math.sqrt(Math.max(0,ARM.upper**2-along**2));
  const center=origin.clone().addScaledVector(delta,along);
  const pole=new THREE.Vector3(side,-.6,-.45);
  pole.addScaledVector(delta,-pole.dot(delta));
  if(pole.lengthSq()<1e-10)pole.copy(UP).addScaledVector(delta,-delta.y);
  if(pole.lengthSq()<1e-10)pole.set(side,0,0);
  pole.normalize();
  const tangent=new THREE.Vector3().crossVectors(delta,pole).normalize();
  let elbow=center.clone().addScaledVector(pole,radius);
  if(!shoulderAllowed(elbow.clone().sub(origin),side)) {
    // Search away from the previous pole in both directions; fine steps avoid hinge flips.
    outer:for(let degree=1;degree<=180;degree++) for(const sign of [-1,1]) {
      const a=sign*degree*Math.PI/180;
      const candidate=center.clone().addScaledVector(pole,radius*Math.cos(a)).addScaledVector(tangent,radius*Math.sin(a));
      if(shoulderAllowed(candidate.clone().sub(origin),side)){elbow=candidate;break outer;}
    }
  }
  return {shoulder:origin,elbow,wrist};
}
function contact(id:number):THREE.Vector3 {
  const s=DRUM_SURFACES[id], p=new THREE.Vector3(...s.position);
  p.y+=s.depth/2;
  // Strike the near edge of cymbals, within a seated player's reach.
  if(id>=5)p.z-=s.radius*.55;
  return p;
}
const REST=[new THREE.Vector3(-.28,.69,-.10),new THREE.Vector3(.22,.67,-.08)];
export class DrummerMotion {
  private wrists=REST.map(v=>v.clone());
  private velocities=[new THREE.Vector3(),new THREE.Vector3()];
  private directions=[new THREE.Vector3(0,-.35,1).normalize(),new THREE.Vector3(0,-.35,1).normalize()];
  /** dt is integrated in small steps; pausing, frame drops and new targets cannot teleport hands. */
  update(tele:DrumTelemetry|null,clock:number,dt:number) {
    return [0,1].map(hand=>{
      const side=hand===0?-1:1;
      let next=-1,last=-1;
      if(tele?.enabled) for(let id=1;id<8;id++) if(drumHand(id)===hand) {
        if(tele.next[id]>=clock-.015 && (next<0 || tele.next[id]<tele.next[next]))next=id;
        if(tele.last[id]>=0 && tele.last[id]<=clock && (last<0 || tele.last[id]>tele.last[last]))last=id;
      }
      const upcoming=next>=0?tele!.next[next]-clock:Infinity;
      const age=last>=0?clock-tele!.last[last]:Infinity;
      const id=upcoming<.42?next:age<.32?last:-1;
      const tip=id>=0?contact(id):REST[hand].clone().add(new THREE.Vector3(0,-.10,.25));
      const direction=new THREE.Vector3(side*.025,-.12,.25).normalize();
      const desired=tip.clone().addScaledVector(direction,-ARM.stick);
      const feasible=drumArm(desired,side).wrist;
      const wrist=this.wrists[hand], velocity=this.velocities[hand];
      let remaining=clamp(Number.isFinite(dt)?dt:0,0,.1);
      while(remaining>1e-8) {
        const step=Math.min(remaining,1/240);
        const acceleration=feasible.clone().sub(wrist).multiplyScalar(750).addScaledVector(velocity,-52).clampLength(0,ARM.acceleration);
        velocity.addScaledVector(acceleration,step).clampLength(0,ARM.speed);
        wrist.addScaledVector(velocity,step);
        remaining-=step;
      }
      const arm=drumArm(wrist,side);
      // All constraints act on the target before integration; this only removes roundoff.
      wrist.copy(arm.wrist);
      const forearm=arm.wrist.clone().sub(arm.elbow).normalize();
      let desiredDirection=tip.clone().sub(wrist).normalize();
      // The arm positions the wrist. Wrist rotation supplies the stroke and rebound.
      if (id >= 0) {
        const windup = clamp((upcoming - .012) / .075, 0, 1);
        const rebound = clamp((age - .018) / .065, 0, 1);
        const hinge = new THREE.Vector3().crossVectors(desiredDirection, UP).normalize();
        desiredDirection.applyAxisAngle(hinge, .34 * Math.min(windup, rebound));
      }
      if(desiredDirection.dot(forearm)<Math.cos(ARM.maxWrist)) {
        const radial=desiredDirection.clone().addScaledVector(forearm,-desiredDirection.dot(forearm)).normalize();
        desiredDirection=forearm.clone().multiplyScalar(Math.cos(ARM.maxWrist)).addScaledVector(radial,Math.sin(ARM.maxWrist));
      }
      const current=this.directions[hand];
      const angle=current.angleTo(desiredDirection), maxTurn=8*clamp(dt,0,.1);
      if(angle>1e-8)current.applyAxisAngle(new THREE.Vector3().crossVectors(current,desiredDirection).normalize(),Math.min(angle,maxTurn));
      // The forearm may rotate while a wrist is settling. Project to the anatomical wrist cone.
      if(current.dot(forearm)<Math.cos(ARM.maxWrist)) {
        const radial=current.clone().addScaledVector(forearm,-current.dot(forearm)).normalize();
        current.copy(forearm).multiplyScalar(Math.cos(ARM.maxWrist)).addScaledVector(radial,Math.sin(ARM.maxWrist));
      }
      return {...arm,tip:wrist.clone().addScaledVector(current,ARM.stick),butt:wrist.clone().addScaledVector(current,-.09),direction:current.clone(),velocity:velocity.clone(),target:id};
    });
  }
}

export const LEG={thigh:.40,shin:.40};
export function drumLeg(side:number,lift:number) {
  const hip=new THREE.Vector3(side*.10,.48,-.30);
  const ankle=new THREE.Vector3(side<0?-.29:.14,.075+clamp(lift,0,.018),.035);
  const axis=ankle.clone().sub(hip),distance=axis.length();axis.normalize();
  const midpoint=hip.clone().add(ankle).multiplyScalar(.5);
  const pole=new THREE.Vector3(side*.1,1,.5);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
  const knee=midpoint.addScaledVector(pole,Math.sqrt(LEG.thigh**2-distance**2/4));
  const toe=ankle.clone().add(new THREE.Vector3(0,-.035,.18));
  return {hip,knee,ankle,toe};
}
