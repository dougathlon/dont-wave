import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { PALETTE } from "../constants";

export class RivalTowers extends Group {
  readonly leftBeamOrigin = new Vector3(-10.55, 6.55, -3.45);
  readonly rightBeamOrigin = new Vector3(10.55, 6.55, -3.45);
  private readonly geometries = new Set<BoxGeometry | CylinderGeometry | SphereGeometry>();
  private readonly materials = new Set<MeshStandardMaterial>();

  constructor() {
    super();
    this.name = "rival-towers";
    this.add(this.createTower("left"), this.createTower("right"));
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.clear();
  }

  private createTower(side: "left" | "right"): Group {
    const sign = side === "left" ? -1 : 1;
    const group = new Group();
    const dark = this.material(PALETTE.ink.getHex(), 0.66, 0.22);
    const color = this.material((side === "left" ? PALETTE.left : PALETTE.right).getHex(), 0.72, 0.08);
    const column = new Mesh(this.geometry(new CylinderGeometry(0.72, 1.05, 6.4, 7)), dark);
    column.position.set(sign * 11.8, 3.2, -4.45);
    const cabin = new Mesh(this.geometry(new BoxGeometry(3.2, 1.65, 2.35)), color);
    cabin.position.set(sign * 11.8, 6.05, -4.6);
    cabin.rotation.y = sign * -0.08;
    const eye = new Mesh(this.geometry(new SphereGeometry(0.34, 8, 6)), dark);
    eye.position.set(sign * 10.55, 6.5, -3.45);
    const muzzle = new Mesh(this.geometry(new CylinderGeometry(0.13, 0.18, 1.25, 7)), dark);
    muzzle.position.copy(side === "left" ? this.leftBeamOrigin : this.rightBeamOrigin);
    muzzle.rotation.x = Math.PI / 2;
    group.add(column, cabin, eye, muzzle);
    return group;
  }

  private material(color: number, roughness: number, metalness: number): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness, metalness });
    this.materials.add(material);
    return material;
  }

  private geometry<T extends BoxGeometry | CylinderGeometry | SphereGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }
}
