import { MathUtils, type Vector3 } from 'three';
import { toGrindSegment, type GrindSegment } from './grind';
import { EPSILON } from './math';
import type { Aabb, GrindRail, WorldSolid } from './types';

export interface WorldDef {
  size: number;
  boxes: readonly WorldSolid[];
  /** Segmentos trilháveis (ver `grindRails` em layout.ts). Sem eles não há grind. */
  grindRails?: readonly GrindRail[];
}

function toAabb(b: WorldSolid): Aabb {
  return {
    minX: b.x - b.sizeX / 2,
    maxX: b.x + b.sizeX / 2,
    minZ: b.z - b.sizeZ / 2,
    maxZ: b.z + b.sizeZ / 2,
    top: b.height,
    walkable: b.walkable ?? true,
  };
}

/** Geometria estática do mapa: chão em y = 0, caixas AABB, segmentos de grind e limites quadrados. */
export class World {
  readonly boxes: readonly Aabb[];
  readonly grindSegments: readonly GrindSegment[];
  readonly halfSize: number;

  constructor(def: WorldDef) {
    this.boxes = def.boxes.map(toAabb);
    this.grindSegments = (def.grindRails ?? []).flatMap((r) => toGrindSegment(r) ?? []);
    this.halfSize = def.size / 2;
  }

  /**
   * Altura do chão sob (x, z): o maior topo de caixa pisável que contém o ponto com
   * top <= maxTop (normalmente pé + stepTolerance); senão 0.
   */
  groundHeightAt(x: number, z: number, maxTop: number): number {
    let h = 0;
    for (const b of this.boxes) {
      if (!b.walkable) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.top <= maxTop && b.top > h) h = b.top;
    }
    return h;
  }

  /**
   * Empurra o círculo (raio no plano XZ) para fora das caixas com top > minWallTop.
   * Retorna true se houve contato; `outNormal` recebe a normal média (unitária, XZ).
   */
  resolveCircleCollisions(pos: Vector3, radius: number, minWallTop: number, outNormal: Vector3): boolean {
    let hit = false;
    outNormal.set(0, 0, 0);

    for (const b of this.boxes) {
      if (b.top <= minWallTop) continue;

      const dx = pos.x - MathUtils.clamp(pos.x, b.minX, b.maxX);
      const dz = pos.z - MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;

      let nx: number;
      let nz: number;
      let push: number;

      if (d2 > EPSILON) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        push = radius - d;
      } else {
        // centro dentro da caixa: sai pelo eixo de menor penetração
        const toMinX = pos.x - b.minX;
        const toMaxX = b.maxX - pos.x;
        const toMinZ = pos.z - b.minZ;
        const toMaxZ = b.maxZ - pos.z;
        const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
        if (m === toMinX) [nx, nz] = [-1, 0];
        else if (m === toMaxX) [nx, nz] = [1, 0];
        else if (m === toMinZ) [nx, nz] = [0, -1];
        else [nx, nz] = [0, 1];
        push = m + radius;
      }

      pos.x += nx * push;
      pos.z += nz * push;
      outNormal.x += nx;
      outNormal.z += nz;
      hit = true;
    }

    if (hit && outNormal.lengthSq() > EPSILON) outNormal.normalize();
    return hit;
  }

  /** Mantém o círculo dentro do mapa e zera a velocidade no eixo que bateu. */
  clampToBounds(pos: Vector3, velocity: Vector3, radius: number): void {
    const lim = this.halfSize - radius;
    if (pos.x > lim || pos.x < -lim) {
      pos.x = MathUtils.clamp(pos.x, -lim, lim);
      velocity.x = 0;
    }
    if (pos.z > lim || pos.z < -lim) {
      pos.z = MathUtils.clamp(pos.z, -lim, lim);
      velocity.z = 0;
    }
  }
}
