import {expect,test} from "bun:test";
import * as THREE from "three";
import {Drummer} from "../src/ui/render/drummer.ts";
import {ARM,LEG,DrummerMotion,drumArm,drumLeg,shoulderAllowed} from "../src/ui/render/drummer-motion.ts";
import type {DrumTelemetry} from "../src/worklet/protocol.ts";
const tele=():DrumTelemetry=>({clock:0,enabled:true,playing:false,bpm:120,start:0,duration:4,looping:false,rattle:0,kickCompression:0,hatTravel:.8,hatGap:0,hatPressure:15,hatClose:-1,next:Array(8).fill(-1),last:Array(8).fill(-1),strength:Array(8).fill(.8),modes:Array.from({length:8},()=>[0,0,0,0]),wires:Array(24).fill(0)});

test("drummer keeps fixed bones, elbow and shoulder limits, wrist cones, and stick lengths throughout all pad transitions",()=>{
  const rig=new DrummerMotion(),t=tele();
  let old=rig.update(t,0,0);
  let previousMeasured=[new THREE.Vector3(),new THREE.Vector3()];
  for(let frame=1;frame<=3600;frame++) {
    const dt=1/120,clock=frame*dt,id=1+Math.floor(clock/.6)%7;
    t.next.fill(-1);t.next[id]=(Math.floor(clock/.6)+1)*.6;
    if(frame%72===0){t.last[id]=clock;t.next[id]+= .6;}
    if(frame===2000)t.enabled=false;if(frame===2100)t.enabled=true;
    const arms=rig.update(t,clock,dt);
    arms.forEach((a,i)=>{
      const upper=a.elbow.clone().sub(a.shoulder),fore=a.wrist.clone().sub(a.elbow);
      const flex=upper.angleTo(fore);
      expect(upper.length()).toBeCloseTo(ARM.upper,9);expect(fore.length()).toBeCloseTo(ARM.forearm,9);
      expect(flex).toBeGreaterThanOrEqual(ARM.minFlex-1e-7);expect(flex).toBeLessThanOrEqual(ARM.maxFlex+1e-7);
      expect(shoulderAllowed(upper,i===0?-1:1)).toBe(true);
      expect(a.direction.angleTo(fore)).toBeLessThanOrEqual(ARM.maxWrist+1e-7);
      expect(a.tip.distanceTo(a.wrist)).toBeCloseTo(ARM.stick,9);
      expect(a.tip.distanceTo(a.butt)).toBeCloseTo(.37,9);
      expect(a.wrist.distanceTo(old[i].wrist)).toBeLessThanOrEqual(ARM.speed*dt+1e-7);
      expect(a.elbow.distanceTo(old[i].elbow)).toBeLessThan(.045);
      expect(a.tip.distanceTo(old[i].tip)).toBeLessThan(.06);
      expect(a.velocity.clone().sub(old[i].velocity).length()).toBeLessThanOrEqual(ARM.acceleration*dt+1e-6);
      const measured=a.wrist.clone().sub(old[i].wrist).divideScalar(dt);
      expect(measured.clone().sub(previousMeasured[i]).length()/dt).toBeLessThan(ARM.acceleration+.1);
      previousMeasured[i]=measured;
    });old=arms;
  }
});

test("stop, dropped frames and adversarial target changes never teleport drummer hands",()=>{
  const rig=new DrummerMotion(),t=tele();let clock=0,old=rig.update(null,clock,0);
  for(let i=0;i<500;i++) {
    const dt=i%13===0?.1:1/60;clock+=dt;t.next.fill(-1);t.next[1+i%7]=clock+.05;
    const arms=rig.update(i%17===0?null:t,clock,dt);
    arms.forEach((a,h)=>{
      expect(a.wrist.distanceTo(old[h].wrist)).toBeLessThanOrEqual(ARM.speed*dt+1e-6);
      expect(Number.isFinite(a.elbow.length())).toBe(true);
      expect(a.elbow.distanceTo(old[h].elbow)).toBeLessThan(6*dt);
      expect(a.tip.distanceTo(old[h].tip)).toBeLessThan(8*dt);
    });old=arms;
  }
});

test("leg bones and pedal motion stay within seated human knee and ankle ranges",()=>{
  for(const side of [-1,1])for(let i=0;i<=100;i++) {
    const leg=drumLeg(side,i*.00018);
    const thigh=leg.knee.clone().sub(leg.hip),shin=leg.ankle.clone().sub(leg.knee);
    expect(thigh.length()).toBeCloseTo(LEG.thigh,10);expect(shin.length()).toBeCloseTo(LEG.shin,10);
    expect(thigh.angleTo(shin)).toBeGreaterThan(.3);expect(thigh.angleTo(shin)).toBeLessThan(2.5);
    expect(shin.angleTo(leg.toe.clone().sub(leg.ankle))).toBeLessThan(1.8);
  }
  // Degenerate/unreachable arm requests still have finite, fixed bones.
  for(const target of [new THREE.Vector3(),new THREE.Vector3(99,99,99)]) {
    const a=drumArm(target,1);
    expect(a.shoulder.distanceTo(a.elbow)).toBeCloseTo(ARM.upper,9);
    expect(a.elbow.distanceTo(a.wrist)).toBeCloseTo(ARM.forearm,9);
  }
});


