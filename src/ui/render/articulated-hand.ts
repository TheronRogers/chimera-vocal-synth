import * as THREE from "three";
import type { HandPlan } from "../../guitar/physical.ts";
import type { frettingArm } from "./guitar-hand.ts";

type Arm = ReturnType<typeof frettingArm>;

/** Both hands share carpal, metacarpal and phalange topology; only their poses differ. */
export class ArticulatedHand {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly joints: THREE.Mesh[][] = [];
  private readonly fingers: THREE.Mesh[][] = [];
  private readonly metacarpals: THREE.Mesh[] = [];
  private readonly upper: THREE.Mesh;
  private readonly forearm: THREE.Mesh;
  private readonly elbow: THREE.Mesh;
  private readonly palm: THREE.Mesh;
  private readonly carpal: THREE.Mesh;

  constructor(private readonly material: THREE.Material) {
    const mesh = (geometry: THREE.BufferGeometry) => {
      this.geometries.push(geometry);
      const m = new THREE.Mesh(geometry,material);this.group.add(m);return m;
    };
    const sphere = (radius: number) => mesh(new THREE.SphereGeometry(radius,12,8));
    const bone = (radius: number, tip = radius*.85) => mesh(new THREE.CylinderGeometry(tip,radius,1,10));
    this.upper=bone(.034,.028);this.forearm=bone(.027,.014);this.elbow=sphere(.028);
    this.palm=sphere(1);this.carpal=sphere(1);
    for(let f=0;f<5;f++) {
      const radii = f===0 ? [.008,.007,.006,.0055] : [.007,.0057,.0045,.0038];
      this.joints[f]=radii.map(sphere);
      this.fingers[f]=radii.slice(0,3).map((r,i)=>bone(r,radii[i+1]));
      this.metacarpals[f]=bone(f===0?.006:.0045,.005);
    }
  }

  private bone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    const delta=b.clone().sub(a);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.scale.y=delta.length();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  }

  update(fingers: HandPlan["fingers"], arm: Arm) {
    this.bone(this.upper,arm.shoulder,arm.elbow);this.bone(this.forearm,arm.elbow,arm.wrist);
    this.elbow.position.copy(arm.elbow);
    // Broad carpals support separate metacarpals, rather than five rods meeting at one point.
    const basis = new THREE.Matrix4().makeBasis(arm.side,arm.forward,arm.normal);
    this.palm.quaternion.setFromRotationMatrix(basis);
    this.palm.position.copy(arm.wrist).lerp(arm.knuckles,.53);
    this.palm.scale.set(.031,arm.wrist.distanceTo(arm.knuckles)*.45,.011);
    this.carpal.quaternion.copy(this.palm.quaternion);
    this.carpal.position.copy(arm.wrist).addScaledVector(arm.forward,.009);
    this.carpal.scale.set(.019,.014,.011);
    for(const finger of fingers) {
      const f=finger.finger, points=finger.points.map(p=>new THREE.Vector3(...p));
      const root=arm.wrist.clone().addScaledVector(arm.forward,.015)
        .addScaledVector(arm.side,f===0?-.016:(f-2.5)*.009);
      this.bone(this.metacarpals[f],root,points[0]);
      points.forEach((p,i)=>this.joints[f][i].position.copy(p));
      for(let i=0;i<3;i++)this.bone(this.fingers[f][i],points[i],points[i+1]);
    }
  }

  dispose() {this.geometries.forEach(g=>g.dispose());}
}
