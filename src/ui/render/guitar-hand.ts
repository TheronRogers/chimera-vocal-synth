import { Quaternion, Vector3 } from "three";
import type { HandPlan } from "../../guitar/physical.ts";

/** Drop of the instrument below the upright performer's torso, in metres. */
export const PERFORMER_GUITAR_DROP = .32;
export const PERFORMER_GUITAR_TILT = Math.PI / 7.5;

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
  return { ...arm, knuckles: center, forward, side, normal,
    palmForward: new Vector3(0,-1,0), palmSide: new Vector3(1,0,0), palmNormal: new Vector3(0,0,-1) };
}

/** The same phalange lengths as the fretting solver, from index to little finger. */
export const FINGER_LENGTHS = [[.044,.026,.019],[.048,.029,.020],[.045,.028,.020],[.036,.023,.018]] as const;

/** Place the pick tip or the bare index fingertip at the supplied anchor. */
export function pickingPose(handedness: 1 | -1 = 1, deviation = 0, tip?: Vector3, bareHand = false) {
  const wrist = new Vector3(.65, -.040, .070);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), Math.PI/3)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0), .04 + deviation));
  const point = (p: Vector3) => p.clone().setX(p.x * handedness).applyQuaternion(rotation).add(wrist);
  const fingers: HandPlan["fingers"] = [];
  for (let f = 0; f < 4; f++) {
    let p = new Vector3([-.024,-.008,.009,.024][f], [.075,.080,.076,.065][f], 0);
    const points = [p.clone()];
    const angles = bareHand ? [0.60,1.25,2.85] : f === 0 ? [1.22,2.36,3.49] : [1.10,2.40,3.10];
    FINGER_LENGTHS[f].forEach((length,j) => {
      p = p.clone().add(new Vector3(0, length*Math.cos(angles[j]), -length*Math.sin(angles[j])));
      points.push(p);
    });
    fingers.push({finger:f+1,barre:false,points:points.map(p=>point(p).toArray())});
  }
  // Oppose the index around the pick, or extend the thumb toward the bass strings.
  const indexTip = new Vector3(...fingers[0].points[3]);
  const localIndex = indexTip.clone().sub(wrist).applyQuaternion(rotation.clone().invert());
  localIndex.x *= handedness;
  const thumbTip = !bareHand
    ? localIndex.clone().add(new Vector3(-.006,0,.006))
    : new Vector3(-.072,.082,-.023);
  const thumbBase = new Vector3(-.036,bareHand ? .030 : .005,.002);
  const distal = Math.hypot(.018,.016);
  const thumbIP = thumbTip.clone().add(new Vector3(0,distal*.5,distal*Math.sqrt(3)/2));
  const thumb = solveArm(thumbBase,thumbIP,new Vector3(-.060,bareHand ? .085 : .060,.045),.045,.035);
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
  if (tip) {
    const contact = bareHand ? indexTip : pick[2];
    const shift = tip.clone().sub(contact);
    wrist.add(shift);
    knuckles.add(shift);
    grip.add(shift);
    pick.forEach(p => p.add(shift));
    for (const finger of fingers) {
      finger.points = finger.points.map(p => new Vector3(...p).add(shift).toArray());
    }
  }
  return {wrist,forward,side,normal,palmForward:forward,palmSide:side,palmNormal:normal,knuckles,fingers,pick,grip,pickNormal,rotation};
}

/** Fit the curled hand to the strings, then move only the digits that are plucking. */
export function fingerstylePose(anchor: Vector3, contacts: readonly {digit: number; point: Vector3; amount: number}[], restingStringY: (string: number) => number) {
  const pose = pickingPose(1, -.20, anchor, true);
  const fitTip = (digit: number, point: Vector3, amount: number) => {
    const finger = pose.fingers.find(f => f.finger === digit)!;
    const joints = finger.points.map(p => new Vector3(...p));
    const root = joints[0].clone();
    const lengths = joints.slice(1).map((p, i) => p.distanceTo(joints[i]));
    const target = joints[3].clone().lerp(point, amount);
    const reach = lengths.reduce((sum, length) => sum + length, 0);
    if (root.distanceTo(target) >= reach) {
      const axis = target.clone().sub(root).normalize();
      for (let i = 1; i < 4; i++) joints[i].copy(joints[i-1]).addScaledVector(axis, lengths[i-1]);
    } else {
      const axis = new Vector3();
      for (let iteration = 0; iteration < 12 && joints[3].distanceToSquared(target) > 1e-10; iteration++) {
        joints[3].copy(target);
        for (let i = 2; i >= 0; i--) {
          axis.subVectors(joints[i], joints[i+1]).setLength(lengths[i]);
          joints[i].copy(joints[i+1]).add(axis);
        }
        joints[0].copy(root);
        for (let i = 1; i < 4; i++) {
          axis.subVectors(joints[i], joints[i-1]).setLength(lengths[i-1]);
          joints[i].copy(joints[i-1]).add(axis);
        }
      }
    }
    finger.points = joints.map(p => p.toArray());
  };
  // The thumb floats over A, centered in its three-string range. Keep the little finger curled free.
  for (const [digit, string] of [[0, 1], [1, 3], [2, 4], [3, 5]]) {
    fitTip(digit, new Vector3(anchor.x, restingStringY(string), anchor.z), 1);
  }
  for (const {digit, point, amount} of contacts) fitTip(digit, point, amount);
  return pose;
}

/** Interpolate the pick tip through the audio engine's string release points. */
export function strokeTip(clock: number, releases: readonly number[], stringPoint: (index: number) => Vector3, idle: Vector3) {
  const contacts = releases.flatMap((time, index) => time >= 0 ? [{time, index}] : [])
    .sort((a, b) => a.time - b.time);
  if (!contacts.length) return idle;
  const first = contacts[0];
  const last = contacts[contacts.length - 1];
  const lift = .022;
  const lead = .025;
  const recovery = .075;
  if (clock < first.time - lead || clock > last.time + recovery) return idle;
  if (clock <= first.time) {
    const phase = (clock - first.time + lead) / lead;
    const tip = idle.clone().lerp(stringPoint(first.index), phase);
    tip.z += lift * Math.sin(Math.PI * phase);
    return tip;
  }
  for (let i = 1; i < contacts.length; i++) {
    const from = contacts[i - 1], to = contacts[i];
    if (clock > to.time) continue;
    const phase = (clock - from.time) / (to.time - from.time);
    const tip = stringPoint(from.index).lerp(stringPoint(to.index), phase);
    if (Math.abs(to.index - from.index) > 1) tip.z += lift * Math.sin(Math.PI * phase);
    return tip;
  }
  const phase = (clock - last.time) / recovery;
  const tip = stringPoint(last.index).lerp(idle, phase);
  tip.z += lift * Math.sin(Math.PI * phase);
  return tip;
}

/** The right elbow rests by the upper bout, with the forearm reaching toward the soundhole. */
export function pickingArm(pose: ReturnType<typeof pickingPose>, shoulder = performerShoulder(.74)) {
  // Move the elbow outside the upper bout as the wrist reaches inward.
  const reach = Math.max(0, Math.min(1, (.64 - pose.wrist.x) / .04));
  return solveArm(shoulder, pose.wrist, new Vector3(.82, -.26 - .16 * reach, .12));
}
