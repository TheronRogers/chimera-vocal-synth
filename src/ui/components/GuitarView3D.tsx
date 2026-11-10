import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { V } from "../colors.ts";
import { fingerstylePose, frettingArm, pickingArm, pickingPose, strokeTip, performerShoulder, PERFORMER_GUITAR_TILT } from "../render/guitar-hand.ts";
import { interpolateHand } from "../render/hand-palm.ts";
import { ArticulatedHand } from "../render/articulated-hand.ts";
import { Drummer } from "../render/drummer.ts";
import { Performer } from "../render/performer.ts";
import { useModel } from "../useModel.ts";
import { useStore } from "../store.ts";
import { sameBody } from "../body.ts";
import { VoiceModel } from "../analysis.ts";
import { sungNow } from "../singing.ts";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { call } from "../../wasm/chimera.ts";
import { type Chord, fingerChord, type Frets } from "../../guitar/model.ts";
import { engine } from "../../audio/AudioEngine.ts";
import type { ElectricBodyProfile, GuitarBodyProfile } from "../../guitar/instruments.ts";
import { archtopPlate, fHole, type PlateMesh } from "../render/guitar-body.ts";
import { type HandPlan, handPlan } from "../../guitar/physical.ts";
interface Geometry {
  scale: number;
  depth: number;
  nutWidth: number;
  nutSpacing: number;
  bridgeSpacing: number;
  outline: number[][];
  soundhole: number[];
}
/** Actual scene projection owns hit tests. A mute never transfers to another string. */
export function GuitarView3D(
  { profile, electricBody, bass = false, leftHanded = false, chord, singer = false, drummer = false, pickup = 0, pickupPosition = .86, strumPosition = .8, fingerstyle = false, onEngage, onRelease }: {
    profile: GuitarBodyProfile;
    electricBody?: ElectricBodyProfile;
    bass?: boolean;
    leftHanded?: boolean;
    chord: Chord;
    singer?: boolean;
    drummer?: boolean;
    pickup?: number;
    pickupPosition?: number;
    strumPosition?: number;
    fingerstyle?: boolean;
    onEngage: (id: string, i: number) => void;
    onRelease: (id: string) => void;
  },
) {
  const ref = useRef<HTMLCanvasElement>(null),
    live = useRef({ chord, singer, drummer, pickup, pickupPosition, strumPosition, fingerstyle, onEngage, onRelease });
  live.current = { chord, singer, drummer, pickup, pickupPosition, strumPosition, fingerstyle, onEngage, onRelease };
  const model = useModel();
  const action = useRef<(back: boolean) => void>(() => {});
  const [failed, setFailed] = useState(false);
  const [vibration, setVibration] = useState(true);
  const vib = useRef(true);
  vib.current = vibration;
  useEffect(() => {
    const canvas = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), root = new THREE.Group(), bodyRoot = new THREE.Group();
    bodyRoot.rotation.z = Math.PI;
    const handedRig = new THREE.Group();
    handedRig.scale.x = leftHanded ? -1 : 1;
    handedRig.add(root, bodyRoot);
    scene.add(handedRig);
    const stringCount = bass ? 4 : 6;
    const performer = new Performer();
    // Move the head with the mirrored torso while preserving its camera-facing geometry.
    performer.headMount.scale.x = handedRig.scale.x;
    bodyRoot.add(performer.group);
    let bandDrummer: { kit: Drummer; performer: Performer } | null = null;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10),
      controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.minDistance = .3;
    controls.maxDistance = 2.5;
    const base = call<Geometry>("guitarGeometry");
    const scaleX = (x: number) => base.scale + (x - base.scale) * profile.lengthScale;
    const scaleY = (y: number) => y * profile.widthScale;
    const g = {
      ...base,
      outline: base.outline.map(([x, y]) => [scaleX(x), scaleY(y)]),
      depth: base.depth * profile.depthScale,
    };
    // Match the vocalist's unlit, translucent anatomy lines. Max blending keeps
    // overlapping wires from bleaching the joints and soundboard to white.
    function wire(color: string, opacity: number) {
      return new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).convertLinearToSRGB().multiplyScalar(opacity),
        wireframe: true, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false,
        blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation,
        blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      });
    }
    const blue = wire(V.blueMid, .42),
      neckMat = wire(V.blue, .55),
      skin = wire(V.blue, .48);
    // Flat shells need contours, not the long fan diagonals of their fill mesh.
    const shell = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const geometries: THREE.BufferGeometry[] = [],
      materials: THREE.Material[] = [blue, neckMat, skin, shell];
    const outlineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(V.blue).convertLinearToSRGB().multiplyScalar(.75),
      transparent: true,
      depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    });
    materials.push(outlineMat);
    function mesh(
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      parent = root,
      outline = true,
    ) {
      geometries.push(geometry);
      const m = new THREE.Mesh(geometry, outline ? shell : material);
      parent.add(m);
      if (outline) {
        const edges = new THREE.EdgesGeometry(geometry, 35);
        geometries.push(edges);
        m.add(new THREE.LineSegments(edges, outlineMat));
      }
      return m;
    }
    function box(
      x: number,
      y: number,
      z: number,
      a: number,
      b: number,
      c: number,
      material = neckMat,
    ) {
      const m = mesh(new THREE.BoxGeometry(a, b, c), material);
      m.position.set(x, y, z);
      return m;
    }
    function segment(
      a: number[],
      b: number[],
      radius: number,
      material: THREE.Material,
      parent = root,
    ) {
      const av = new THREE.Vector3(...a),
        bv = new THREE.Vector3(...b),
        delta = bv.clone().sub(av);
      const m = mesh(
        new THREE.CylinderGeometry(radius, radius * .90, delta.length(), 8),
        material,
        parent,
        false,
      );
      m.position.copy(av.add(bv).multiplyScalar(.5));
      m.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      );
      return m;
    }
    const shape = new THREE.Shape(
      g.outline.map((p) => new THREE.Vector2(p[0], p[1])),
    );
    const baseHoles = profile.arch ? [-1, 1].map(fHole) : [];
    const paths = baseHoles.map(path => new THREE.Path(path.getPoints(8).map(
      point => new THREE.Vector2(scaleX(point.x), scaleY(point.y)),
    )));
    if (!paths.length) {
      const hole = new THREE.Path();
      hole.absellipse(scaleX(base.soundhole[0]), 0,
        base.soundhole[2] * profile.lengthScale, base.soundhole[2] * profile.widthScale,
        0, 2 * Math.PI, true);
      paths.push(hole);
    }
    shape.holes.push(...paths);
    const rim = mesh(new THREE.ShapeGeometry(shape, 32), blue);
    rim.position.z = -.001 - profile.arch;
    const flatPlate = call<PlateMesh>("guitarBody");
    const modes = profile.arch ? archtopPlate(flatPlate, base.outline, base.soundhole, baseHoles) : flatPlate;
    const upperRim = base.outline.slice(0, 101);
    const restDepth = modes.nodes.map(([x, y]) => {
      if (!profile.arch) return 0;
      const next = upperRim.findIndex(point => point[0] >= x);
      const [ax, ay] = upperRim[next - 1], [bx, by] = upperRim[next];
      const width = THREE.MathUtils.lerp(ay, by, (x - ax) / (bx - ax));
      const u = (x - upperRim[0][0]) / (upperRim[100][0] - upperRim[0][0]);
      return profile.arch * (Math.sin(Math.PI * u) * Math.max(0, 1 - (y / width) ** 2) - 1);
    });
    const plateGeometry = new THREE.BufferGeometry();
    plateGeometry.setAttribute("position", new THREE.Float32BufferAttribute(
      modes.nodes.flatMap(([x, y], i) => [scaleX(x), scaleY(y), restDepth[i]]), 3,
    ));
    plateGeometry.setIndex(modes.triangles);
    const plateColors = new THREE.BufferAttribute(new Float32Array(modes.nodes.length * 3), 3);
    plateGeometry.setAttribute("color", plateColors);
    const plateMaterial = wire(V.blue, .8);
    plateMaterial.vertexColors = true;
    plateMaterial.color.setRGB(1, 1, 1);
    materials.push(plateMaterial);
    const board = mesh(plateGeometry, plateMaterial, root, false);
    const plateIdle = blue.color;
    const plateActive = new THREE.Color(V.amber).convertLinearToSRGB();
    const plateColor = new THREE.Color();
    const modalAmplitudes = new Float64Array(modes.modes.length);
    const exaggerate = (metres: number, gain: number) => THREE.MathUtils.clamp(metres * gain, -.018, .018);
    let bodyShape = shape;
    if (electricBody) {
      const outline = new THREE.CatmullRomCurve3(
        // The guitar root turns the neck toward the player’s left, reversing local Y.
        electricBody.outline.map(([x, y]) => new THREE.Vector3(x, -y, 0)),
        true,
      );
      bodyShape = new THREE.Shape(outline.getPoints(96).slice(0, -1).map(p => new THREE.Vector2(p.x, p.y)));
      if (electricBody.fHoles) bodyShape.holes.push(fHole(-1), fHole(1));
    }
    const bodyDepth = electricBody?.depth ?? g.depth;
    const body = mesh(
      new THREE.ExtrudeGeometry(bodyShape, {
        depth: electricBody ? bodyDepth : bodyDepth - profile.arch,
        bevelEnabled: false,
        steps: 1,
      }),
      blue,
    );
    body.position.z = -bodyDepth - .003;
    // Pin the back's rim and show its single bending coordinate at the center.
    const backGeometry = new THREE.BufferGeometry();
    const backRim = g.outline.filter((_, i) => i % 8 === 0);
    const backCenter = backRim.reduce((x, point) => x + point[0], 0) / backRim.length;
    backGeometry.setAttribute("position", new THREE.Float32BufferAttribute(
      [backCenter, 0, 0, ...backRim.flatMap(([x, y]) => [x, y, 0])], 3,
    ));
    backGeometry.setIndex(backRim.flatMap((_, i) => [0, i + 1, (i + 1) % backRim.length + 1]));
    const backMaterial = wire(V.blueMid, .24);
    backMaterial.side = THREE.DoubleSide;
    materials.push(backMaterial);
    const back = mesh(backGeometry, backMaterial, root, false);
    back.position.z = -g.depth - .0031;
    const backPosition = backGeometry.getAttribute("position") as THREE.BufferAttribute;

    // A shallow ring at the soundhole represents the cavity's moving air plug.
    const airMaterial = new THREE.LineBasicMaterial({
      color: V.amber, transparent: true, opacity: 0, depthWrite: false,
    });
    materials.push(airMaterial);
    const air = new THREE.Group();
    for (const path of paths) {
      const airGeometry = new THREE.BufferGeometry().setFromPoints(path.getPoints(24));
      geometries.push(airGeometry);
      air.add(new THREE.LineLoop(airGeometry, airMaterial));
    }
    root.add(air);
    rim.visible = board.visible = back.visible = air.visible = !electricBody;
    const portArea = paths.reduce((area, path) => area + Math.abs(THREE.ShapeUtils.area(path.getPoints(24))), 0);
    let airActivity = 0;
    let backActivity = 0;
    const fingerboardShape = new THREE.Shape([
      new THREE.Vector2(0, -g.nutWidth / 2),
      new THREE.Vector2(.46, -(g.nutWidth + .022 * .46 / g.scale) / 2),
      new THREE.Vector2(.46, (g.nutWidth + .022 * .46 / g.scale) / 2),
      new THREE.Vector2(0, g.nutWidth / 2),
    ]);
    const fingerboard = mesh(
      new THREE.ExtrudeGeometry(fingerboardShape, {
        depth: .016,
        bevelEnabled: false,
      }),
      neckMat,
    );
    fingerboard.position.z = -.016;
    segment([0, 0, -.021], [.359, 0, -.021], .019, neckMat);
    box(.359, 0, -.043, .045, .045, .07);
    box(-.075, 0, -.018, .15, .065, .018);
    const pickupCoils = [box(0, 0, -.002, .013, .074, .009), box(0, 0, -.002, .013, .074, .009)];
    const bridge = box(g.scale, 0, .008, .028, .080, .016),
      saddle = box(g.scale, 0, .019, .004, .058, .007);
    const metal = wire(V.blue, .8);
    materials.push(metal);
    const amber = new THREE.LineBasicMaterial({
      color: new THREE.Color(V.amber).convertLinearToSRGB(),
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    materials.push(amber);
    const strings: THREE.Line[] = [];
    const sy = (i: number, x: number) =>
      (i - 2.5) *
      (g.nutSpacing + (g.bridgeSpacing - g.nutSpacing) * x / g.scale) / 5;
    const strumGuide = segment([0, -.5, 0], [0, .5, 0], .0011, amber);
    for (let f = 0; f <= 20; f++) {
      const x = g.scale * (1 - 2 ** (-f / 12)),
        width = g.nutWidth + .022 * x / g.scale;
      segment(
        [x, -width / 2, .002],
        [x, width / 2, .002],
        f ? 0.0007 : .0015,
        metal,
      );
    }
    for (let i = 0; i < stringCount; i++) {
      const points = Array.from(
        { length: 257 },
        (_, n) =>
          new THREE.Vector3(g.scale * n / 256, sy(i, g.scale * n / 256), .004),
      );
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      geometries.push(geo);
      const line = new THREE.Line(geo, amber);
      root.add(line);
      strings.push(line);
      const px = -.022 - (i < stringCount / 2 ? i : stringCount - 1 - i) * .044, py = i < stringCount / 2 ? -.024 : .024;
      segment([0, sy(i, 0), .004], [px, py, .002], .0006, neckMat);
      segment([px, py, -.015], [px, py * 1.8, -.015], .002, neckMat);
      box(px, py * 1.8, -.015, .018, .009, .007);
    }
    const frettingRig = new ArticulatedHand(skin), pickingRig = new ArticulatedHand(skin);
    root.add(frettingRig.group, pickingRig.group);
    let previousPlan: HandPlan | null = null, targetPlan: HandPlan | null = null;
    let handKey = "";
    function buildHand(plan: HandPlan) {
      frettingRig.update(plan.fingers, frettingArm(plan, performerShoulder(.42)));
    }
    const pickGeometry = new THREE.BufferGeometry();
    pickGeometry.setAttribute("position",new THREE.Float32BufferAttribute(new Float32Array(9),3));
    const pickMaterial = new THREE.MeshBasicMaterial({color:amber.color.clone(),side:THREE.DoubleSide,transparent:true,opacity:.85,toneMapped:false});
    materials.push(pickMaterial);
    const pickMesh = mesh(pickGeometry,pickMaterial,root,false);
    root.rotation.z = Math.PI;
    const target = new THREE.Vector3(-.34, 0, -.02);
    function home(back: boolean) {
      // Rotate the instrument about the soundboard, leaving the person's torso upright.
      root.rotation.z = Math.PI + PERFORMER_GUITAR_TILT;
      root.position.set(-.58, 0, 0).sub(new THREE.Vector3(.58, 0, 0).applyQuaternion(root.quaternion));
      handedRig.updateMatrixWorld(true);
      controls.maxDistance = 8;
      if (live.current.drummer) {
        camera.up.set(0,1,0);
        const aspect=Math.max(.3,canvas.clientWidth/Math.max(1,canvas.clientHeight));
        const distance=Math.max(3.3,1.25/(Math.tan(camera.fov*Math.PI/360)*aspect));
        camera.position.set(.12,.75,back?-distance:distance);
        controls.target.set(.12,.10,-.12); controls.update(); return;
      }
      camera.up.set(0, 1, 0);
      const aspect = Math.max(.3, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      const distance = Math.max(1.70, .66 / (Math.tan(camera.fov * Math.PI / 360) * aspect));
      camera.position.set(handedRig.scale.x * -.38, .35, back ? -distance : distance);
      controls.target.set(handedRig.scale.x * -.36, .18, -.07);
      controls.update();
    }
    action.current = home;
    home(false);
    const contacts = new Map<number, string>();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    function down(e: PointerEvent) {
      const r = canvas.getBoundingClientRect();
      pointer.set(
        (e.clientX - r.left) / r.width * 2 - 1,
        -(e.clientY - r.top) / r.height * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      ray.params.Line.threshold = .0025;
      const hits = ray.intersectObjects(strings, false).filter((hit) => {
        const p = root.worldToLocal(hit.point.clone());
        return p.x >= .52 && p.x <= .68;
      });
      hits.sort((a, b) => (a.distanceToRay ?? 0) - (b.distanceToRay ?? 0));
      if (!hits.length) return;
      const index = strings.indexOf(hits[0].object as THREE.Line);
      e.stopImmediatePropagation();
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      const id = `p${e.pointerId}`;
      contacts.set(e.pointerId, id);
      live.current.onEngage(id, index);
    }
    function up(e: PointerEvent) {
      const id = contacts.get(e.pointerId);
      if (id) {
        live.current.onRelease(id);
        contacts.delete(e.pointerId);
      }
      controls.enabled = contacts.size === 0;
    }
    const resetContacts = () => {
      for (const id of contacts.values()) live.current.onRelease(id);
      contacts.clear();
      controls.enabled = true;
    };
    window.addEventListener("blur", resetContacts);
    canvas.addEventListener("pointerdown", down, true);
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(event, up as EventListener);
    }
    let raf = 0;
    let previousWidth = 0;
    let previousSinger = singer;
    let previousDrummer = drummer;
    let lastFrame = performance.now();
    function frame() {
      const now = performance.now(), frameDt = Math.min(.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h) {
        if (previousSinger !== live.current.singer || previousDrummer !== live.current.drummer) {
          previousDrummer = live.current.drummer;
          previousSinger = live.current.singer;
          home(false);
          if (targetPlan) buildHand(targetPlan);
        }
        if (!live.current.singer) canvas.dataset.syllable = "";
        if (
          !previousWidth ||
          canvas.width !== Math.round(w * renderer.getPixelRatio()) ||
          canvas.height !== Math.round(h * renderer.getPixelRatio())
        ) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          if (!previousWidth || (w < 600) !== (previousWidth < 600)) home(false);
          previousWidth = w;
        }
        const t = engine.latestGuitar;
        if (live.current.drummer && !bandDrummer) {
          const kit = new Drummer();
          const performer = new Performer();
          kit.group.position.set(.68, -.51, -.35);
          kit.performerMount.add(performer.group);
          scene.add(kit.group);
          bandDrummer = { kit, performer };
        }
        if (bandDrummer) {
          const { kit } = bandDrummer;
          kit.group.visible = live.current.drummer;
          if (kit.group.visible) {
            const drumTele = engine.latestDrums;
            const drumClock = (drumTele?.clock ?? 0) + Math.min(.05, Math.max(0, (now - engine.latestDrumsAt) / 1000));
            kit.update(drumTele, drumClock, frameDt);
          }
        }
        canvas.dataset.drummer=String(live.current.drummer);
        const frets = (t?.targetFrets ?? live.current.chord.frets) as Frets;
        const key = frets.join(",");
        if (key !== handKey) {
          const p = handPlan(fingerChord(frets));
          if (p.valid) {
            previousPlan = targetPlan ?? p;
            targetPlan = p;
            handKey = key;
            buildHand(p);
          }
        }
        if (targetPlan && previousPlan) {
          const phase = t?.gripPhase ?? 1;
          if (phase < 1) {
            buildHand(interpolateHand(previousPlan, targetPlan, phase));
          } else if (previousPlan !== targetPlan) {
            buildHand(targetPlan);
            previousPlan = targetPlan;
          }
        }
        for (let i = 0; i < stringCount; i++) {
          const pos = strings[i].geometry.getAttribute(
            "position",
          ) as THREE.BufferAttribute;
          for (let n = 0; n <= 256; n++) {
            pos.setZ(n, .004 + (t?.strings[i].displacement[n] ?? 0) * 12);
          }
          pos.needsUpdate = true;
        }
        if (!electricBody) {
          const acoustics = vib.current ? t : null;
          const position = board.geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let j = 0; j < modes.modes.length; j++) {
            const state = acoustics?.modes[j];
            modalAmplitudes[j] = state ? Math.hypot(state.q, state.velocity / (2 * Math.PI * modes.modes[j].hz * profile.frequencyScale)) : 0;
          }
          for (let i = 0; i < position.count; i++) {
            let displacement = 0;
            let activity = 0;
            for (let j = 0; j < modes.modes.length; j++) {
              const shape = modes.modes[j].shape[i];
              displacement += (acoustics?.modes[j].q ?? 0) * shape;
              activity += Math.abs(shape) * modalAmplitudes[j];
            }
            position.setZ(i, restDepth[i] + exaggerate(displacement, 640));
            plateColor.copy(plateIdle).lerp(plateActive, Math.min(1, activity * 40000));
            plateColors.setXYZ(i, plateColor.r, plateColor.g, plateColor.b);
          }
          position.needsUpdate = true;
          plateColors.needsUpdate = true;
          const backTravel = acoustics?.back ?? 0;
          backPosition.setZ(0, exaggerate(backTravel, 3200));
          backPosition.needsUpdate = true;
          const decay = Math.exp(-frameDt * 20);
          backActivity = acoustics ? Math.max(Math.abs(backTravel), backActivity * decay) : 0;
          backMaterial.color.copy(plateIdle).lerp(plateActive, Math.min(.8, backActivity * 300000));
          const airTravel = (acoustics?.cavity ?? 0) / portArea;
          air.position.z = -.018 - profile.arch - exaggerate(airTravel, 140);
          airActivity = acoustics ? Math.max(Math.abs(airTravel), airActivity * decay) : 0;
          airMaterial.opacity = Math.min(.85, airActivity * 12000);
        }
        const { pickup, pickupPosition } = live.current;
        pickupCoils[0].visible = pickup !== 0;
        pickupCoils[1].visible = pickup === 2;
        pickupCoils[0].position.x = g.scale * pickupPosition - (pickup === 2 ? .009 : 0);
        pickupCoils[1].position.x = g.scale * pickupPosition + .009;
        const bridgeMotion = (t?.bridge ?? 0) * 12;
        bridge.position.z = .008 + bridgeMotion;
        saddle.position.z = .019 + bridgeMotion;
        const guitarClock = (t?.clock ?? 0) + Math.min(.016, Math.max(0, (now - engine.latestGuitarAt) / 1000));
        const guideX = g.scale * live.current.strumPosition;
        strumGuide.position.set(guideX, 0, .008);
        strumGuide.scale.y = sy(5, guideX) * 2 + .012;
        const idleTip = new THREE.Vector3(guideX, sy(2, guideX) - .012, .055);
        const contact = t?.strokeReleases.findIndex(time => time >= 0 && guitarClock >= time - .025 && guitarClock <= time + .075) ?? -1;
        const bareHand = contact >= 0 ? t?.direction === 0 : live.current.fingerstyle;
        const stringPoint = (i: number) => {
          if (!t) return idleTip;
          const string = t.strings[i];
          const position = string.plucking || guitarClock >= t.strokeReleases[i]
            ? string.position : live.current.strumPosition;
          const x = g.scale * position;
          const sample = position * 256;
          const lo = Math.floor(sample);
          const hi = Math.min(lo + 1, 256);
          const displacement = THREE.MathUtils.lerp(string.displacement[lo], string.displacement[hi], sample - lo);
          const z = .004 + displacement * 12;
          return new THREE.Vector3(x, sy(i, x), z);
        };
        const contacts = new Map<number, {digit: number; point: THREE.Vector3; amount: number}>();
        if (bareHand && t) {
          t.strokeReleases.forEach((release, string) => {
            const elapsed = guitarClock - release;
            if (release < 0 || elapsed < -.025 || elapsed > .075) return;
            const digit = Math.max(0, string - 2);
            const amount = elapsed < 0 ? 1 + elapsed / .025 : 1 - elapsed / .075;
            if (amount > (contacts.get(digit)?.amount ?? 0)) {
              contacts.set(digit, {digit, point: stringPoint(string), amount});
            }
          });
        }
        const pickPose = bareHand
          ? fingerstylePose(new THREE.Vector3(guideX, sy(3, guideX), .012), [...contacts.values()], string => sy(string, guideX))
          : pickingPose(1, -.20, t ? strokeTip(guitarClock, t.strokeReleases, stringPoint, idleTip) : idleTip);
        pickMesh.visible = !bareHand;
        canvas.dataset.picking = bareHand ? "fingers" : "pick";
        canvas.dataset.strumPosition = String(live.current.strumPosition);
        const pickShoulder = performerShoulder(.74);
        const pickArm = pickingArm(pickPose,pickShoulder);
        pickingRig.update(pickPose.fingers,{...pickPose,...pickArm});
        const pickPositions = pickGeometry.getAttribute("position") as THREE.BufferAttribute;
        pickPose.pick.forEach((p,i)=>pickPositions.setXYZ(i,p.x,p.y,p.z));
        pickPositions.needsUpdate=true;
        {
          const st = useStore.getState();
          const tele = live.current.singer && engine.latest && sameBody(engine.latest.body, st.body) ? engine.latest : null;
          const artic = tele ? VoiceModel.articFromArray(tele.t.artic) : st.artic;
          const syllable = live.current.singer ? sungNow()?.text ?? null : null;
          if (model.current) performer.update(model.current, artic, tele, st.view, camera, w, h, frameDt, syllable);
          if (model.current && bandDrummer?.kit.group.visible) {
            const { kit, performer } = bandDrummer;
            performer.headMount.rotation.x = kit.nod;
            performer.update(model.current, st.artic, null, st.view, camera, w, h, frameDt, null);
          }
          canvas.dataset.syllable = syllable ?? "";
        }
        controls.update();
        root.updateMatrixWorld(true);
        canvas.dataset.mutePoints = JSON.stringify(
          Array.from({ length: stringCount }, (_, i) => {
            const p = new THREE.Vector3(.6, sy(i, .6), .004).applyMatrix4(
              root.matrixWorld,
            ).project(camera);
            return [(p.x + 1) * w / 2, (1 - p.y) * h / 2];
          }),
        );
        canvas.dataset.singer = String(live.current.singer);
        const headstock = new THREE.Vector3(-.15, 0, -.018).applyMatrix4(root.matrixWorld).project(camera);
        canvas.dataset.headstock = JSON.stringify([(headstock.x+1)*w/2,(1-headstock.y)*h/2]);
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("blur", resetContacts);
      canvas.removeEventListener("pointerdown", down, true);
      for (
        const event of ["pointerup", "pointercancel", "lostpointercapture"]
      ) canvas.removeEventListener(event, up as EventListener);
      controls.dispose();
      performer.dispose();
      bandDrummer?.performer.dispose();
      bandDrummer?.kit.dispose();
      frettingRig.dispose();
      pickingRig.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, [model, profile, electricBody, bass, leftHanded]);
  return (
    <>
      <div className="guitar-view-controls">
        <button className="chip" onClick={() => action.current(false)}>
          Reset view
        </button>
        <button className="chip" onClick={() => action.current(true)}>
          Neck back
        </button>
        {!electricBody && <label title="Amber on the soundboard shows vibration. The ring shows air moving through the soundhole. Orbit to see the back flex.">
          <input
            type="checkbox"
            checked={vibration}
            onChange={(e) => setVibration(e.target.checked)}
          />{" "}
          Show body vibration
        </label>}
      </div>
      <div className="guitar-canvas">
        <canvas
          ref={ref}
          role="img"
          aria-label={drummer ? (singer ? "3D singer and guitarist as one performer with a drummer and rock drum set. Drag to orbit; hold a string near the bridge to mute." : "3D guitarist with a drummer and rock drum set. Drag to orbit; hold a string near the bridge to mute.") : singer ? "3D singer and guitarist as one performer. Drag to orbit; hold a string near the bridge to mute." : `3D guitarist with ${bass ? "an electric bass" : electricBody ? electricBody.name + " electric guitar" : "an acoustic guitar"}. Drag to orbit; hold a string near the bridge to mute.`}
        />
      </div>
      {failed && (
        <p role="alert">
          3D rendering unavailable. Chord, pluck, and mute controls remain
          available below.
        </p>
      )}
    </>
  );
}
