import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { PALETTE } from "../constants";

/** Foreground station and the two autonomous side operators. */
export class Watchtower extends Group {
  readonly leftBeamOrigin = new Vector3(-14.2, 8.2, -0.5);
  readonly rightBeamOrigin = new Vector3(14.2, 8.2, -0.5);
  private readonly ownedGeometries = new Set<BufferGeometry>();
  private readonly ownedMaterials = new Set<Material>();

  constructor() {
    super();
    this.name = "watchtower-assembly";
    this.addPlayerStation();
    this.addOperatorTower(-1);
    this.addOperatorTower(1);
  }

  dispose(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedGeometries.clear();
    this.ownedMaterials.clear();
    this.clear();
  }

  private addPlayerStation(): void {
    const frame = this.material(PALETTE.cream.getHex(), 0.74, 0.25);
    const dark = this.material(PALETTE.ink.getHex(), 0.86, 0.08);
    const signal = this.material(PALETTE.coral.getHex(), 0.72, 0.18, 0.14);

    const floor = this.mesh(new BoxGeometry(11.8, 0.35, 5.8), dark);
    floor.position.set(0, 7.45, 18.6);
    this.add(floor);
    for (const x of [-5.4, 5.4]) {
      const post = this.mesh(new BoxGeometry(0.32, 3.6, 0.32), frame);
      post.position.set(x, 9.25, 16.1);
      this.add(post);
    }
    const rail = this.mesh(new BoxGeometry(11.1, 0.22, 0.22), frame);
    rail.position.set(0, 7.82, 16.1);
    this.add(rail);

    // The console is deliberately almost in frame, establishing the embodied viewpoint.
    const consoleBody = this.mesh(new BoxGeometry(5.4, 0.62, 1.5), dark);
    consoleBody.rotation.x = -0.18;
    consoleBody.position.set(0, 8.05, 16.75);
    this.add(consoleBody);
    for (const x of [-1.8, -0.9, 0, 0.9, 1.8]) {
      const lamp = this.mesh(new SphereGeometry(0.11, 6, 4), signal);
      lamp.position.set(x, 8.39, 16.48);
      this.add(lamp);
    }
  }

  private addOperatorTower(side: -1 | 1): void {
    const x = side < 0 ? this.leftBeamOrigin.x : this.rightBeamOrigin.x;
    const frame = this.material(PALETTE.steel.getHex(), 0.7, 0.38);
    const bodyMaterial = this.material(
      side < 0 ? PALETTE.coral.getHex() : PALETTE.cyan.getHex(),
      0.83,
      0.1,
    );
    const eyeMaterial = this.material(PALETTE.cream.getHex(), 0.5, 0, 0.2);

    const deck = this.mesh(new CylinderGeometry(2.15, 2.4, 0.4, 8), frame);
    deck.position.set(x, 5.75, -0.5);
    this.add(deck);
    for (const offset of [-1.25, 1.25]) {
      const leg = this.mesh(new CylinderGeometry(0.14, 0.22, 5.8, 6), frame);
      leg.position.set(x + offset, 2.85, -0.5);
      leg.rotation.z = offset * -0.035;
      this.add(leg);
    }
    const body = this.mesh(new SphereGeometry(0.84, 7, 6), bodyMaterial);
    body.scale.set(0.85, 1.25, 0.72);
    body.position.set(x, 6.95, -0.5);
    this.add(body);
    const crown = this.mesh(new ConeGeometry(0.68, 1.05, 5), bodyMaterial);
    crown.position.set(x + side * 0.08, 8.2, -0.5);
    crown.rotation.z = side * -0.18;
    this.add(crown);
    for (const eyeX of [-0.25, 0.25]) {
      const eye = this.mesh(new SphereGeometry(0.13, 6, 4), eyeMaterial);
      eye.position.set(x + eyeX, 7.2, -1.22);
      this.add(eye);
    }
    const emitter = this.mesh(new CylinderGeometry(0.2, 0.31, 1.25, 7), frame);
    emitter.rotation.x = Math.PI / 2;
    emitter.position.copy(side < 0 ? this.leftBeamOrigin : this.rightBeamOrigin);
    emitter.position.z += 0.55;
    this.add(emitter);
  }

  private mesh<T extends BufferGeometry>(geometry: T, material: Material): Mesh<T, Material> {
    this.ownedGeometries.add(geometry);
    return new Mesh(geometry, material);
  }

  private material(color: number, roughness: number, metalness: number, emissiveIntensity = 0): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
      emissive: emissiveIntensity > 0 ? color : 0,
      emissiveIntensity,
    });
    this.ownedMaterials.add(material);
    return material;
  }
}
