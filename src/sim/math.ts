import { Vector3 } from 'three';

const TWO_PI = Math.PI * 2;

/** Tolerância numérica para divisões por distâncias ~0. */
export const EPSILON = 1e-9;

/** Direção do shape no plano XZ. yaw = 0 aponta para +Z (igual a Object3D.rotation.y). */
export function forwardFromYaw(yaw: number, out: Vector3 = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** Yaw equivalente à direção horizontal de um vetor. */
export function headingOf(v: Vector3): number {
  return Math.atan2(v.x, v.z);
}

/** Normaliza um ângulo para [-π, π). */
export function wrapAngle(angle: number): number {
  const a = (angle + Math.PI) % TWO_PI;
  return (a < 0 ? a + TWO_PI : a) - Math.PI;
}

export function horizontalSpeed(v: Vector3): number {
  return Math.hypot(v.x, v.z);
}
