import { beforeAll, expect, test } from "bun:test";
import { Vector3 } from "three";
import { initEngine } from "./harness.ts";
import { CHORDS, type Frets } from "../src/guitar/model.ts";
import type { HandPlan } from "../src/guitar/physical.ts";
import { call } from "../src/wasm/chimera.ts";
import { frettingArm, solveArm } from "../src/ui/render/guitar-hand.ts";

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
