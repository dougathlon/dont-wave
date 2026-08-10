import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3DEventMap,
} from "three";
import { PALETTE, WORLD } from "../constants";

type StageMesh = Mesh<BufferGeometry, Material, Object3DEventMap>;

/** Static, procedural municipal playground. It is scenery, never game state. */
export class CivicPlayground extends Group {
  readonly pickSurface: StageMesh;
  private readonly ownedGeometries = new Set<BufferGeometry>();
  private readonly ownedMaterials = new Set<Material>();

  constructor() {
    super();
    this.name = "civic-playground";

    const groundMaterial = this.material(PALETTE.field.getHex(), 0.88, 0.08);
    this.pickSurface = this.mesh(new PlaneGeometry(WORLD.fieldWidth, 39), groundMaterial);
    this.pickSurface.name = "field-pick-surface";
    this.pickSurface.rotation.x = -Math.PI / 2;
    this.pickSurface.position.set(0, -0.07, -2.4);
    this.add(this.pickSurface);

    const boundary = this.mesh(
      new PlaneGeometry(WORLD.fieldWidth + 5.5, 44),
      this.material(PALETTE.aubergine.getHex(), 0.96, 0.02),
    );
    boundary.rotation.x = -Math.PI / 2;
    boundary.position.set(0, -0.13, -2.5);
    this.add(boundary);

    // Soft-surface islands turn a familiar civic playground into an inspection diagram.
    this.addRubberIsland(-10.7, -5.7, 3.3, PALETTE.coral.getHex());
    this.addRubberIsland(10.4, 3.8, 2.8, PALETTE.cyan.getHex());
    this.addRubberIsland(8.7, -10.2, 2.4, PALETTE.chartreuse.getHex());

    this.addRoundabout(-10.5, -5.7);
    this.addClimbingFrame(9.9, 3.8);
    this.addSpringRider(8.8, -10.1, -0.25);
    this.addSpringRider(-8.5, 7.3, Math.PI + 0.35);
    this.addBenches();
    this.addCheckpoint();
    this.addBoundaryRails();
    this.addSurveyMarks();
  }

  dispose(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedGeometries.clear();
    this.ownedMaterials.clear();
    this.clear();
  }

  private addRubberIsland(x: number, z: number, radius: number, color: number): void {
    const island = this.mesh(
      new CylinderGeometry(radius, radius * 1.04, 0.08, 16),
      this.material(color, 1, 0.03),
    );
    island.position.set(x, 0, z);
    this.add(island);
  }

