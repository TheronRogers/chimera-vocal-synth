import { Quaternion, Vector3 } from "three";
import type { HandPlan } from "../../guitar/physical.ts";

/** Fixed metacarpal lengths and a common palm axis keep the shafts from scissoring. */
export const METACARPAL_LENGTHS = [.063,.066,.061,.050] as const;
export interface PalmBone { finger: number; from: Vector3; to: Vector3; radius: number }

const rad=(degrees: number)=>degrees*Math.PI/180;
/** Conservative generic adult animation envelope, rather than a per-person clinical model. */
export const HAND_LIMITS = {
  mcpFlex: [-rad(30),rad(90)], mcpSpread:[rad(30),rad(20),rad(30),rad(40)],
  pip:rad(110),dip:rad(80),thumbMcp:rad(70),thumbIp:rad(90),
} as const;

function limitDirection(from: Vector3,to: Vector3,max: number): Vector3 {
  const angle=from.angleTo(to);
  return angle<=max?to:from.clone().applyQuaternion(new Quaternion().slerp(
    new Quaternion().setFromUnitVectors(from,to),max/angle));
}

/** Interpolate a whole palm; phalanges keep their lengths and each IP joint stays a hinge. */
export function interpolateHand(previous: HandPlan,target: HandPlan,phase: number): HandPlan {
  const p=structuredClone(target);
  p.palm=p.palm.map((v,i)=>v*phase+previous.palm[i]*(1-phase));
  for(const finger of p.fingers) {
    const old=previous.fingers.find(f=>f.finger===finger.finger)!;
    let base=new Vector3(...old.points[0]).lerp(new Vector3(...finger.points[0]),phase);
    if(finger.finger>0)base.z+=.020*Math.sin(Math.PI*phase);
    const directions:Vector3[]=[],lengths:number[]=[];
    for(let j=1;j<4;j++) {
      const to=new Vector3(...finger.points[j]).sub(new Vector3(...finger.points[j-1]));
      const from=new Vector3(...old.points[j]).sub(new Vector3(...old.points[j-1]));
      lengths.push(to.length());from.normalize();to.normalize();
      directions.push(from.applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(from,to),phase)));
    }
    if(finger.finger>0) {
      const d=directions[0],spread=HAND_LIMITS.mcpSpread[finger.finger-1];
      const yaw=Math.max(-spread,Math.min(spread,Math.atan2(d.x,-d.y)));
      const pitch=Math.max(HAND_LIMITS.mcpFlex[0],Math.min(HAND_LIMITS.mcpFlex[1],Math.atan2(d.z,Math.hypot(d.x,d.y))));
      directions[0]=new Vector3(Math.cos(pitch)*Math.sin(yaw),-Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch));
    }
    directions[1]=limitDirection(directions[0],directions[1],finger.finger===0?HAND_LIMITS.thumbMcp:HAND_LIMITS.pip);
    if(finger.finger>0) {
      let axis=new Vector3().crossVectors(directions[0],directions[1]);
      if(axis.lengthSq()<1e-10)axis=new Vector3(0,0,1).cross(directions[0]);
      axis.normalize();
      const distal=directions[2].clone().addScaledVector(axis,-directions[2].dot(axis)).normalize();
      const bend=Math.atan2(axis.dot(new Vector3().crossVectors(directions[1],distal)),directions[1].dot(distal));
      directions[2]=directions[1].clone().applyAxisAngle(axis,Math.max(0,Math.min(HAND_LIMITS.dip,bend)));
    }else directions[2]=limitDirection(directions[1],directions[2],HAND_LIMITS.thumbIp);
    finger.points=[base.toArray()];
    directions.forEach((d,j)=>{base=base.clone().addScaledVector(d,lengths[j]);finger.points.push(base.toArray());});
  }
  return p;
}

export function palmBones(fingers: HandPlan["fingers"], forward: Vector3): PalmBone[] {
  return fingers.map(f=> {
    const to=new Vector3(...f.points[f.finger===0?1:0]);
    // The thumb's first link already IS its metacarpal; don't invent a second wrist spoke.
    const from=f.finger===0?new Vector3(...f.points[0]):
      to.clone().addScaledVector(forward,-METACARPAL_LENGTHS[f.finger-1]);
    return {finger:f.finger,from,to,radius:f.finger===0?.006:.0035};
  });
}

/** Exact closest approach of two bone centre-line segments, including their endpoints. */
export function segmentDistance(a: Vector3,b: Vector3,c: Vector3,d: Vector3): number {
  const u=b.clone().sub(a),v=d.clone().sub(c),w=a.clone().sub(c);
  const aa=u.dot(u),bb=u.dot(v),cc=v.dot(v),dd=u.dot(w),ee=v.dot(w);
  const den=aa*cc-bb*bb;
  let s=den>1e-12?Math.max(0,Math.min(1,(bb*ee-cc*dd)/den)):0;
  let t=cc>1e-12?(bb*s+ee)/cc:0;
  if(t<0){t=0;s=aa>1e-12?Math.max(0,Math.min(1,-dd/aa)):0;}
  else if(t>1){t=1;s=aa>1e-12?Math.max(0,Math.min(1,(bb-dd)/aa)):0;}
  return w.addScaledVector(u,s).addScaledVector(v,-t).length();
}
