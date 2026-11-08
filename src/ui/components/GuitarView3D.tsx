import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { frettingArm, pickingArm, pickingPose, performerShoulder, PERFORMER_GUITAR_TILT } from "../render/guitar-hand.ts";
import { ArticulatedHand } from "../render/articulated-hand.ts";
import { GuitarPerformer } from "../render/guitar-performer.ts";
import { useModel } from "../useModel.ts";
import { useStore } from "../store.ts";
import { sameBody } from "../body.ts";
import { VoiceModel } from "../analysis.ts";
import { sungNow } from "../singing.ts";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { call } from "../../wasm/chimera.ts";
import { type Chord, fingerChord, type Frets } from "../../guitar/model.ts";
import { engine } from "../../audio/AudioEngine.ts";
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
  { chord, singer = false, onEngage, onRelease }: {
    chord: Chord;
    singer?: boolean;
    onEngage: (id: string, i: number) => void;
    onRelease: (id: string) => void;
  },
) {
  const ref = useRef<HTMLCanvasElement>(null),
    live = useRef({ chord, singer, onEngage, onRelease });
  live.current = { chord, singer, onEngage, onRelease };
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
    renderer.setClearColor(0x02080a);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), root = new THREE.Group(), bodyRoot = new THREE.Group();
    bodyRoot.rotation.z = Math.PI;
    scene.add(root, bodyRoot);
    const performer = new GuitarPerformer();
    bodyRoot.add(performer.group);
    performer.group.visible = singer;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10),
      controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.minDistance = .3;
    controls.maxDistance = 2.5;
    const g = call<Geometry>("guitarGeometry");
    const blue = new THREE.MeshStandardMaterial({
        color: 0x10242c,
        roughness: .8,
      }),
      neckMat = new THREE.MeshStandardMaterial({ color: 0x18232b }),
      skin = new THREE.MeshStandardMaterial({ color: 0x263d47, roughness: .8 });
    scene.add(new THREE.HemisphereLight(0xc5e9ff, 0x152329, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(.2, -.4, 1);
    scene.add(light);
    const geometries: THREE.BufferGeometry[] = [],
      materials: THREE.Material[] = [blue, neckMat, skin];
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x47859b });
    materials.push(outlineMat);
    function mesh(
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      parent = root,
      outline = true,
    ) {
      geometries.push(geometry);
      const m = new THREE.Mesh(geometry, material);
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
    const hole = new THREE.Path();
    hole.absarc(g.soundhole[0], 0, g.soundhole[2], 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const rim = mesh(new THREE.ShapeGeometry(shape, 32), blue);
    rim.position.z = -.001;
    const modes = call<
      { nodes: number[][]; triangles: number[]; modes: { shape: number[] }[] }
    >("guitarBody");
    const plateGeometry = new THREE.BufferGeometry();
    plateGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        modes.nodes.flatMap((p) => [p[0], p[1], 0]),
        3,
      ),
    );
    plateGeometry.setIndex(modes.triangles);
    plateGeometry.computeVertexNormals();
    const board = mesh(plateGeometry, blue, root, false);
    const rest = plateGeometry.getAttribute("position").array.slice();
    const boardNodes = modes.nodes.map((_, i) => i);
    const body = mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: g.depth,
        bevelEnabled: false,
        steps: 1,
      }),
      blue,
    );
    body.position.z = -g.depth - .003;
    const backMaterial = blue.clone();
    backMaterial.side = THREE.BackSide;
    materials.push(backMaterial);
    const back = mesh(
      new THREE.ShapeGeometry(
        new THREE.Shape(g.outline.map((p) => new THREE.Vector2(p[0], p[1]))),
      ),
      backMaterial,
    );
    back.position.z = -g.depth - .0031;
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
    const bridge = box(g.scale, 0, .008, .028, .080, .016),
      saddle = box(g.scale, 0, .019, .004, .058, .007);
    const metal = new THREE.MeshStandardMaterial({
      color: 0x738d93,
      metalness: .65,
      roughness: .3,
    });
    materials.push(metal);
    const amber = new THREE.LineBasicMaterial({ color: 0xdab35c });
    materials.push(amber);
    const strings: THREE.Line[] = [];
    const sy = (i: number, x: number) =>
      (i - 2.5) *
      (g.nutSpacing + (g.bridgeSpacing - g.nutSpacing) * x / g.scale) / 5;
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
    for (let i = 0; i < 6; i++) {
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
      const px = -.022 - (i < 3 ? i : 5 - i) * .044, py = i < 3 ? -.024 : .024;
      segment([0, sy(i, 0), .004], [px, py, .002], .0006, neckMat);
      segment([px, py, -.015], [px, py * 1.8, -.015], .002, neckMat);
      box(px, py * 1.8, -.015, .018, .009, .007);
    }
    const frettingRig = new ArticulatedHand(skin), pickingRig = new ArticulatedHand(skin);
    root.add(frettingRig.group, pickingRig.group);
    let previousPlan: HandPlan | null = null, targetPlan: HandPlan | null = null;
    let handKey = "";
    function buildHand(plan: HandPlan) {
      frettingRig.update(plan.fingers, frettingArm(plan, live.current.singer ? performerShoulder(.42) : undefined));
    }
    const pickGeometry = new THREE.BufferGeometry();
    pickGeometry.setAttribute("position",new THREE.Float32BufferAttribute(new Float32Array(9),3));
    const pickMaterial = new THREE.MeshBasicMaterial({color:amber.color.clone(),side:THREE.DoubleSide,transparent:true,opacity:.85,toneMapped:false});
    materials.push(pickMaterial);
    mesh(pickGeometry,pickMaterial,root,false);
    root.rotation.z = Math.PI;
    const target = new THREE.Vector3(-.34, 0, -.02);
    function home(back: boolean) {
      const portrait = canvas.clientWidth < 600;
      // Rotate the instrument about the soundboard, leaving the person's torso upright.
      root.rotation.z = Math.PI + (live.current.singer ? PERFORMER_GUITAR_TILT : 0);
      root.position.set(-.58, 0, 0).sub(new THREE.Vector3(.58, 0, 0).applyQuaternion(root.quaternion));
      root.updateMatrixWorld(true);
      bodyRoot.updateMatrixWorld(true);
      controls.maxDistance = live.current.singer ? 6 : 2.5;
      if (live.current.singer) {
        camera.up.set(0, 1, 0);
        const aspect = Math.max(.3, canvas.clientWidth / Math.max(1, canvas.clientHeight));
        const distance = Math.max(1.70, .66 / (Math.tan(camera.fov * Math.PI / 360) * aspect));
        camera.position.set(-.38, .35, back ? -distance : distance);
        controls.target.set(-.36, .18, -.07);
        controls.update();
        return;
      }
      camera.up.set(portrait ? 1 : 0, portrait ? 0 : 1, 0);
      camera.position.set(-.35, -.50, back ? -.95 : .95);
      controls.target.copy(target);
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
    let lastFrame = performance.now();
    function frame() {
      const now = performance.now(), frameDt = Math.min(.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h) {
        if (previousSinger !== live.current.singer) {
          previousSinger = live.current.singer;
          home(false);
          if (targetPlan) buildHand(targetPlan);
        }
        performer.group.visible = live.current.singer;
        if (!live.current.singer) canvas.dataset.syllable = "";
        if (
          canvas.width !== Math.round(w * renderer.getPixelRatio()) ||
          canvas.height !== Math.round(h * renderer.getPixelRatio())
        ) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          if ((w < 600) !== (previousWidth < 600)) home(false);
          previousWidth = w;
        }
        const t = engine.latestGuitar;
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
            const p = structuredClone(targetPlan);
            p.palm = p.palm.map((v, i) =>
              v * phase + previousPlan!.palm[i] * (1 - phase)
            );
            for (const f of p.fingers) {
              const old = previousPlan.fingers.find((o) =>
                o.finger === f.finger
              )!;
              let base = f.points[0].map((v, i) =>
                v * phase + old.points[0][i] * (1 - phase)
              );
              if (f.finger > 0) base[2] += .020 * Math.sin(Math.PI * phase);
              const result = [base];
              for (let j = 1; j < f.points.length; j++) {
                const to = new THREE.Vector3(...f.points[j]).sub(
                  new THREE.Vector3(...f.points[j - 1]),
                );
                const from = new THREE.Vector3(...old.points[j]).sub(
                  new THREE.Vector3(...old.points[j - 1]),
                );
                const length = to.length();
                from.normalize();
                const rotation = new THREE.Quaternion().setFromUnitVectors(
                  from,
                  to.normalize(),
                );
                from.applyQuaternion(
                  new THREE.Quaternion().slerp(rotation, phase),
                ).multiplyScalar(length);
                base = base.map((v, i) => v + from.getComponent(i));
                result.push(base);
              }
              f.points = result;
            }
            buildHand(p);
          } else if (previousPlan !== targetPlan) {
            buildHand(targetPlan);
            previousPlan = targetPlan;
          }
        }
        for (let i = 0; i < 6; i++) {
          const pos = strings[i].geometry.getAttribute(
            "position",
          ) as THREE.BufferAttribute;
          for (let n = 0; n <= 256; n++) {
            pos.setZ(n, .004 + (t?.strings[i].displacement[n] ?? 0) * 12);
          }
          pos.needsUpdate = true;
        }
        const position = board.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        for (let i = 0; i < position.count; i++) {
          position.setZ(
            i,
            rest[i * 3 + 2] + (vib.current
                  ? t?.modes.reduce(
                    (sum, m, j) =>
                      sum + m.q * modes.modes[j].shape[boardNodes[i]],
                    0,
                  ) ?? 0
                  : 0) * 12,
          );
        }
        position.needsUpdate = true;
        bridge.position.z = .008 + (t?.bridge ?? 0) * 12;
        saddle.position.z = .019 + (t?.bridge ?? 0) * 12;
        const strokeTime = t ? t.clock - t.strumTime : 99;
        const phase = strokeTime >= 0 && strokeTime < .18 ? strokeTime / .18 : 0;
        const direction = t?.direction ?? 1;
        const pickPose = pickingPose(1,direction * .20 * Math.sin(phase * Math.PI * 2),
          direction * .008 * Math.sin(phase * Math.PI));
        const pickShoulder = live.current.singer ? performerShoulder(.74) : new THREE.Vector3(.74,-.035,-.18);
        const pickArm = pickingArm(pickPose,pickShoulder);
        pickingRig.update(pickPose.fingers,{...pickPose,...pickArm});
        const pickPositions = pickGeometry.getAttribute("position") as THREE.BufferAttribute;
        pickPose.pick.forEach((p,i)=>pickPositions.setXYZ(i,p.x,p.y,p.z));
        pickPositions.needsUpdate=true;
        if (live.current.singer) {
          const st = useStore.getState();
          const tele = engine.latest && sameBody(engine.latest.body, st.body) ? engine.latest : null;
          const artic = tele ? VoiceModel.articFromArray(tele.t.artic) : st.artic;
          const syllable = sungNow()?.text ?? null;
          if (model.current) performer.update(model.current, artic, tele, st.view, camera, w, h, frameDt, syllable);
          canvas.dataset.syllable = syllable ?? "";
        }
        controls.update();
        root.updateMatrixWorld(true);
        canvas.dataset.mutePoints = JSON.stringify(
          Array.from({ length: 6 }, (_, i) => {
            const p = new THREE.Vector3(.6, sy(i, .6), .004).applyMatrix4(
              root.matrixWorld,
            ).project(camera);
            return [(p.x + 1) * w / 2, (1 - p.y) * h / 2];
          }),
        );
        canvas.dataset.performer = String(live.current.singer);
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
      frettingRig.dispose();
      pickingRig.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, [model]);
  return (
    <>
      <div className="guitar-view-controls">
        <button className="chip" onClick={() => action.current(false)}>
          Reset view
        </button>
        <button className="chip" onClick={() => action.current(true)}>
          Neck back
        </button>
        <label>
          <input
            type="checkbox"
            checked={vibration}
            onChange={(e) => setVibration(e.target.checked)}
          />{" "}
          Vibration ×12
        </label>
      </div>
      <div className="guitar-canvas">
        <canvas
          ref={ref}
          role="img"
          aria-label={singer ? "3D singer and guitarist as one performer. Drag to orbit; hold a string near the bridge to mute." : "3D acoustic guitar and articulated hands. Drag to orbit; hold a string near the bridge to mute."}
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