  private addRoundabout(x: number, z: number): void {
    const steel = this.material(PALETTE.dirtyCream.getHex(), 0.76, 0.32);
    const deck = this.mesh(new CylinderGeometry(1.75, 1.75, 0.18, 12), steel);
    deck.position.set(x, 0.21, z);
    this.add(deck);

    const hub = this.mesh(new CylinderGeometry(0.16, 0.16, 1.8, 7), steel);
    hub.position.set(x, 1.03, z);
    this.add(hub);
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const angle = spoke / 6 * Math.PI * 2;
      const rail = this.mesh(new BoxGeometry(1.45, 0.09, 0.09), steel);
      rail.position.set(x + Math.cos(angle) * 0.72, 1.48, z + Math.sin(angle) * 0.72);
      rail.rotation.y = -angle;
      this.add(rail);
    }
  }

  private addClimbingFrame(x: number, z: number): void {
    const railMaterial = this.material(PALETTE.cream.getHex(), 0.67, 0.28);
    const capMaterial = this.material(PALETTE.cyan.getHex(), 0.88, 0.14);
    for (const xOffset of [-1.45, 1.45]) {
      for (const zOffset of [-1.15, 1.15]) {
        const post = this.mesh(new CylinderGeometry(0.09, 0.11, 3.6, 6), railMaterial);
        post.position.set(x + xOffset, 1.8, z + zOffset);
        this.add(post);
        const cap = this.mesh(new SphereGeometry(0.2, 7, 5), capMaterial);
        cap.position.set(x + xOffset, 3.65, z + zOffset);
        this.add(cap);
      }
    }
    for (const y of [0.9, 1.8, 2.7, 3.55]) {
      for (const zOffset of [-1.15, 1.15]) {
        const rung = this.mesh(new CylinderGeometry(0.065, 0.065, 2.9, 6), railMaterial);
        rung.rotation.z = Math.PI / 2;
        rung.position.set(x, y, z + zOffset);
        this.add(rung);
      }
    }
    const roof = this.mesh(new TorusGeometry(1.45, 0.08, 5, 12, Math.PI), railMaterial);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(x, 3.55, z - 1.14);
    this.add(roof);
  }

  private addSpringRider(x: number, z: number, rotation: number): void {
    const spring = this.mesh(
      new TorusGeometry(0.22, 0.06, 5, 16, Math.PI * 1.7),
      this.material(PALETTE.cream.getHex(), 0.72, 0.35),
    );
    spring.rotation.x = Math.PI / 2;
    spring.position.set(x, 0.45, z);
    this.add(spring);

    const body = this.mesh(
      new SphereGeometry(0.72, 7, 5),
      this.material(PALETTE.rust.getHex(), 0.96, 0.08),
    );
    body.scale.set(1.35, 0.68, 0.55);
    body.rotation.y = rotation;
    body.position.set(x, 1.25, z);
    this.add(body);

    const neck = this.mesh(
      new CylinderGeometry(0.22, 0.34, 1.1, 6),
      this.material(PALETTE.coral.getHex(), 0.86, 0.11),
    );
    neck.rotation.z = -0.42;
    neck.rotation.y = rotation;
    neck.position.set(x + Math.cos(rotation) * 0.64, 1.75, z - Math.sin(rotation) * 0.64);
    this.add(neck);
  }

  private addBenches(): void {
    const seatMaterial = this.material(PALETTE.dirtyCream.getHex(), 0.95, 0.04);
    const frameMaterial = this.material(PALETTE.ink.getHex(), 0.78, 0.2);
    for (const [x, z, rotation] of [
      [-12.6, 1.5, Math.PI / 2],
      [12.6, -3.2, -Math.PI / 2],
      [-11.5, -12.4, Math.PI / 2],
    ] as const) {
      const bench = new Group();
      const seat = this.mesh(new BoxGeometry(2.8, 0.18, 0.58), seatMaterial);
      seat.position.y = 0.7;
      bench.add(seat);
      const back = this.mesh(new BoxGeometry(2.8, 0.8, 0.14), seatMaterial);
      back.position.set(0, 1.15, 0.28);
      bench.add(back);
      for (const legX of [-1.02, 1.02]) {
        const leg = this.mesh(new BoxGeometry(0.12, 0.72, 0.45), frameMaterial);
        leg.position.set(legX, 0.35, 0);
        bench.add(leg);
      }
      bench.position.set(x, 0, z);
      bench.rotation.y = rotation;
      this.add(bench);
    }
  }

  private addCheckpoint(): void {
    const frameMaterial = this.material(PALETTE.cream.getHex(), 0.72, 0.26);
    const signalMaterial = this.material(PALETTE.cyan.getHex(), 0.86, 0.16);
    for (const x of [-13.7, 13.7]) {
      const column = this.mesh(new BoxGeometry(0.62, 5.4, 0.8), frameMaterial);
      column.position.set(x, 2.7, WORLD.checkpointZ);
      this.add(column);
    }
    const lintel = this.mesh(new BoxGeometry(28, 0.62, 0.82), frameMaterial);
    lintel.position.set(0, 5.12, WORLD.checkpointZ);
    this.add(lintel);
    for (let index = 0; index < 9; index += 1) {
      const lamp = this.mesh(new SphereGeometry(0.16, 7, 5), signalMaterial);
      lamp.position.set(-11.8 + index * 2.95, 5.13, WORLD.checkpointZ + 0.46);
      this.add(lamp);
    }
  }

  private addBoundaryRails(): void {
    const material = this.material(PALETTE.steel.getHex(), 0.84, 0.2);
    for (const side of [-1, 1]) {
      const x = side * (WORLD.fieldWidth / 2 + 0.42);
      for (let z = -14; z <= 13; z += 3.4) {
        const post = this.mesh(new CylinderGeometry(0.07, 0.08, 1.05, 5), material);
        post.position.set(x, 0.52, z);
        this.add(post);
      }
      for (const y of [0.4, 0.87]) {
        const rail = this.mesh(new CylinderGeometry(0.045, 0.045, 28, 5), material);
        rail.rotation.x = Math.PI / 2;
        rail.position.set(x, y, -0.5);
        this.add(rail);
      }
    }
  }

  private addSurveyMarks(): void {
    const material = this.material(PALETTE.cream.getHex(), 1, 0.02, true);
    for (let z = 10.5; z > WORLD.checkpointZ; z -= 3.2) {
      const mark = this.mesh(new RingGeometry(0.17, 0.25, 8), material);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(0, 0.025, z);
      this.add(mark);
    }
  }

  private mesh<T extends BufferGeometry>(geometry: T, material: Material): Mesh<T, Material> {
    this.ownedGeometries.add(geometry);
    return new Mesh(geometry, material);
  }

  private material(color: number, roughness: number, metalness: number, doubleSided = false): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
    if (doubleSided) material.side = DoubleSide;
    this.ownedMaterials.add(material);
    return material;
  }
}