test("engine hits deform only the struck membranes; snare wires rattle and settle to rest",()=>{
  const drummer=new Drummer(),t=tele();
  const snare=drummer.group.getObjectByName("drum-head-1") as THREE.LineSegments;
  const tom=drummer.group.getObjectByName("drum-head-2") as THREE.LineSegments;
  const wire=drummer.group.getObjectByName("snare-wire-0") as THREE.Line;
  const positions=(mesh:THREE.Line|THREE.LineSegments)=>Array.from(mesh.geometry.getAttribute("position").array);
  const before=positions(snare),tomBefore=positions(tom),wireBefore=positions(wire);
  t.last[1]=1;t.modes[1]=[.1,.02,-.01,.01];t.wires[0]=.006;t.rattle=.006;
  drummer.update(t,1.02,1/60);
  expect(positions(snare)).not.toEqual(before);expect(positions(tom)).toEqual(tomBefore);expect(positions(wire)).not.toEqual(wireBefore);
  const after=positions(snare);
  // The rim of every membrane line remains fixed while its interior bends.
  for(let i=0;i<before.length;i+=120)expect(after[i+1]).toBeCloseTo(before[i+1],7);
  drummer.update(null,2,1/60);expect(positions(snare)).toEqual(before);expect(positions(wire)).toEqual(wireBefore);
  drummer.dispose();
});

test("the tip swings down and rebounds around a settled wrist", () => {
  const motion = new DrummerMotion();
  const t = tele();
  t.next[1] = .4;
  t.next[5] = .4;
  const poses = [];
  for (let frame = 0; frame <= 120; frame++) {
    const clock = frame / 240;
    if (frame === 97) {
      t.last[1] = t.last[5] = .4;
      t.next[1] = t.next[5] = .7;
    }
    poses.push(motion.update(t, clock, 1 / 240));
  }
  for (let hand = 0; hand < 2; hand++) {
    const raised = poses[76][hand];
    const hit = poses[96][hand];
    const rebounded = poses[119][hand];
    expect(raised.wrist.distanceTo(hit.wrist)).toBeLessThan(.015);
    expect(raised.tip.y - hit.tip.y).toBeGreaterThan(.045);
    expect(rebounded.tip.y - hit.tip.y).toBeGreaterThan(.045);
  }
});

test("the sticks exit both mirrored grips between the thumb and index finger", () => {
  const drummer = new Drummer();
  drummer.group.updateMatrixWorld(true);
  for (let hand = 0; hand < 2; hand++) {
    const palm = drummer.group.getObjectByName(`drum-grip-${hand}`)!;
    const stick = drummer.group.getObjectByName(`drum-stick-${hand}`) as THREE.Line;
    const shaft = stick.geometry.getAttribute("position");
    const localTip = palm.worldToLocal(stick.localToWorld(new THREE.Vector3().fromBufferAttribute(shaft, 1)));
    const thumb = palm.children.at(-1) as THREE.Line;
    const pinch = new THREE.Vector3().fromBufferAttribute(thumb.geometry.getAttribute("position"), 2);
    expect(localTip.dot(pinch)).toBeGreaterThan(0);
    expect(pinch.clone().cross(localTip.normalize()).length()).toBeLessThan(.008);
  }
  drummer.dispose();
});

test("cymbal rims flex around fixed bells and only struck plates move", () => {
  const drummer = new Drummer();
  const t = tele();
  const plates = [5, 6, 7].map(id => drummer.group.getObjectByName(`cymbal-plate-${id}`) as THREE.LineSegments);
  const positions = (plate: THREE.LineSegments) => Array.from(plate.geometry.getAttribute("position").array);
  const rest = plates.map(positions);
  t.last[6] = 1;
  drummer.update(t, 1.05, 1 / 60);
  const crash = positions(plates[1]);
  expect(positions(plates[0])).toEqual(rest[0]);
  expect(positions(plates[2])).toEqual(rest[2]);

  const rim: number[] = [];
  for (let i = 0; i < crash.length; i += 3) {
    const radius = Math.hypot(rest[1][i], rest[1][i + 2]);
    if (radius > .229) rim.push(crash[i + 1]);
    if (radius < .081) expect(crash[i + 1]).toBeCloseTo(rest[1][i + 1], 7);
  }
  expect(Math.min(...rim)).toBeLessThan(-.025);
  expect(Math.max(...rim)).toBeGreaterThan(.025);

  drummer.update(t, 2.6, 1 / 60);
  expect(positions(plates[1])).toEqual(rest[1]);
  drummer.dispose();
});

test("kick beater approaches the head and hi-hat pedal moves the upper plate", () => {
  const drummer = new Drummer();
  const t = tele();
  const beater = drummer.group.getObjectByName("kick-beater")!;
  const kickPedal = drummer.group.getObjectByName("drum-pedal-1")!;
  const hatPedal = drummer.group.getObjectByName("drum-pedal-0")!;
  const hatTop = drummer.group.getObjectByName("cymbal-top-5")!;
  t.next[0] = 1;
  t.hatTravel = 0;
  t.hatGap = .018;
  t.hatPressure = 0;
  drummer.update(t, .9, 1 / 60);
  const restingAngle = beater.rotation.x;
  const restingPedal = kickPedal.rotation.x;
  const releasedHat = hatPedal.rotation.x;
  expect(hatTop.position.y).toBeCloseTo(.018);

  t.last[0] = 1;
  t.next[0] = -1;
  t.kickCompression = .002;
  t.hatTravel = 1;
  t.hatGap = 0;
  t.hatPressure = 35;
  t.hatClose = 1;
  drummer.update(t, 1.002, 1 / 60);
  expect(beater.rotation.x).toBeGreaterThan(restingAngle + .6);
  expect(kickPedal.rotation.x).toBeGreaterThan(restingPedal);
  expect(hatPedal.rotation.x).toBeGreaterThan(releasedHat);
  expect(hatTop.position.y).toBe(0);

  t.kickCompression = 0;
  drummer.update(t, 1.2, 1 / 60);
  expect(beater.rotation.x).toBeCloseTo(restingAngle);
  drummer.dispose();
});
