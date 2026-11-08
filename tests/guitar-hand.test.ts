import { beforeAll, expect, test } from "bun:test";
import { Vector3 } from "three";
import { initEngine } from "./harness.ts";
import { CHORDS, type Frets } from "../src/guitar/model.ts";
import type { HandPlan } from "../src/guitar/physical.ts";
import { call } from "../src/wasm/chimera.ts";
import { frettingArm, solveArm, performerShoulder, pickingPose, pickingArm } from "../src/ui/render/guitar-hand.ts";

beforeAll(initEngine);

test("fretting arm follows low and high grips with fixed bones and a relaxed wrist", () => {
  for (const chord of CHORDS) for (const shift of [0, 5, 8]) {
    const frets = chord.frets.map(f => f > 0 ? f + shift : f) as Frets;
    // Keep the same finger identities as the authored grip, including its barre.
    const plan = call<HandPlan>("guitarHand", { frets, fingers: chord.fingers });
    expect(plan.valid, `${chord.name} + ${shift}`).toBe(true);
    const arm = frettingArm(plan);
    expect(arm.reachable).toBe(true);
    expect(arm.shoulder.distanceTo(arm.elbow)).toBeCloseTo(.29, 9);
    expect(arm.elbow.distanceTo(arm.wrist)).toBeCloseTo(.24, 9);
    expect(arm.elbow.y).toBeGreaterThan(arm.wrist.y);
    const forearm = arm.wrist.clone().sub(arm.elbow).normalize();
    expect(forearm.angleTo(arm.forward), `${chord.name} wrist`).toBeLessThan(Math.PI / 4);
    expect(arm.wrist.y).toBeGreaterThan(arm.knuckles.y);
    expect(arm.side.dot(arm.forward)).toBeCloseTo(0, 9);
    expect(arm.normal.length()).toBeCloseTo(1, 9);
  }
});

test("arm IK keeps its lengths for unreachable, folded and collinear targets", () => {
  const shoulder = new Vector3(.3, -.035, -.18);
  for (const target of [new Vector3(4, 0, 0), shoulder.clone(), new Vector3(.3, .2, -.18)]) {
    const arm = solveArm(shoulder, target, shoulder);
    expect(arm.shoulder.distanceTo(arm.elbow)).toBeCloseTo(.29, 9);
    expect(arm.elbow.distanceTo(arm.wrist)).toBeCloseTo(.24, 9);
    expect([...arm.elbow.toArray(), ...arm.wrist.toArray()].every(Number.isFinite)).toBe(true);
  }
});

test("a lower guitar keeps the performer's fretting wrist on the strings with fixed bones", () => {
  for (const chord of CHORDS) for (const shift of [0, 5, 8]) {
    const frets = chord.frets.map(f => f > 0 ? f + shift : f) as Frets;
    const plan = call<HandPlan>("guitarHand", { frets, fingers: chord.fingers });
    const original = frettingArm(plan);
    const raisedShoulder = performerShoulder(.42);
    const performer = frettingArm(plan, raisedShoulder);
    expect(performer.reachable, `${chord.name} + ${shift}`).toBe(true);
    expect(performer.shoulder.equals(raisedShoulder)).toBe(true);
    expect(performer.wrist.distanceTo(original.wrist)).toBeLessThan(1e-9);
    expect(performer.shoulder.distanceTo(performer.elbow)).toBeCloseTo(.29, 9);
    expect(performer.elbow.distanceTo(performer.wrist)).toBeCloseTo(.24, 9);
  }
});

test("pick hands mirror the same bones and keep thumb and index pinching the pick", () => {
  const fretting=call<HandPlan>("guitarHand",{frets:CHORDS[0].frets,fingers:CHORDS[0].fingers});
  for(const deviation of [-.2,0,.2]) {
    const right=pickingPose(1,deviation),left=pickingPose(-1,deviation);
    const inverse=right.rotation.clone().invert();
    for(const finger of right.fingers) {
      const mirror=left.fingers.find(f=>f.finger===finger.finger)!;
      for(let i=0;i<4;i++) {
        const a=new Vector3(...finger.points[i]).sub(right.wrist).applyQuaternion(inverse);
        const b=new Vector3(...mirror.points[i]).sub(left.wrist).applyQuaternion(inverse);
        expect(a.x).toBeCloseTo(-b.x,9);
        expect(a.y).toBeCloseTo(b.y,9);expect(a.z).toBeCloseTo(b.z,9);
        if(i>0) {
          const length=new Vector3(...finger.points[i]).distanceTo(new Vector3(...finger.points[i-1]));
          const counterpart=fretting.fingers.find(f=>f.finger===finger.finger)!;
          const frettingLength=new Vector3(...counterpart.points[i]).distanceTo(new Vector3(...counterpart.points[i-1]));
          expect(length).toBeCloseTo(frettingLength,9);
        }
      }
    }
    const thumb=new Vector3(...right.fingers.find(f=>f.finger===0)!.points[3]);
    const index=new Vector3(...right.fingers.find(f=>f.finger===1)!.points[3]);
    expect(thumb.distanceTo(index)).toBeGreaterThan(.006);
    expect(thumb.distanceTo(index)).toBeLessThan(.010);
    expect(right.grip.distanceTo(thumb)).toBeCloseTo(right.grip.distanceTo(index),9);
    for(const p of right.pick)expect(Math.abs(p.clone().sub(right.grip).dot(right.pickNormal))).toBeLessThan(1e-9);
    const arm=pickingArm(right);
    expect(arm.reachable).toBe(true);
    expect(arm.wrist.clone().sub(arm.elbow).angleTo(right.forward)).toBeLessThan(Math.PI/4);
    expect(arm.elbow.x).toBeGreaterThan(.75);
    expect(arm.elbow.y).toBeGreaterThan(-.20);
    expect(arm.shoulder.distanceTo(arm.elbow)).toBeCloseTo(.29,9);
    expect(arm.elbow.distanceTo(arm.wrist)).toBeCloseTo(.24,9);
  }
});
