import type { PoleDef, RailDef, SolidDef, WorldConfig } from '../config';
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
    height: rail.top,
    walkable: false,
  };
}

export function poleSolid(pole: PoleDef, world: Pick<WorldConfig, 'poleSize' | 'poleHeight'>): SolidDef {
  return { x: pole.x, z: pole.z, sizeX: world.poleSize, sizeZ: world.poleSize, height: world.poleHeight };
}

/** Tudo que colide: obstáculos, corrimões (AABB fina, não pisável) e postes de luz. */
export function collisionSolids(world: WorldConfig): WorldSolid[] {
  return [
    ...world.boxes,
    ...world.rails.map((r) => railSolid(r, world)),
    ...world.poles.map((p) => poleSolid(p, world)),
  ];
}

/** Segmento de grind do corrimão: o eixo do tubo na altura do topo, com o comprimento do corrimão. */
export function railGrindSegment(rail: RailDef): GrindRail {
  const half = rail.length / 2;
  const dx = rail.axis === 'x' ? half : 0;
  const dz = rail.axis === 'z' ? half : 0;
  return { ax: rail.x - dx, az: rail.z - dz, bx: rail.x + dx, bz: rail.z + dz, y: rail.top, kind: 'rail' };
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
export function grindRails(world: Pick<WorldConfig, 'boxes' | 'rails'>): GrindRail[] {
  return [...world.rails.map(railGrindSegment), ...world.boxes.flatMap(boxGrindEdges)];
}

/** Definição completa do World a partir do config: `new World(worldDef(CONFIG.world))`. */
export function worldDef(world: WorldConfig): WorldDef {
  return { size: world.size, boxes: collisionSolids(world), grindRails: grindRails(world) };
}
