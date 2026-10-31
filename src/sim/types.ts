import type { SolidDef } from '../config';
import type { FlipKey, GrabHand, PopIntent, TrickId } from './tricks/gesture';

/** Input já abstraído do teclado; a simulação nunca lê o DOM. */
export interface InputState {
  forward: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  /** borda: true só no passo do pop (soltar Espaço/Q depois de agachar) */
  jumpPressed: boolean;
  /** agachado, segurando o pop */
  crouch?: boolean;
  /** detalhes do pop junto com jumpPressed: nollie, carga e flip */
  pop?: PopIntent;
  /** batida de flip sem agachar (late flip, se ainda der tempo no ar) */
  lateTrick?: TrickId | null;
  /** batida de A/D/S/W sem agachar (no chão, S/W entram em manual) */
  tap?: FlipKey | null;
  /** W segurado = +1, S = −1: equilíbrio do manual e variação do grab */
  tilt?: number;
  /** D segurado = +1, A = −1 (variação do grind: smith/feeble, crooked, lipslide) */
  side?: number;
  /** J = mão da frente, L = mão de trás (segurando) */
  grab?: GrabHand | null;
}

export type SkaterState = 'GROUNDED' | 'AIRBORNE' | 'BAILED' | 'GRINDING';

/** Sólido do mundo. `walkable: false` = não serve de chão (topo fino demais, ex.: corrimão: só dá para trilhar). */
export interface WorldSolid extends SolidDef {
  walkable?: boolean;
  /** de qual corrimão é esta colisão (ignorada enquanto ele é trilhado) */
  railId?: number;
}

/** Caixa alinhada aos eixos, com base em y = 0. */
export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  walkable: boolean;
  railId?: number;
}

/** Origem do segmento de grind: corrimão ou aresta do topo de uma caixa. */
export type GrindKind = 'rail' | 'edge';

/** Manobra de grind, decidida pelo ângulo entre o shape e o segmento. */
export type GrindType = '5050' | 'boardslide';

/**
 * Variação do grind, escolhida no encaixe: família (alinhado = trucks, atravessado = slide)
 * + W/S (nose/tail) + A/D (lado).
 */
export type GrindVariant =
  | '5050' | 'fiveO' | 'nosegrind' | 'smith' | 'feeble' | 'crooked'
  | 'boardslide' | 'noseslide' | 'tailslide' | 'lipslide';

/** Segmento horizontal trilhável, de (ax, az) a (bx, bz) na altura y. */
export interface GrindRail {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
  /** altura na ponta b (corrimão de escada); sem isso, igual a `y` */
  by?: number;
  kind: GrindKind;
  /** índice do corrimão (para ignorar a própria colisão no grind) */
  railId?: number;
}
