import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
} from "three";
import { FINISH_Z } from "../../content/fieldLayout";
import { PALETTE } from "../constants";

export class CivicPlayground extends Group {
  readonly pickSurface: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly geometries = new Set<BoxGeometry | CylinderGeometry | PlaneGeometry | TorusGeometry>();
  private readonly materials = new Set<MeshStandardMaterial>();

  constructor() {
    super();
    this.name = "civic-playground";
    const groundMaterial = this.material(PALETTE.concrete.getHex(), 1);
    const groundGeometry = this.geometry(new PlaneGeometry(44, 58));
    this.pickSurface = new Mesh(groundGeometry, groundMaterial);
    this.pickSurface.rotation.x = -Math.PI / 2;
    this.pickSurface.position.set(0, -0.04, -7);
    this.pickSurface.receiveShadow = true;
    this.add(this.pickSurface);

    this.addFinishLine();
    this.addDepthSeams();
    this.addFarCivicWall();
    this.addPlayObjects();
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.clear();
  }

  private addFinishLine(): void {
    const bone = this.material(PALETTE.bone.getHex(), 0.86);
    const ink = this.material(PALETTE.ink.getHex(), 0.92);
    const block = this.geometry(new BoxGeometry(1.25, 0.08, 0.72));
    for (let index = 0; index < 16; index += 1) {
      const tile = new Mesh(block, index % 2 === 0 ? bone : ink);
      tile.position.set(-9.375 + index * 1.25, 0.035, FINISH_Z);
      this.add(tile);
    }
    const railGeometry = this.geometry(new BoxGeometry(22, 0.025, 0.07));
    for (const offset of [-0.55, 0.55]) {
      const rail = new Mesh(railGeometry, bone);
      rail.position.set(0, 0.02, FINISH_Z + offset);
      this.add(rail);
    }
  }

  private addDepthSeams(): void {
    const seamMaterial = this.material(0x8e846f, 1);
    const seamGeometry = this.geometry(new BoxGeometry(19.8, 0.016, 0.035));
    for (let z = 2; z >= -30; z -= 4) {
      const seam = new Mesh(seamGeometry, seamMaterial);
      seam.position.set(0, 0.005, z);
      this.add(seam);
    }
  }

  private addFarCivicWall(): void {
    const wallMaterial = this.material(PALETTE.bone.getHex(), 0.95);
    const accentMaterial = this.material(PALETTE.rust.getHex(), 0.9);
    const wall = new Mesh(this.geometry(new BoxGeometry(29, 5.2, 0.85)), wallMaterial);
    wall.position.set(0, 2.55, -35.5);
    this.add(wall);
    for (const x of [-9, 0, 9]) {
      const door = new Mesh(this.geometry(new BoxGeometry(3.2, 3.4, 0.18)), accentMaterial);
      door.position.set(x, 1.7, -35.02);
      this.add(door);
    }
  }

  private addPlayObjects(): void {
    const blue = this.material(PALETTE.civicBlue.getHex(), 0.82);
    const red = this.material(PALETTE.red.getHex(), 0.86);
    const yellow = this.material(PALETTE.yellow.getHex(), 0.86);
    const torus = this.geometry(new TorusGeometry(2.15, 0.28, 7, 24));
    for (const [x, z, material, tilt] of [
      [-14, -7, red, -0.12],
      [14, -18, blue, 0.16],
    ] as const) {
      const ring = new Mesh(torus, material);
      ring.position.set(x, 2.5, z);
      ring.rotation.y = Math.PI / 2 + tilt;
      this.add(ring);
    }
    const post = this.geometry(new CylinderGeometry(0.26, 0.34, 4.6, 7));
    for (const x of [-15.8, -12.2, 12.2, 15.8]) {
      const column = new Mesh(post, x < 0 ? yellow : red);
      column.position.set(x, 2.3, x < 0 ? -22 : -5);
      column.rotation.z = x % 2 === 0 ? 0.08 : -0.08;
      this.add(column);
    }
  }

  private material(color: number, roughness: number): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    this.materials.add(material);
    return material;
  }

  private geometry<T extends BoxGeometry | CylinderGeometry | PlaneGeometry | TorusGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }
}
