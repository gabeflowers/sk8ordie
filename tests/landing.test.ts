import { MathUtils, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { resolveLanding } from '../src/sim/landing';
import { makeConfig } from './helpers';

const cfg = makeConfig();

/** Velocidade horizontal com a direção `headingDeg` (0° = +Z). */
function vel(speed: number, headingDeg: number): Vector3 {
  const h = MathUtils.degToRad(headingDeg);
  return new Vector3(Math.sin(h) * speed, 0, Math.cos(h) * speed);
}

describe('resolveLanding', () => {
  it('alinhado: limpa, de frente, velocidade intacta', () => {
    const r = resolveLanding(0, vel(8, 0), cfg);
    expect(r).toEqual({ type: 'clean', speed: 8, fakie: false });
  });

  it('dentro da tolerância: limpa, speed *= cos(ângulo)', () => {
    const r = resolveLanding(0, vel(10, 30), cfg);
    expect(r.type).toBe('clean');
    if (r.type === 'clean') expect(r.speed).toBeCloseTo(10 * Math.cos(MathUtils.degToRad(30)), 9);
  });

  it('é simétrico para os dois lados', () => {
    expect(resolveLanding(0, vel(10, -30), cfg).type).toBe('clean');
    expect(resolveLanding(0, vel(10, -40), cfg).type).toBe('bail');
  });

  it('limite em landingTolerance (35°)', () => {
    expect(resolveLanding(0, vel(10, 34.9), cfg).type).toBe('clean');
    expect(resolveLanding(0, vel(10, 35.1), cfg).type).toBe('bail');
  });

  it('atravessado (90°) dá bail', () => {
    expect(resolveLanding(0, vel(10, 90), cfg).type).toBe('bail');
    expect(resolveLanding(0, vel(10, -90), cfg).type).toBe('bail');
  });

  it('de costas (180°, depois de um 180) pousa limpo de fakie', () => {
    expect(resolveLanding(0, vel(10, 180), cfg)).toEqual({ type: 'clean', speed: 10, fakie: true });
  });

  it('fakie tem a mesma tolerância e o mesmo fator cos', () => {
    const r = resolveLanding(0, vel(10, 150), cfg);
    expect(r.type).toBe('clean');
    if (r.type === 'clean') {
      expect(r.fakie).toBe(true);
      expect(r.speed).toBeCloseTo(10 * Math.cos(MathUtils.degToRad(30)), 9);
    }
    expect(resolveLanding(0, vel(10, 180 - 34.9), cfg).type).toBe('clean');
    expect(resolveLanding(0, vel(10, 180 - 35.1), cfg).type).toBe('bail');
    expect(resolveLanding(0, vel(10, -(180 - 34.9)), cfg).type).toBe('clean');
  });

  it('lento (< landingMinSpeed): limpa em qualquer ângulo', () => {
    const across = resolveLanding(0, vel(0.3, 90), cfg);
    const backwards = resolveLanding(0, vel(0.3, 180), cfg);
    expect(across.type).toBe('clean');
    if (across.type === 'clean') expect(across.speed).toBeCloseTo(0, 9);
    expect(backwards).toEqual({ type: 'clean', speed: 0.3, fakie: true });
  });

  it('funciona com yaw acumulado (várias voltas)', () => {
    const yaw = 3 * Math.PI * 2 + MathUtils.degToRad(10);
    expect(resolveLanding(yaw, vel(10, 0), cfg)).toMatchObject({ type: 'clean', fakie: false });
    expect(resolveLanding(yaw + Math.PI, vel(10, 0), cfg)).toMatchObject({ type: 'clean', fakie: true });
    expect(resolveLanding(yaw + Math.PI / 2, vel(10, 0), cfg).type).toBe('bail');
  });
});
