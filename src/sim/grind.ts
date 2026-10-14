import type { Vector3 } from 'three';
import type { SimConfig } from '../config';
import { EPSILON, horizontalSpeed, wrapAngle } from './math';
import type { GrindRail, GrindType } from './types';

const HALF_PI = Math.PI / 2;

export type GrindTypeConfig = Pick<SimConfig, 'grindFiftyFiftyAngle' | 'grindBoardslideTolerance'>;

export type GrindSnapConfig = GrindTypeConfig &
  Pick<SimConfig, 'grindSnapBelow' | 'grindSnapAbove' | 'grindSnapDistance' | 'grindMaxApproachAngle' | 'grindMinSpeed'>;

/** Segmento de grind com o referencial pré-calculado: comprimento e tangente unitária a → b (XZ). */
export interface GrindSegment {
  rail: GrindRail;
  length: number;
  tx: number;
  tz: number;
}

/** Pré-calcula o referencial; null para segmento degenerado (comprimento ~0). */
export function toGrindSegment(rail: GrindRail): GrindSegment | null {
  const dx = rail.bx - rail.ax;
  const dz = rail.bz - rail.az;
  const length = Math.hypot(dx, dz);
  if (length <= EPSILON) return null;
  return { rail, length, tx: dx / length, tz: dz / length };
}

/** Ângulo entre o shape (uma linha: yaw módulo π) e uma direção do segmento, em [0, π/2]. */
export function boardRailAngle(yaw: number, railHeading: number): number {
  const a = Math.abs(wrapAngle(yaw - railHeading)); // [0, π]
  return a > HALF_PI ? Math.PI - a : a;
}

/** 50-50 com o shape alinhado ao trilho, boardslide com ele atravessado; senão não engata. */
export function classifyGrind(yaw: number, railHeading: number, cfg: GrindTypeConfig): GrindType | null {
  const a = boardRailAngle(yaw, railHeading);
  if (a <= cfg.grindFiftyFiftyAngle) return '5050';
  if (Math.abs(a - HALF_PI) <= cfg.grindBoardslideTolerance) return 'boardslide';
  return null;
}

/**
 * Yaw travado durante o grind: a direção válida (alinhada no 50-50, perpendicular no
 * boardslide; qualquer um dos dois sentidos) mais próxima de `yaw`, sem dar voltas.
 */
export function lockedGrindYaw(yaw: number, railHeading: number, type: GrindType): number {
  const base = type === '5050' ? railHeading : railHeading + HALF_PI;
  let d = wrapAngle(base - yaw); // [-π, π)
  if (d > HALF_PI) d -= Math.PI;
  else if (d < -HALF_PI) d += Math.PI;
  return yaw + d;
}

/** Resultado do snap: onde engatar e com que velocidade. */
export interface GrindSnap {
  segment: GrindSegment;
  type: GrindType;
  /** ponto do segmento mais próximo do centro do skater (XZ) */
  x: number;
  z: number;
  /** tangente unitária no sentido do movimento */
  dirX: number;
  dirZ: number;
  /** velocidade ao longo da tangente (a componente lateral se perde) */
  speed: number;
}

/**
 * Procura o segmento em que o skater engata neste passo (o mais próximo em XZ), ou null.
 * `pos` é a posição no fim do passo; `prevFootY`, o pé no início (a janela vertical vale
 * para o intervalo entre os dois, para uma queda rápida não atravessar o trilho).
 */
export function findGrindSnap(
  segments: readonly GrindSegment[],
  pos: Vector3,
  prevFootY: number,
  velocity: Vector3,
  yaw: number,
  cfg: GrindSnapConfig,
): GrindSnap | null {
  if (segments.length === 0 || velocity.y > 0) return null;

  const speed = horizontalSpeed(velocity);
  if (speed < cfg.grindMinSpeed) return null;
  // |v · t| >= speed·cos(ângulo máx.) <=> velocidade dentro do cone do segmento
  const minAlong = Math.max(cfg.grindMinSpeed, speed * Math.cos(cfg.grindMaxApproachAngle));

  const footLo = Math.min(prevFootY, pos.y);
  const footHi = Math.max(prevFootY, pos.y);

  let best: GrindSnap | null = null;
  let bestDist = Infinity;

  for (const seg of segments) {
    const r = seg.rail;
    if (footHi < r.y - cfg.grindSnapBelow || footLo > r.y + cfg.grindSnapAbove) continue;

    const rx = pos.x - r.ax;
    const rz = pos.z - r.az;
    const s = rx * seg.tx + rz * seg.tz;
    if (s < 0 || s > seg.length) continue; // fora das pontas

    const dist = Math.abs(rx * seg.tz - rz * seg.tx);
    if (dist > cfg.grindSnapDistance || dist >= bestDist) continue;

    const along = velocity.x * seg.tx + velocity.z * seg.tz;
    if (Math.abs(along) < minAlong) continue;

    const sign = along >= 0 ? 1 : -1;
    const dirX = seg.tx * sign;
    const dirZ = seg.tz * sign;
    const type = classifyGrind(yaw, Math.atan2(dirX, dirZ), cfg);
    if (type === null) continue;

    bestDist = dist;
    best = { segment: seg, type, x: r.ax + seg.tx * s, z: r.az + seg.tz * s, dirX, dirZ, speed: Math.abs(along) };
  }

  return best;
}
