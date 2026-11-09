import * as THREE from "three";
import { ArticulatedArm } from "./articulated-hand.ts";
import { V } from "../colors.ts";
import type { DrumTelemetry } from "../../worklet/protocol.ts";
import { DRUM_SURFACES, DrummerMotion, drumLeg } from "./drummer-motion.ts";

// Display rates (rad/s), damping (1/s), and peak rim deflections (m).
const CYMBAL_MOTION = [[49, 12, .048], [30, 3.8, .095], [37, 5.5, .065]];

/** Metres, +y up. All limbs are solved by the constrained, continuous motion rig. */
export class Drummer {
  readonly group = new THREE.Group();
  readonly motion=new DrummerMotion();
  private geometries: THREE.BufferGeometry[] = [];
  private blue = new THREE.LineBasicMaterial({ color: new THREE.Color(V.blue).convertLinearToSRGB().multiplyScalar(.55), transparent: true, opacity: .75 });
  private amber = new THREE.LineBasicMaterial({ color: new THREE.Color(V.amber).convertLinearToSRGB().multiplyScalar(.8) });
  private arms: ArticulatedArm[] = [];
  private armMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(V.blue).convertLinearToSRGB().multiplyScalar(.45),
    wireframe: true, transparent: true, opacity: .7, depthWrite: false,
  });
  private legs: THREE.Line[] = [];
  private hands: THREE.Group[] = [];
  private sticks: THREE.Line[] = [];
  private cymbals: {
    geometry: THREE.BufferGeometry;
    rest: Float32Array;
    radius: number;
    material: THREE.LineBasicMaterial;
    top: THREE.Group;
  }[] = [];
  private membranes: {geometry:THREE.BufferGeometry;rest:Float32Array;radius:number;y:number;id:number;material:THREE.LineBasicMaterial}[]=[];
  private wires: {geometry:THREE.BufferGeometry;rest:Float32Array}[]=[];
  readonly performerMount = new THREE.Group();
  nod=0;
  private footboards: THREE.Group[] = [];
  private kickBeater = new THREE.Group();
  private kickLink!: THREE.Line;
  private hatLink!: THREE.Line;
  constructor() {
    const line = (points: number[][], parent = this.group, material = this.blue) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
      this.geometries.push(geometry);
      const object = new THREE.Line(geometry, material); parent.add(object); return object;
    };
    const ring = (radius: number, y: number, parent: THREE.Group, material = this.blue) => line(
      Array.from({length: 49}, (_, i) => [radius*Math.cos(i*Math.PI/24), y, radius*Math.sin(i*Math.PI/24)]), parent, material);
    const stand = (x: number, y: number, z: number) => {
      line([[x,.02,z],[x,y,z]]);
      for(let i=0;i<3;i++) { const a=i*2*Math.PI/3; line([[x,.18,z],[x+.15*Math.cos(a),.015,z+.15*Math.sin(a)]]); }
    };
    DRUM_SURFACES.forEach((s,id)=>{
      const [x,y,z]=s.position;
      if(id>=5) {
        stand(x,y,z);
        const cymbal = new THREE.Group();
        cymbal.position.set(x, y, z);
        this.group.add(cymbal);
        const top = new THREE.Group();
        top.name = `cymbal-top-${id}`;
        cymbal.add(top);
        const material = this.amber.clone();
        material.transparent = true;
        const points: number[] = [];
        const vertex = (r: number, angle: number) => {
          points.push(s.radius * r * Math.cos(angle), .022 * (1 - r) / .65, s.radius * r * Math.sin(angle));
        };
        // The bell is fixed to the stand. Rings and segmented spokes show the plate bending.
        ring(s.radius * .35, .022, top, this.amber);
        for (const r of [.56, .78, 1]) {
          for (let i = 0; i < 48; i++) {
            vertex(r, i * Math.PI / 24);
            vertex(r, (i + 1) * Math.PI / 24);
          }
        }
        for (let i = 0; i < 16; i++) {
          for (let j = 0; j < 6; j++) {
            vertex(.35 + .65 * j / 6, i * Math.PI / 8);
            vertex(.35 + .65 * (j + 1) / 6, i * Math.PI / 8);
          }
        }
        const rest = Float32Array.from(points);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(rest.slice(), 3));
        const plate = new THREE.LineSegments(geometry, material);
        plate.name = `cymbal-plate-${id}`;
        top.add(plate);
        this.geometries.push(geometry);
        this.cymbals.push({ geometry, rest, radius: s.radius, material, top });
        if (id === 5) ring(s.radius, -.004, cymbal, this.amber);
        return;
      }
      const mount=new THREE.Group();mount.position.set(x,y,z);if(s.kick)mount.rotation.x=Math.PI/2;this.group.add(mount);
      for(const h of [-s.depth/2,s.depth/2]) {
        ring(s.radius,h,mount);ring(s.radius*.94,h,mount);
        // Many short segments let the membrane bend between its fixed rim vertices.
        const points:number[]=[];
        for(let axis=0;axis<2;axis++)for(let row=-5;row<=5;row++) {
          const offset=s.radius*row/6, half=Math.sqrt(s.radius*s.radius-offset*offset);
          for(let j=0;j<20;j++)for(const k of [j,j+1]) {
            const a=-half+2*half*k/20;
            points.push(axis===0?a:offset,h,axis===0?offset:a);
          }
        }
        const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
        this.geometries.push(geometry);
        const material=this.blue.clone();const head=new THREE.LineSegments(geometry,material);head.name=`drum-head-${id}`;mount.add(head);
        this.membranes.push({geometry,rest:Float32Array.from(points),radius:s.radius,y:h,id,material});
      }
      for(let i=0;i<10;i++){const a=i*Math.PI/5,px=s.radius*Math.cos(a),pz=s.radius*Math.sin(a);line([[px,-s.depth/2,pz],[px,s.depth/2,pz]],mount);}
      if(id!==0)stand(x,y-s.depth/2,z);
      if(id===1)for(let i=0;i<24;i++) {
        const wire=line(Array.from({length:21},(_,j)=>[(i-11.5)*.004,-s.depth/2-.005,-.15+j*.015]),mount,this.amber);
        wire.name=`snare-wire-${i}`;
        this.wires.push({geometry:wire.geometry,rest:Float32Array.from(wire.geometry.getAttribute("position").array)});
      }
    });
    // Throne and pedals. Legs keep their femur/tibia lengths while the ankles press.
    stand(0,.39,-.30);ring(.12,.39,this.group);
    for (const [i, x] of [-.29, .14].entries()) {
      const pedal = new THREE.Group();
      pedal.name = `drum-pedal-${i}`;
      pedal.position.set(x, .02, .035);
      this.group.add(pedal);
      this.footboards.push(pedal);
      line([[-.037, 0, 0], [.037, 0, 0], [.031, 0, .18], [-.031, 0, .18], [-.037, 0, 0]], pedal, this.amber);
      line([[x - .052, .012, .02], [x + .052, .012, .02],
        [x + .052, .012, .24], [x - .052, .012, .24], [x - .052, .012, .02]]);
    }
    this.kickBeater.name = "kick-beater";
    this.kickBeater.position.set(.14, .065, .224);
    this.group.add(this.kickBeater);
    line([[.09, .015, .224], [.09, .065, .224], [.19, .065, .224], [.19, .015, .224]]);
    line([[0, 0, 0], [0, .225, 0]], this.kickBeater, this.amber);
    for (let axis = 0; axis < 3; axis++) {
      line(Array.from({ length: 25 }, (_, i) => {
        const angle = i * Math.PI / 12;
        const a = .018 * Math.cos(angle), b = .018 * Math.sin(angle);
        if (axis === 0) return [0, .225 + a, b];
        if (axis === 1) return [a, .225, b];
        return [a, .225 + b, 0];
      }), this.kickBeater, this.amber);
    }
    this.kickLink = line([[0, 0, 0], [0, 0, 0]], this.group, this.amber);
    this.hatLink = line([[0, 0, 0], [0, 0, 0]], this.group, this.amber);
    for(let i=0;i<2;i++)this.legs.push(line(Array.from({length:4},()=>[0,0,0])));
    // Place the shared torso at the seated rig's shoulder midpoint.
    this.performerMount.rotation.z = Math.PI;
    this.performerMount.position.set(.58, .495, -.09);
    this.group.add(this.performerMount);
    for(let i=0;i<2;i++) {
      const arm = new ArticulatedArm(this.armMaterial);
      this.arms.push(arm);
      this.group.add(arm.group);
      this.sticks.push(line([[0,0,0],[0,0,0]],this.group,this.amber));
      const palm=new THREE.Group();palm.scale.x=i===0?-1:1;this.hands.push(palm);this.group.add(palm);
      line([[-.025,0,-.025],[.025,0,-.025],[.025,0,.035],[-.025,0,.035],[-.025,0,-.025]],palm);
      // The shaft crosses the curled fingers diagonally, toward the thumb and index.
      for (let f = 0; f < 4; f++) {
        const x = -.017 + f * .011;
        const z = -x;
        line([[x, 0, .032], [x + .009, -.007, z + .009],
          [x + .008, -.016, z], [x - .006, -.009, z - .006]], palm);
      }
      line([[-.025, 0, -.005], [-.033, .012, .014], [-.020, .007, .020]], palm);
      palm.name = `drum-grip-${i}`;
      this.sticks[i].name = `drum-stick-${i}`;
    }
    this.update(null,0,0);
  }
  private points(line:THREE.Line,points:THREE.Vector3[]) {
    const pos=line.geometry.getAttribute("position") as THREE.BufferAttribute;
    points.forEach((p,i)=>pos.setXYZ(i,p.x,p.y,p.z));pos.needsUpdate=true;
    line.geometry.computeBoundingSphere();
  }
  update(tele:DrumTelemetry|null,clock:number,dt:number):void {
    const pose=this.motion.update(tele,clock,dt);
    pose.forEach((arm,i)=>{
      this.arms[i].update(arm);
      this.points(this.sticks[i],[arm.butt,arm.tip]);
      this.hands[i].position.copy(arm.wrist);
      const side = i === 0 ? 1 : -1;
      const thumbAxis = new THREE.Vector3(side, 0, 1).normalize();
      this.hands[i].quaternion.setFromUnitVectors(thumbAxis, arm.direction);
    });
    const beat=tele?.playing?(clock-tele.start)*tele.bpm/60:0;
    const smooth=1-Math.exp(-12*Math.min(.1,dt));
    const desiredNod=tele?.enabled&&tele.playing?.045*Math.sin(beat*Math.PI*2):0;
    this.nod+=(desiredNod-this.nod)*smooth;
    const nextKick = tele?.enabled && tele.next[0] >= 0 ? tele.next[0] - clock : Infinity;
    const kickAge = tele?.enabled && tele.last[0] >= 0 ? clock - tele.last[0] : Infinity;
    const approach = 1 - THREE.MathUtils.smoothstep(nextKick, 0, .075);
    const rebound = 1 - THREE.MathUtils.smoothstep(kickAge, 0, .13);
    const kickTravel = Math.max(approach, rebound);
    const hatTravel = tele?.hatTravel ?? .8;
    const gap = tele?.hatGap ?? 0;
    const pressure = (tele?.hatPressure ?? 15) / 35;
    const contactAngle = Math.asin((.25 - .224 - .018) / .225);
    this.kickBeater.rotation.x = THREE.MathUtils.lerp(-.72, contactAngle, kickTravel)
      + (tele?.kickCompression ?? 0) / .225;

    for (const [i, travel] of [hatTravel, kickTravel].entries()) {
      const board = this.footboards[i];
      board.rotation.x = -(.11 + .10 * (1 - travel));
      const leg = drumLeg(i === 0 ? -1 : 1, .018 * (1 - travel));
      this.points(this.legs[i], [leg.hip, leg.knee, leg.ankle, leg.toe]);
      const toe = new THREE.Vector3(board.position.x, .02 - Math.sin(board.rotation.x) * .18,
        .035 + Math.cos(board.rotation.x) * .18);
      const linkage = i === 0 ? new THREE.Vector3(-.43, .14 + gap, .32) : new THREE.Vector3(.14, .088, .224);
      this.points(i === 0 ? this.hatLink : this.kickLink, [toe, linkage]);
    }
    for (const { id, geometry, rest, radius, y, material } of this.membranes) {
      const hit = tele?.enabled ? tele.last[id] : -1;
      // The kick is struck on its rear head, facing the pedal.
      const struck = id === 0 ? y < 0 : y > 0;
      const age = clock - hit - (struck ? 0 : .018);
      const strength = hit >= 0 && age >= 0 && age < .48 ? tele!.strength[id] : 0;
      const modes = tele?.modes[id];
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        const x = rest[i * 3] / radius;
        const z = rest[i * 3 + 2] / radius;
        const r = Math.min(1, Math.hypot(x, z));
        const edge = 1 - r * r;
        const distance = id === 0 ? Math.hypot(x - .14 / radius, z) : r;
        const travel = age - distance * .085;
        // The center caves inward, then the pulse travels toward the fixed rim.
        const wave = strength && travel > 0 ? Math.sin(travel * 52) * Math.exp(-travel * 12) : 0;
        const modal = strength && modes ? (modes[0] + modes[1] * x + modes[2] * z + modes[3] * (2 * r * r - 1)) * .008 : 0;
        const compression = id === 0 && struck && distance < .24 ? (tele?.kickCompression ?? 0) * (1 - distance / .24) : 0;
        const flex = strength * (radius * .29 * wave + modal) * (struck ? 1 : .68) + compression;
        position.setY(i, y - Math.sign(y) * edge * flex);
      }
      position.needsUpdate = true;
      material.opacity = .58 + .42 * strength * Math.exp(-Math.max(age, 0) * 14);
    }
    this.cymbals.forEach(({ geometry, rest, radius, material, top }, i) => {
      const id = i + 5;
      const stickHit = tele?.enabled ? tele.last[id] : -1;
      const closure = i === 0 && tele?.enabled ? tele.hatClose : -1;
      const hit = Math.max(stickHit, closure);
      const age = clock - hit;
      const strength = hit >= 0 && age >= 0 && age < 1.5 ? (closure > stickHit ? .32 : tele!.strength[id]) : 0;
      // The closed hat settles quickly, the crash swings wide, and the ride is stiffer.
      const [rate, freeDamping, freeDepth] = CYMBAL_MOTION[i];
      const damping = i === 0 ? freeDamping + pressure * 14 - 6 * Math.min(1, gap / .002) : freeDamping;
      const depth = i === 0 ? freeDepth * (1 - .65 * pressure) : freeDepth;
      if (i === 0) top.position.y = gap;
      const envelope = strength * depth * Math.exp(-Math.max(age, 0) * damping);
      const swing = Math.sin(age * rate) * envelope;
      const ripple = Math.sin(age * rate * 1.8) * envelope * .36;
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let j = 0; j < position.count; j++) {
        const x = rest[j * 3] / radius;
        const z = rest[j * 3 + 2] / radius;
        const rim = Math.max(0, (Math.hypot(x, z) - .35) / .65);
        const y = rest[j * 3 + 1] + rim * rim * (z * swing + (x * x - z * z) * ripple);
        position.setY(j, i === 0 ? Math.max(-gap, y) : y);
      }
      position.needsUpdate = true;
      material.opacity = .76 + .24 * strength * Math.exp(-Math.max(age, 0) * damping);
    });
    this.wires.forEach((wire,i)=>{
      const pos=wire.geometry.getAttribute("position") as THREE.BufferAttribute;
      const displacement=tele?.enabled?THREE.MathUtils.clamp((tele.wires[i]??0)*.7,-.008,.008):0;
      for(let j=0;j<pos.count;j++)pos.setY(j,wire.rest[j*3+1]+displacement*Math.sin(j*Math.PI/20)*Math.cos(j*.7+i));
      pos.needsUpdate=true;
    });
  }
  dispose():void {this.arms.forEach(arm => arm.dispose());this.armMaterial.dispose();this.geometries.forEach(g=>g.dispose());this.membranes.forEach(m=>m.material.dispose());this.cymbals.forEach(c=>c.material.dispose());this.blue.dispose();this.amber.dispose();}
}
