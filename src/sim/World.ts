import { MathUtils, type Vector3 } from 'three';
import { toGrindSegment, type GrindSegment } from './grind';
import { EPSILON } from './math';
import type { RampDef } from '../config';
import type { Aabb, GrindRail, WorldSolid } from './types';

export interface WorldDef {
  size: number;
  boxes: readonly WorldSolid[];
  /** Segmentos trilháveis (ver `grindRails` em layout.ts). Sem eles não há grind. */
  grindRails?: readonly GrindRail[];
  /** Rampas em cunha (kicker/bank). */
  ramps?: readonly RampDef[];
  /** numa rampa, o chão pode subir até isso acima de maxTop (subir a cunha rápido) */
  rampTolerance?: number;
  /** idem na transição curva do quarter pipe */
  quarterTolerance?: number;
  quarterMaxAngle?: number;
}

/** Rampa pré-calculada: pegada AABB, altura máxima e o eixo/sentido em que sobe. */
export interface Ramp {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  axis: 'x' | 'z';
  sign: 1 | -1;
  quarter: boolean;
}

/** Parâmetro da transição curva: seno do ângulo máximo (o perfil é um arco de círculo). */
let quarterSin = Math.sin((68 * Math.PI) / 180);

function toRamp(r: RampDef): Ramp {
  const alongX = r.dir.startsWith('x');
  const sx = alongX ? r.length : r.width;
  const sz = alongX ? r.width : r.length;
  return {
    minX: r.x - sx / 2,
    maxX: r.x + sx / 2,
    minZ: r.z - sz / 2,
    maxZ: r.z + sz / 2,
    height: r.height,
    axis: alongX ? 'x' : 'z',
    sign: r.dir.endsWith('+') ? 1 : -1,
    quarter: r.profile === 'quarter',
  };
}

/** Altura da superfície da rampa em (x, z) (fora da pegada, extrapola presa às bordas). */
export function rampHeightAt(r: Ramp, x: number, z: number): number {
  const lo = r.axis === 'x' ? r.minX : r.minZ;
  const hi = r.axis === 'x' ? r.maxX : r.maxZ;
  const p = r.axis === 'x' ? x : z;
  const t = MathUtils.clamp((p - lo) / (hi - lo), 0, 1);
  const u = r.sign > 0 ? t : 1 - t;
  return r.height * rampProfile(r, u);
}

/** Perfil normalizado (0..1) ao longo da rampa: reto, ou arco de círculo no quarter pipe. */
export function rampProfile(r: Pick<Ramp, 'quarter'>, u: number): number {
  if (!r.quarter) return u;
  const s = quarterSin;
  return (1 - Math.sqrt(1 - (u * s) ** 2)) / (1 - Math.sqrt(1 - s * s));
}

function toAabb(b: WorldSolid): Aabb {
  return {
    minX: b.x - b.sizeX / 2,
    maxX: b.x + b.sizeX / 2,
    minZ: b.z - b.sizeZ / 2,
    maxZ: b.z + b.sizeZ / 2,
    top: b.height,
    walkable: b.walkable ?? true,
    railId: b.railId,
  };
}

/** Geometria estática do mapa: chão em y = 0, caixas AABB, segmentos de grind e limites quadrados. */
export class World {
  readonly boxes: readonly Aabb[];
  readonly grindSegments: readonly GrindSegment[];
  readonly halfSize: number;
  readonly ramps: readonly Ramp[];
  readonly rampTolerance: number;
  readonly quarterTolerance: number;

  constructor(def: WorldDef) {
    if (def.quarterMaxAngle !== undefined) quarterSin = Math.sin(def.quarterMaxAngle);
    this.quarterTolerance = def.quarterTolerance ?? 0;
    this.boxes = def.boxes.map(toAabb);
    this.ramps = (def.ramps ?? []).map(toRamp);
    this.rampTolerance = def.rampTolerance ?? 0;
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
    // rampas: a superfície inclinada conta como chão (com folga para subir rápido)
    for (const r of this.ramps) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const rh = rampHeightAt(r, x, z);
      if (rh <= maxTop + (r.quarter ? this.quarterTolerance : this.rampTolerance) && rh > h) h = rh;
    }
    return h;
  }

  /**
   * Empurra o círculo (raio no plano XZ) para fora das caixas com top > minWallTop.
   * Retorna true se houve contato; `outNormal` recebe a normal média (unitária, XZ).
   */
  resolveCircleCollisions(pos: Vector3, radius: number, minWallTop: number, outNormal: Vector3, ignoreRail?: number): boolean {
    let hit = false;
    outNormal.set(0, 0, 0);

    for (const b of this.boxes) {
      if (b.top <= minWallTop) continue;
      if (ignoreRail !== undefined && b.railId === ignoreRail) continue;
      if (this.pushOut(pos, radius, b, outNormal)) hit = true;
    }

    // rampa só é parede onde a superfície está bem acima do pé (lateral alta, ponta do lip)
    for (const r of this.ramps) {
      const cx = MathUtils.clamp(pos.x, r.minX, r.maxX);
      const cz = MathUtils.clamp(pos.z, r.minZ, r.maxZ);
      if (rampHeightAt(r, cx, cz) <= minWallTop + (r.quarter ? this.quarterTolerance : this.rampTolerance)) continue;
      if (this.pushOut(pos, radius, r, outNormal)) hit = true;
    }

    if (hit && outNormal.lengthSq() > EPSILON) outNormal.normalize();
    return hit;
  }

  /** Empurra o círculo para fora de uma pegada AABB; soma a normal em `outNormal`. */
  private pushOut(
    pos: Vector3,
    radius: number,
    b: { minX: number; maxX: number; minZ: number; maxZ: number },
    outNormal: Vector3,
  ): boolean {
      const dx = pos.x - MathUtils.clamp(pos.x, b.minX, b.maxX);
      const dz = pos.z - MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) return false;

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
      return true;
  }

  /** Quarter pipe sob o ponto (se houver). */
  quarterAt(x: number, z: number): Ramp | null {
    for (const r of this.ramps) {
      if (r.quarter && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r;
    }
    return null;
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
