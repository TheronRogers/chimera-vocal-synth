import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
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
  { chord, onEngage, onRelease }: {
    chord: Chord;
    onEngage: (id: string, i: number) => void;
    onRelease: (id: string) => void;
  },
) {
  const ref = useRef<HTMLCanvasElement>(null),
    live = useRef({ chord, onEngage, onRelease });
  live.current = { chord, onEngage, onRelease };
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
    const scene = new THREE.Scene(), root = new THREE.Group();
    scene.add(root);
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
    const fretting = new THREE.Group(), picking = new THREE.Group();
    root.add(fretting, picking);
    let previousPlan: HandPlan | null = null,
      targetPlan: HandPlan | null = null;
    let handKey = "",
      handObjects: THREE.Object3D[] = [],
      handGeos: THREE.BufferGeometry[] = [];
    function clearHand() {
      for (const o of handObjects) o.removeFromParent();
      for (const geo of handGeos) {
        geo.dispose();
        const i = geometries.indexOf(geo);
        if (i >= 0) geometries.splice(i, 1);
      }
      handObjects = [];
      handGeos = [];
    }
    function buildHand(plan: HandPlan) {
      clearHand();
      const first = geometries.length;
      for (const finger of plan.fingers) {
        for (let j = 1; j < finger.points.length; j++) {
          handObjects.push(
            segment(
              finger.points[j - 1],
              finger.points[j],
              finger.finger === 0 ? .007 : j === 1 ? .0055 : .0032,
              skin,
              fretting,
            ),
          );
        }
      }
      const anchors = plan.fingers.filter((f) => f.finger > 0).flatMap((f) =>
        [-.010, .010].map((z) =>
          new THREE.Vector3(f.points[0][0], f.points[0][1], f.points[0][2] + z)
        )
      );
      for (const x of [-.030, .030]) {
        for (const z of [-.015, .015]) {
          anchors.push(new THREE.Vector3(plan.palm[0] + x, -.096, z));
        }
      }
      const p = mesh(new ConvexGeometry(anchors), skin, fretting);
      handObjects.push(p);
      handObjects.push(
        segment(
          [plan.palm[0], -.09, 0],
          [plan.palm[0] - .02, -.17, -.01],
          .018,
          skin,
          fretting,
        ),
      );
      handGeos = geometries.slice(first);
    }
    const palm = mesh(new THREE.SphereGeometry(1, 12, 8), skin, picking);
    palm.scale.set(.038, .025, .017);
    palm.position.set(.58, -.077, .065);
    segment([.58, -.095, .065], [.62, -.17, .065], .018, skin, picking);
    const pickingFingers = [
      [[.55, -.067, .055], [.555, -.047, .045], [.57, -.025, .035], [
        .577,
        -.012,
        .020,
      ]],
      [[.573, -.064, .065], [.582, -.040, .058], [.589, -.025, .035], [
        .585,
        -.012,
        .020,
      ]],
      ...Array.from(
        { length: 3 },
        (
          _,
          i,
        ) => [[.587 + i * .012, -.065, .065], [.596 + i * .012, -.041, .055], [
          .599 + i * .012,
          -.040,
          .033,
        ], [.592 + i * .012, -.052, .031]],
      ),
    ];
    for (const points of pickingFingers) {
      for (let j = 1; j < points.length; j++) {
        segment(
          points[j - 1],
          points[j],
          j === 1 ? .005 : .0035,
          skin,
          picking,
        );
      }
    }
    const pick = mesh(new THREE.ConeGeometry(.008, .018, 3), neckMat, picking);
    pick.position.set(.580, -.008, .012);
    root.rotation.z = Math.PI;
    const target = new THREE.Vector3(-.34, 0, -.02);
    function home(back: boolean) {
      const portrait = canvas.clientWidth < 600;
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
    function frame() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h) {
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
        const dt = t ? t.clock - t.strumTime : 99;
        picking.position.y = dt >= 0 && dt < .16
          ? Math.sin(dt / .16 * Math.PI) * .065
          : 0;
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
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, []);
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
          aria-label="3D acoustic guitar and articulated hands. Drag to orbit; hold a string near the bridge to mute."
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
