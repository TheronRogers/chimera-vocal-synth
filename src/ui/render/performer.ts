import * as THREE from "three";
import { Anatomy3D } from "./anatomy3d.ts";
import type { VoiceModel } from "../analysis.ts";
import type { HumanArtic } from "../../wasm/types.ts";
import type { TelemetryMessage } from "../../worklet/protocol.ts";
import type { ViewFlags } from "./anatomy.ts";
import { V } from "../colors.ts";
import { PERFORMER_GUITAR_DROP } from "./guitar-hand.ts";

/** Guitar coordinates are metres, with -y up; anatomy is centimetres, +x forward. */
export class Performer {
  readonly group = new THREE.Group();
  readonly headMount = new THREE.Group();
  readonly head = new Anatomy3D();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material = new THREE.LineBasicMaterial({
    color: new THREE.Color(V.blue).convertLinearToSRGB().multiplyScalar(.45),
    transparent: true, opacity: .7, depthTest: false, depthWrite: false,
    toneMapped: false,
  });
  private width = 0;
  private height = 0;
  private readonly wordCanvas = document.createElement("canvas");
  private readonly wordTexture: THREE.CanvasTexture;
  private readonly wordMaterial: THREE.SpriteMaterial;
  private readonly word: THREE.Sprite;
  private text = "";

  constructor() {
    this.wordCanvas.width=512;this.wordCanvas.height=80;
    this.wordTexture=new THREE.CanvasTexture(this.wordCanvas);
    this.wordMaterial=new THREE.SpriteMaterial({map:this.wordTexture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
    this.word=new THREE.Sprite(this.wordMaterial);
    this.word.center.set(0,.5);
    this.word.visible=false;
    this.group.add(this.word);
    const mount = this.headMount;
    // A head above the shoulder midpoint, facing out from the soundboard.
    mount.position.set(.58, -.135 - PERFORMER_GUITAR_DROP, -.18);
    const orientation = new THREE.Group();
    orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0),
    ));
    orientation.scale.setScalar(.01);
    orientation.add(this.head.scene);
    mount.add(orientation);
    this.group.add(mount);

    const line = (points: THREE.Vector3[]) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      this.geometries.push(geometry);
      this.group.add(new THREE.Line(geometry, this.material));
    };
    // The shoulders match the arm rig. Contours keep the torso behind the guitar readable.
    const rings = [[-.035, .16, .075], [.055, .17, .09], [.18, .145, .085], [.32, .12, .075]];
    for (const [y, width, depth] of rings) {
      line(Array.from({ length: 33 }, (_, i) => {
        const angle = i * Math.PI / 16;
        return new THREE.Vector3(.58 + Math.cos(angle) * width, y - PERFORMER_GUITAR_DROP, -.20 + Math.sin(angle) * depth);
      }));
    }
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      line(rings.map(([y, width, depth]) => new THREE.Vector3(
        .58 + Math.cos(angle) * width, y - PERFORMER_GUITAR_DROP, -.20 + Math.sin(angle) * depth,
      )));
    }
    for (const side of [-1, 1]) {
      line([new THREE.Vector3(.58 + side * .16, -.035 - PERFORMER_GUITAR_DROP, -.18),
        new THREE.Vector3(.58 + side * .045, -.095 - PERFORMER_GUITAR_DROP, -.18),
        new THREE.Vector3(.58 + side * .045, -.15 - PERFORMER_GUITAR_DROP, -.18)]);
    }
  }

  update(model: VoiceModel, artic: HumanArtic, tele: TelemetryMessage | null,
    view: ViewFlags, camera: THREE.Camera, width: number, height: number, dt: number, syllable: string | null): void {
    if (width !== this.width || height !== this.height) {
      this.head.resize(width, height);
      this.width = width; this.height = height;
    }
    // Anatomy uses the camera's world position to orient eyes and section visibility.
    this.head.camera.position.copy(camera.position);
    this.group.updateWorldMatrix(true, true);
    this.head.face.update(tele, dt);
    const frame=model.frame(artic);
    this.head.update(model, frame, artic, tele, view, dt);
    this.word.visible=!!syllable;
    if(syllable) {
      if(this.text!==syllable) {
        this.text=syllable;
        const ctx=this.wordCanvas.getContext("2d")!;
        ctx.clearRect(0,0,512,80);
        ctx.font='36px "Courier New", monospace';ctx.textBaseline="middle";
        ctx.fillStyle=V.green;ctx.fillText(syllable.toUpperCase(),8,40);
        this.wordTexture.needsUpdate=true;
      }
      const mouth=this.head.mouthWorld(model,frame,artic);
      const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
      mouth.addScaledVector(right,.045);mouth.y+=.018;
      this.word.position.copy(this.group.worldToLocal(mouth));
      this.word.scale.set(.50,.078,1);
    }
  }

  dispose(): void {
    this.head.dispose();
    this.geometries.forEach(g => g.dispose());
    this.material.dispose();
    this.wordTexture.dispose();this.wordMaterial.dispose();
  }
}
