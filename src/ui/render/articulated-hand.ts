import * as THREE from "three";
import type { HandPlan } from "../../guitar/physical.ts";
import type { frettingArm } from "./guitar-hand.ts";
import { palmBones } from "./hand-palm.ts";

type Arm = ReturnType<typeof frettingArm>;

function poseBone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const delta = b.clone().sub(a);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.y = delta.length();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
}

export class ArticulatedArm {
  readonly group = new THREE.Group();
  private readonly upper: THREE.Mesh;
  private readonly forearm: THREE.Mesh;
  private readonly elbow: THREE.Mesh;

  constructor(material: THREE.Material) {
    this.upper = new THREE.Mesh(new THREE.CylinderGeometry(.028, .034, 1, 10), material);
    this.forearm = new THREE.Mesh(new THREE.CylinderGeometry(.014, .027, 1, 10), material);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(.028, 12, 8), material);
    this.group.add(this.upper, this.forearm, this.elbow);
  }

  update({ shoulder, elbow, wrist }: Pick<Arm, "shoulder" | "elbow" | "wrist">) {
    poseBone(this.upper, shoulder, elbow);
    poseBone(this.forearm, elbow, wrist);
    this.elbow.position.copy(elbow);
  }

  dispose() {
    this.upper.geometry.dispose();
    this.forearm.geometry.dispose();
    this.elbow.geometry.dispose();
  }
}

/** Both hands share carpal, metacarpal and phalange topology; only their poses differ. */
export class ArticulatedHand {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly joints: THREE.Mesh[][] = [];
  private readonly fingers: THREE.Mesh[][] = [];
  private readonly metacarpals: THREE.Mesh[] = [];
  private readonly arm: ArticulatedArm;
  private readonly palm: THREE.Mesh;
  private readonly carpal: THREE.Mesh;

  constructor(private readonly material: THREE.Material) {
    const mesh = (geometry: THREE.BufferGeometry) => {
      this.geometries.push(geometry);
      const m = new THREE.Mesh(geometry,material);this.group.add(m);return m;
    };
    const sphere = (radius: number) => mesh(new THREE.SphereGeometry(radius,12,8));
    const bone = (radius: number, tip = radius*.85) => mesh(new THREE.CylinderGeometry(tip,radius,1,10));
    this.arm = new ArticulatedArm(material);
    this.group.add(this.arm.group);
    this.palm=sphere(1);this.carpal=sphere(1);
    for(let f=0;f<5;f++) {
      const radii = f===0 ? [.0055,.006,.0055,.0045] : [.007,.0057,.0045,.0038];
      this.joints[f]=radii.map(sphere);
      this.fingers[f]=radii.slice(0,3).map((r,i)=>f===0&&i===0?bone(.004,.004):bone(r,radii[i+1]));
      this.metacarpals[f]=bone(.0035,.0035);
      this.metacarpals[f].visible=f!==0;
    }
  }

  update(fingers: HandPlan["fingers"], arm: Arm) {
    this.arm.update(arm);
    // Broad carpals support separate metacarpals, rather than five rods meeting at one point.
    const basis = new THREE.Matrix4().makeBasis(arm.palmSide,arm.palmForward,arm.palmNormal);
    const bones=palmBones(fingers,arm.palmForward);
    const carpalCenter=new THREE.Vector3();
    for(const bone of bones)if(bone.finger>0)carpalCenter.add(bone.from);
    carpalCenter.multiplyScalar(.25);
    this.palm.quaternion.setFromRotationMatrix(basis);
    this.palm.position.copy(carpalCenter).lerp(arm.knuckles,.53);
    this.palm.scale.set(.031,carpalCenter.distanceTo(arm.knuckles)*.48,.011);
    this.carpal.quaternion.copy(this.palm.quaternion);
    this.carpal.position.copy(carpalCenter).lerp(arm.wrist,.5);
    this.carpal.scale.set(.022,Math.max(.014,carpalCenter.distanceTo(arm.wrist)*.55),.011);
    for(const bone of bones)if(bone.finger>0)poseBone(this.metacarpals[bone.finger],bone.from,bone.to);
    for(const finger of fingers) {
      const f=finger.finger, points=finger.points.map(p=>new THREE.Vector3(...p));
      points.forEach((p,i)=>this.joints[f][i].position.copy(p));
      for(let i=0;i<3;i++)poseBone(this.fingers[f][i],points[i],points[i+1]);
    }
  }

  dispose() {this.arm.dispose();this.geometries.forEach(g=>g.dispose());}
}
