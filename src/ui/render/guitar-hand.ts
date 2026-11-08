import { Quaternion, Vector3 } from "three";
import type { HandPlan } from "../../guitar/physical.ts";

/** Drop of the instrument below the upright performer's torso, in metres. */
export const PERFORMER_GUITAR_DROP = .26;
export const PERFORMER_GUITAR_TILT = Math.PI / 10;

/** Upright shoulder expressed in the tilted guitar's coordinates, around its soundboard. */
export function performerShoulder(x: number): Vector3 {
  return new Vector3(x - .58, -.035 - PERFORMER_GUITAR_DROP, -.18)
    .applyAxisAngle(new Vector3(0, 0, 1), -PERFORMER_GUITAR_TILT)
    .add(new Vector3(.58, 0, 0));
}

/** Analytic two-bone IK. The pole selects the elbow plane, never a bone length. */
export function solveArm(
  shoulder: Vector3,
  target: Vector3,
  pole: Vector3,
  upperLength = .29,
  forearmLength = .24,
) {
  const axis = target.clone().sub(shoulder);
  const distance = axis.length();
  if (distance < 1e-8) axis.set(0, 1, 0);
  else axis.divideScalar(distance);
  const reach = Math.max(Math.abs(upperLength - forearmLength) + 1e-6,
    Math.min(upperLength + forearmLength - 1e-6, distance));
  const wrist = shoulder.clone().addScaledVector(axis, reach);
  const along = (upperLength ** 2 - forearmLength ** 2 + reach ** 2) / (2 * reach);
  const center = shoulder.clone().addScaledVector(axis, along);
  const bend = pole.clone().sub(center);
  bend.addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < 1e-10) {
    bend.set(Math.abs(axis.x) < .9 ? 1 : 0, Math.abs(axis.x) < .9 ? 0 : 1, 0);
    bend.addScaledVector(axis, -bend.dot(axis));
  }
  const elbow = center.addScaledVector(bend.normalize(),
    Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
  return { shoulder: shoulder.clone(), elbow, wrist, reachable: Math.abs(reach - distance) < 1e-5 };
}

/** The hand leads the wrist; the hanging elbow follows its metacarpal direction. */
export function frettingArm(plan: HandPlan, shoulder = new Vector3(.42, -.035, -.18)) {
  const knuckles = plan.fingers.filter(f => f.finger > 0);
  const center = new Vector3();
  for (const finger of knuckles) center.add(new Vector3(...finger.points[0]));
  center.divideScalar(knuckles.length);
  const wrist = new Vector3(...plan.palm).add(new Vector3(.030, .038, -.018));
  const forward = center.clone().sub(wrist).normalize();
  const index = plan.fingers.find(f => f.finger === 1)!;
  const little = plan.fingers.find(f => f.finger === 4)!;
  const side = new Vector3(...little.points[0]).sub(new Vector3(...index.points[0]));
  side.addScaledVector(forward, -side.dot(forward)).normalize();
  const normal = new Vector3().crossVectors(side, forward).normalize();
  const arm = solveArm(shoulder, wrist,
    wrist.clone().addScaledVector(forward, -.24));
  return { ...arm, knuckles: center, forward, side, normal };
}

/** The same phalange lengths as the fretting solver, from index to little finger. */
export const FINGER_LENGTHS = [[.044,.026,.019],[.048,.029,.020],[.045,.028,.020],[.036,.023,.018]] as const;

/** A right pick grip; -1 reflects the entire anatomy to make the left hand. */
export function pickingPose(handedness: 1 | -1 = 1, deviation = 0, travel = 0) {
  const wrist = new Vector3(.65, -.040 + travel, .070);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), Math.PI/3)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0), .04 + deviation));
  const point = (p: Vector3) => p.clone().setX(p.x * handedness).applyQuaternion(rotation).add(wrist);
  const fingers: HandPlan["fingers"] = [];
  for (let f = 0; f < 4; f++) {
    let p = new Vector3([-.024,-.008,.009,.024][f], [.075,.080,.076,.065][f], 0);
    const points = [p.clone()];
    const angles = f === 0 ? [1.22,2.36,3.49] : [1.10,2.40,3.10];
    FINGER_LENGTHS[f].forEach((length,j) => {
      p = p.clone().add(new Vector3(0, length*Math.cos(angles[j]), -length*Math.sin(angles[j])));
      points.push(p);
    });
    fingers.push({finger:f+1,barre:false,points:points.map(p=>point(p).toArray())});
  }
  // Thumb CMC/MCP/IP chain opposes the folded index pad, with a pick between the pads.
  const indexTip = new Vector3(...fingers[0].points[3]);
  const localIndex = indexTip.clone().sub(wrist).applyQuaternion(rotation.clone().invert());
  localIndex.x *= handedness;
  const thumbTip = localIndex.clone().add(new Vector3(-.006,0,.006));
  const thumbBase = new Vector3(-.030,.020,-.005);
  const thumbIP = thumbTip.clone().sub(new Vector3(0,Math.hypot(.018,.016),0));
  const thumb = solveArm(thumbBase,thumbIP,new Vector3(-.065,.04,-.015),.045,.035);
  fingers.push({finger:0,barre:false,points:[thumbBase,thumb.elbow,thumbIP,thumbTip].map(p=>point(p).toArray())});
  const thumbWorld = point(thumbTip);
  const grip = indexTip.clone().add(thumbWorld).multiplyScalar(.5);
  const pickNormal = thumbWorld.clone().sub(indexTip).normalize();
  const pickForward = new Vector3(0,1,-.5).applyQuaternion(rotation);
  pickForward.addScaledVector(pickNormal,-pickForward.dot(pickNormal)).normalize();
  const pickSide = new Vector3().crossVectors(pickForward,pickNormal).normalize();
  const pick = [grip.clone().addScaledVector(pickSide,.009).addScaledVector(pickForward,-.005),
    grip.clone().addScaledVector(pickSide,-.009).addScaledVector(pickForward,-.005),
    grip.clone().addScaledVector(pickForward,.025)];
  const forward = new Vector3(0,1,0).applyQuaternion(rotation);
  const side = new Vector3(handedness,0,0).applyQuaternion(rotation);
  const normal = new Vector3().crossVectors(side,forward).normalize();
  const knuckles = new Vector3();
  fingers.filter(f=>f.finger>0).forEach(f=>knuckles.add(new Vector3(...f.points[0])));
  knuckles.multiplyScalar(.25);
  return {wrist,forward,side,normal,knuckles,fingers,pick,grip,pickNormal,rotation};
}

/** The right elbow rests by the upper bout, with the forearm reaching toward the soundhole. */
export function pickingArm(pose: ReturnType<typeof pickingPose>, shoulder = performerShoulder(.74)) {
  return solveArm(shoulder,pose.wrist,new Vector3(.88,-.06,-.02));
}
