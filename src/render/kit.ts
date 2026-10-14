import {
  BoxGeometry,
  CurvePath,
  CylinderGeometry,
  Group,
  LineCurve3,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { BoxDef, PoleDef, RailDef, VisualConfig, WorldConfig } from '../config';
import { forwardFromYaw } from '../sim/math';
import { merge, paint, placeYaw } from './geometry';

/** Postes colidíveis + decorativos fora do limite do mapa, com os braços virados para dentro. */
export function allPoles(world: WorldConfig, visual: VisualConfig): PoleDef[] {
  const off = visual.pole.boundaryOffset;
  const boundary: PoleDef[] = [];
  for (const s of visual.pole.boundaryPositions) {
    boundary.push({ x: off, z: s, armYaw: -Math.PI / 2 });
    boundary.push({ x: -off, z: s, armYaw: Math.PI / 2 });
    boundary.push({ x: s, z: off, armYaw: Math.PI });
    boundary.push({ x: s, z: -off, armYaw: 0 });
  }
  return [...world.poles, ...boundary];
}

/** Centro da poça de luz: embaixo da luminária, na ponta do braço. */
export function lampPosition(pole: PoleDef, visual: VisualConfig): Vector3 {
  return forwardFromYaw(pole.armYaw).multiplyScalar(visual.pole.armLength).add(new Vector3(pole.x, 0, pole.z));
}

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(sx, sy, sz).translate(x, y, z);
}

/** Réguas finas nas 4 arestas do topo, com a face externa no limite da AABB. */
function edgeStrips(b: BoxDef, width: number, height: number): BufferGeometry[] {
  const y = b.height - height / 2;
  const innerZ = b.sizeZ - 2 * width;
  return [
    box(b.sizeX, height, width, b.x, y, b.z - b.sizeZ / 2 + width / 2),
    box(b.sizeX, height, width, b.x, y, b.z + b.sizeZ / 2 - width / 2),
    box(width, height, innerZ, b.x - b.sizeX / 2 + width / 2, y, b.z),
    box(width, height, innerZ, b.x + b.sizeX / 2 - width / 2, y, b.z),
  ];
}

/** Cantoneira nas duas arestas longas do topo do ledge. */
function copings(b: BoxDef, size: number): BufferGeometry[] {
  const y = b.height - size / 2;
  if (b.sizeZ >= b.sizeX) {
    return [-1, 1].map((s) => box(size, size, b.sizeZ, b.x + s * (b.sizeX / 2 - size / 2), y, b.z));
  }
  return [-1, 1].map((s) => box(b.sizeX, size, size, b.x, y, b.z + s * (b.sizeZ / 2 - size / 2)));
}

/** Corrimão de escola: tubo com as pontas descendo em curva até o chão, mais postes intermediários. */
function railParts(rail: RailDef, visual: VisualConfig): { tube: BufferGeometry; posts: BufferGeometry[] } {
  const r = visual.rail;
  const c = rail.top - r.tubeRadius; // altura da linha central do tubo
  const b = r.bendRadius;
  const s0 = -rail.length / 2;
  const s1 = rail.length / 2;

  const path = new CurvePath<Vector3>();
  path.add(new LineCurve3(new Vector3(s0, 0, 0), new Vector3(s0, c - b, 0)));
  path.add(new QuadraticBezierCurve3(new Vector3(s0, c - b, 0), new Vector3(s0, c, 0), new Vector3(s0 + b, c, 0)));
  path.add(new LineCurve3(new Vector3(s0 + b, c, 0), new Vector3(s1 - b, c, 0)));
  path.add(new QuadraticBezierCurve3(new Vector3(s1 - b, c, 0), new Vector3(s1, c, 0), new Vector3(s1, c - b, 0)));
  path.add(new LineCurve3(new Vector3(s1, c - b, 0), new Vector3(s1, 0, 0)));

  const yaw = rail.axis === 'x' ? 0 : -Math.PI / 2;
  const at = new Vector3(rail.x, 0, rail.z);
  const tube = placeYaw(new TubeGeometry(path, r.tubularSegments, r.tubeRadius, r.radialSegments, false), at, yaw);

  const spans = Math.ceil(rail.length / r.postSpacing);
  const posts: BufferGeometry[] = [];
  for (let k = 1; k < spans; k++) {
    const s = s0 + (k * rail.length) / spans;
    const post = new CylinderGeometry(r.postRadius, r.postRadius, c, r.radialSegments).translate(s, c / 2, 0);
    posts.push(placeYaw(post, at, yaw));
  }
  return { tube, posts };
}

