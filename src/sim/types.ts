import type { SolidDef } from '../config';

/** Input já abstraído do teclado; a simulação nunca lê o DOM. */
export interface InputState {
  forward: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  /** borda: true só no passo em que o SPACE foi apertado */
  jumpPressed: boolean;
}

export type SkaterState = 'GROUNDED' | 'AIRBORNE' | 'BAILED' | 'GRINDING';

/** Sólido do mundo. `walkable: false` = não serve de chão (topo fino demais, ex.: corrimão: só dá para trilhar). */
export interface WorldSolid extends SolidDef {
  walkable?: boolean;
}

/** Caixa alinhada aos eixos, com base em y = 0. */
export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  walkable: boolean;
}

/** Origem do segmento de grind: corrimão ou aresta do topo de uma caixa. */
export type GrindKind = 'rail' | 'edge';

/** Manobra de grind, decidida pelo ângulo entre o shape e o segmento. */
export type GrindType = '5050' | 'boardslide';

/** Segmento horizontal trilhável, de (ax, az) a (bx, bz) na altura y. */
export interface GrindRail {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
  kind: GrindKind;
}
