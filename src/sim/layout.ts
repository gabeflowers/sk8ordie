import type { PoleDef, RailDef, RampDef, SolidDef, WorldConfig } from '../config';
import type { GrindRail, WorldSolid } from './types';
import type { WorldDef } from './World';

/**
 * AABB fina do corrimão: o tubo, as curvas das pontas e os postes cabem dentro dela.
 * Não é pisável: cair em cima ou trilha (grind) ou passa pelo topo e bate de lado.
 */
export function railSolid(rail: RailDef, world: Pick<WorldConfig, 'railCollisionWidth' | 'railEndMargin'>): WorldSolid {
  const along = rail.length + 2 * world.railEndMargin;
  const across = world.railCollisionWidth;
  return {
    x: rail.x,
    z: rail.z,
    sizeX: rail.axis === 'x' ? along : across,
    sizeZ: rail.axis === 'z' ? along : across,
    height: Math.max(rail.top, rail.topEnd ?? rail.top),
    walkable: false,
  };
}

/**
 * Colisão do corrimão: reto = uma AABB; de escada = várias AABBs curtas em degrau, cada uma
 * subindo no máximo `railPieceRise`, para o próprio trilho não virar parede durante o grind.
 */
export function railSolids(
  rail: RailDef,
  world: Pick<WorldConfig, 'railCollisionWidth' | 'railEndMargin' | 'railPieceRise'>,
  railId?: number,
): WorldSolid[] {
  const end = rail.topEnd ?? rail.top;
  const rise = Math.abs(end - rail.top);
  if (rise <= world.railPieceRise) return [{ ...railSolid(rail, world), railId }];
  const n = Math.ceil(rise / world.railPieceRise);
  const along = rail.length + 2 * world.railEndMargin;
  const piece = along / n;
  const pieces: WorldSolid[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = -along / 2 + i * piece;
    const center = s0 + piece / 2;
    const h0 = rail.top + ((end - rail.top) * (s0 + along / 2)) / along;
    const h1 = rail.top + ((end - rail.top) * (s0 + piece + along / 2)) / along;
    pieces.push({
      x: rail.axis === 'x' ? rail.x + center : rail.x,
      z: rail.axis === 'z' ? rail.z + center : rail.z,
      sizeX: rail.axis === 'x' ? piece : world.railCollisionWidth,
      sizeZ: rail.axis === 'z' ? piece : world.railCollisionWidth,
      height: Math.max(h0, h1),
      walkable: false,
      railId,
    });
  }
  return pieces;
}

export function poleSolid(pole: PoleDef, world: Pick<WorldConfig, 'poleSize' | 'poleHeight'>): SolidDef {
  return { x: pole.x, z: pole.z, sizeX: world.poleSize, sizeZ: world.poleSize, height: world.poleHeight };
}

/** Tudo que colide: obstáculos, corrimões (AABB fina, não pisável) e postes de luz. */
export function collisionSolids(world: WorldConfig): WorldSolid[] {
  return [
    ...world.boxes,
    ...world.rails.flatMap((r, i) => railSolids(r, world, i)),
    ...world.poles.map((p) => poleSolid(p, world)),
  ];
}

/** Segmento de grind do corrimão: o eixo do tubo na altura do topo, com o comprimento do corrimão. */
export function railGrindSegment(rail: RailDef, railId?: number): GrindRail {
  const half = rail.length / 2;
  const dx = rail.axis === 'x' ? half : 0;
  const dz = rail.axis === 'z' ? half : 0;
  const seg: GrindRail = { ax: rail.x - dx, az: rail.z - dz, bx: rail.x + dx, bz: rail.z + dz, y: rail.top, kind: 'rail' };
  if (rail.topEnd !== undefined) seg.by = rail.topEnd;
  if (railId !== undefined) seg.railId = railId;
  return seg;
}

/** As 4 arestas do topo de uma caixa (contorno fechado na altura do topo). */
export function boxGrindEdges(box: SolidDef): GrindRail[] {
  const x0 = box.x - box.sizeX / 2;
  const x1 = box.x + box.sizeX / 2;
  const z0 = box.z - box.sizeZ / 2;
  const z1 = box.z + box.sizeZ / 2;
  const y = box.height;
  return [
    { ax: x0, az: z0, bx: x1, bz: z0, y, kind: 'edge' },
    { ax: x1, az: z0, bx: x1, bz: z1, y, kind: 'edge' },
    { ax: x1, az: z1, bx: x0, bz: z1, y, kind: 'edge' },
    { ax: x0, az: z1, bx: x0, bz: z0, y, kind: 'edge' },
  ];
}

/** Tudo que dá para trilhar: corrimões e as arestas do topo dos obstáculos (crates, ledges, pads). */
/** Coping do quarter pipe: a aresta do topo, ao longo da largura. */
export function copingSegment(ramp: RampDef): GrindRail {
  const alongX = ramp.dir.startsWith('x');
  const sign = ramp.dir.endsWith('+') ? 1 : -1;
  const lip = (alongX ? ramp.x : ramp.z) + (sign * ramp.length) / 2;
  const half = ramp.width / 2;
  return alongX
    ? { ax: lip, az: ramp.z - half, bx: lip, bz: ramp.z + half, y: ramp.height, kind: 'edge' }
    : { ax: ramp.x - half, az: lip, bx: ramp.x + half, bz: lip, y: ramp.height, kind: 'edge' };
}

export function grindRails(world: Pick<WorldConfig, 'boxes' | 'rails'> & { ramps?: readonly RampDef[] }): GrindRail[] {
  return [
    ...world.rails.map((r, i) => railGrindSegment(r, i)),
    ...world.boxes.flatMap(boxGrindEdges),
    ...(world.ramps ?? []).filter((r) => r.profile === 'quarter').map(copingSegment),
  ];
}

/** Definição completa do World a partir do config: `new World(worldDef(CONFIG.world))`. */
export function worldDef(world: WorldConfig): WorldDef {
  return {
    size: world.size,
    boxes: collisionSolids(world),
    grindRails: grindRails(world),
    ramps: world.ramps,
    rampTolerance: world.rampTolerance,
    quarterTolerance: world.quarterTolerance,
    quarterMaxAngle: world.quarterMaxAngle,
  };
}