/** Poste de luz: haste, braço e luminária (a luminária vai num material próprio). */
function poleParts(pole: PoleDef, world: WorldConfig, visual: VisualConfig): { metal: BufferGeometry[]; lamp: BufferGeometry } {
  const p = visual.pole;
  const h = world.poleHeight;
  const at = new Vector3(pole.x, 0, pole.z);
  // braço e luminária modelados ao longo de +X e girados para armYaw
  const yaw = pole.armYaw - Math.PI / 2;
  const shaft = new CylinderGeometry(p.shaftRadius, p.shaftRadius, h, p.segments).translate(pole.x, h / 2, pole.z);
  const arm = placeYaw(new BoxGeometry(p.armLength, p.armThickness, p.armThickness).translate(p.armLength / 2, h - p.armThickness / 2, 0), at, yaw);
  const lamp = placeYaw(
    new BoxGeometry(p.headLength, p.headHeight, p.headWidth).translate(p.armLength, h - p.armThickness - p.headHeight / 2, 0),
    at,
    yaw,
  );
  return { metal: [shaft, arm], lamp };
}

/** Meio-fio em volta do mapa, fora da área jogável. */
function curbs(world: WorldConfig, visual: VisualConfig): BufferGeometry[] {
  const k = visual.kit;
  const d = world.size / 2 + k.curbOffset + k.curbWidth / 2;
  const len = world.size + 2 * (k.curbOffset + k.curbWidth);
  const y = k.curbHeight / 2;
  return [
    box(len, k.curbHeight, k.curbWidth, 0, y, d),
    box(len, k.curbHeight, k.curbWidth, 0, y, -d),
    box(k.curbWidth, k.curbHeight, len, d, y, 0),
    box(k.curbWidth, k.curbHeight, len, -d, y, 0),
  ];
}

/**
 * Kit de pista inteiro em 4 draw calls: concreto/compensado (vertexColors), acento magenta
 * chapado, metal e luminárias. O visual nunca passa da AABB de colisão.
 */
export function buildKit(world: WorldConfig, visual: VisualConfig): Group {
  const k = visual.kit;
  const pal = visual.palette;
  const solid: BufferGeometry[] = [];
  const accent: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  const lamps: BufferGeometry[] = [];

  for (const b of world.boxes) {
    const h = b.height - k.bodyInset;
    const body = box(b.sizeX - 2 * k.bodyInset, h, b.sizeZ - 2 * k.bodyInset, b.x, h / 2, b.z);
    solid.push(paint(body, b.kind === 'crate' ? pal.plywood : pal.concrete));
    if (b.kind === 'ledge') accent.push(...copings(b, k.copingSize));
    else accent.push(...edgeStrips(b, b.kind === 'pad' ? k.edgeStripWidth : k.crateStripWidth, k.stripHeight));
  }
  for (const c of curbs(world, visual)) solid.push(paint(c, pal.concrete));

  for (const rail of world.rails) {
    const { tube, posts } = railParts(rail, visual);
    accent.push(tube);
    metal.push(...posts);
  }

  for (const pole of allPoles(world, visual)) {
    const parts = poleParts(pole, world, visual);
    metal.push(...parts.metal);
    lamps.push(parts.lamp);
  }

  const group = new Group();
  const solidMesh = new Mesh(merge(solid), new MeshStandardMaterial({ vertexColors: true, roughness: k.roughness }));
  const accentMesh = new Mesh(merge(accent), new MeshBasicMaterial({ color: pal.accent }));
  const metalMesh = new Mesh(merge(metal), new MeshStandardMaterial({ color: pal.metal, roughness: k.roughness }));
  const lampMesh = new Mesh(merge(lamps), new MeshBasicMaterial({ color: pal.lampHead }));
  for (const m of [solidMesh, accentMesh, metalMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(solidMesh, accentMesh, metalMesh, lampMesh);
  return group;
}
