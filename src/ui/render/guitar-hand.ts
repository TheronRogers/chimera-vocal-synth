import { Vector3 } from "three";
import type { HandPlan } from "../../guitar/physical.ts";

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
export function frettingArm(plan: HandPlan) {
  const knuckles = plan.fingers.filter(f => f.finger > 0);
  const center = new Vector3();
  for (const finger of knuckles) center.add(new Vector3(...finger.points[0]));
  center.divideScalar(knuckles.length);
  const wrist = new Vector3(...plan.palm).add(new Vector3(.030, .038, -.018));
  const forward = center.clone().sub(wrist).normalize();
  const side = new Vector3().crossVectors(forward, new Vector3(0, 0, 1)).normalize();
  const normal = new Vector3().crossVectors(side, forward).normalize();
  const arm = solveArm(new Vector3(.42, -.035, -.18), wrist,
    wrist.clone().addScaledVector(forward, -.24));
  return { ...arm, knuckles: center, forward, side, normal };
}
