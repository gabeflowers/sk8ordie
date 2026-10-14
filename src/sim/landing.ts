import type { Vector3 } from 'three';
import type { SimConfig } from '../config';
import { headingOf, horizontalSpeed, wrapAngle } from './math';

export type LandingConfig = Pick<SimConfig, 'landingTolerance' | 'landingMinSpeed'>;

/**
 * Resultado da aterrissagem. `speed` é a nova velocidade escalar ao longo do shape;
 * `fakie` = pousou de costas (o tail vai na frente).
 */
export type LandingOutcome = { type: 'clean'; speed: number; fakie: boolean } | { type: 'bail' };

/**
 * Decide se o skater aterrissa limpo ou bate, dado o yaw do shape e a velocidade.
 * Vale tanto de frente (nose na frente) quanto de costas (fakie, ex.: depois de um 180);
 * só cai quem pousa atravessado, fora de `landingTolerance` dos dois sentidos.
 */
export function resolveLanding(yaw: number, velocity: Vector3, cfg: LandingConfig): LandingOutcome {
  const speed = horizontalSpeed(velocity);
  // ângulo entre o nose e a direção do movimento, em [0, π]
  const angle = speed > 0 ? Math.abs(wrapAngle(headingOf(velocity) - yaw)) : 0;
  const fakie = angle > Math.PI / 2;
  // desvio do eixo do shape, em [0, π/2], qualquer que seja o sentido
  const offAxis = fakie ? Math.PI - angle : angle;

  if (speed < cfg.landingMinSpeed || offAxis <= cfg.landingTolerance) {
    return { type: 'clean', speed: speed * Math.cos(offAxis), fakie };
  }

  return { type: 'bail' };
}
