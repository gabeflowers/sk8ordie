import { describe, expect, it } from 'vitest';
import { CONFIG, type BoxDef, type RampDef } from '../src/config';
import type { SkaterSim } from '../src/sim/SkaterSim';
import { World, rampFromDef, rampProfile } from '../src/sim/World';
import { DT, input, makeLayoutSim, runUntil, setSpeed } from './helpers';

const RAMPS = CONFIG.world.ramps;
const BOXES = CONFIG.world.boxes;

/** Rampas e caixas do mapa cuja pegada passa perto de (x, z). */
function near(x: number, z: number, r = 12): { ramps: RampDef[]; boxes: BoxDef[] } {
  const close = (o: { x: number; z: number }): boolean => Math.abs(o.x - x) < r && Math.abs(o.z - z) < r;
  return { ramps: RAMPS.filter(close), boxes: BOXES.filter(close) };
}

interface Ride {
  sim: SkaterSim;
  top: number;
  wentVert: boolean;
}

/** Larga o skater em (x, z) olhando para +Z a `speed` e roda `seconds` sem input. */
function ride(x: number, z: number, speed: number, seconds: number): Ride {
  const sim = makeLayoutSim(near(x, z + 6), { spawnX: x, spawnZ: z, spawnYaw: 0 });
  setSpeed(sim, speed);
  let top = 0;
  let wentVert = false;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    sim.step(input(), DT);
    top = Math.max(top, sim.position.y);
    wentVert ||= sim.vertAir;
  }
  return { sim, top, wentVert };
}

describe('perfis de rampa', () => {
  it('roll: S suave, plano no pé e no topo, metade da altura no meio', () => {
    const r = rampFromDef({ x: 0, z: 0, width: 2, length: 2, height: 1, dir: 'z+', profile: 'roll' });
    expect(rampProfile(r, 0)).toBe(0);
    expect(rampProfile(r, 0.5)).toBeCloseTo(0.5, 9);
    expect(rampProfile(r, 1)).toBeCloseTo(1, 9);
    expect(rampProfile(r, 0.02)).toBeLessThan(0.002);
    expect(1 - rampProfile(r, 0.98)).toBeLessThan(0.002);
  });

  it('quarter com maxAngle próprio termina mais íngreme', () => {
    const base = { x: 0, z: 0, width: 2, length: 2, height: 1, dir: 'z+' as const, profile: 'quarter' as const };
    const soft = rampFromDef(base);
    const steep = rampFromDef({ ...base, maxAngle: (80 * Math.PI) / 180 });
    const slope = (r: typeof soft): number => (rampProfile(r, 1) - rampProfile(r, 0.99)) / 0.01;
    expect(slope(steep)).toBeGreaterThan(slope(soft));
  });

  it('o spine não é transição de air vertical, mas o quarter é', () => {
    const world = new World({ size: 120, boxes: [], ramps: near(20, -40).ramps });
    expect(world.quarterAt(20, -41)?.vert).toBe(false);
  });
});

describe('orientação no ar', () => {
  it('air de quarter pipe guarda a inclinação da transição; ollie no plano sai reto', () => {
    const sim = makeLayoutSim(near(-35, -27), { spawnX: -35, spawnZ: -33, spawnYaw: 0 });
    setSpeed(sim, 8);
    runUntil(sim, (q) => q.vertAir, 2);
    expect(sim.velocity.y).toBeGreaterThan(5);
    expect(sim.launchPitch).toBeGreaterThan((50 * Math.PI) / 180);

    const flat = makeLayoutSim({});
    setSpeed(flat, 6);
    flat.step(input({ jumpPressed: true }), DT);
    expect(flat.state).toBe('AIRBORNE');
    expect(flat.launchPitch).toBe(0);
  });
});

describe('pistas novas do mapa', () => {
  it('half pipe: do fundo, sobe a transição, dá air vertical e volta de fakie', () => {
    const { sim, wentVert } = ride(35, -38, CONFIG.sim.maxPushSpeed, 3);
    expect(wentVert).toBe(true);
    expect(sim.bailCount).toBe(0);
  });

  it('spine: passa por cima e desce do outro lado de frente', () => {
    const { sim, top, wentVert } = ride(20, -47, CONFIG.sim.maxPushSpeed, 2.5);
    expect(top).toBeGreaterThan(1);
    expect(wentVert).toBe(false);
    expect(sim.position.z).toBeGreaterThan(-36);
    expect(sim.bailCount).toBe(0);
    expect(sim.fakie).toBe(false);
  });

  it('roller e hump de topo plano: passa por cima sem cair', () => {
    for (const z0 of [-24, -45]) {
      const { sim, top } = ride(48, z0, 6, 2.5);
      expect(top).toBeGreaterThan(0.45);
      expect(sim.position.z).toBeGreaterThan(z0 + 10);
      expect(sim.bailCount).toBe(0);
    }
  });

  it('funbox: sobe a cunha, cruza o topo e desce do outro lado', () => {
    const { sim, top } = ride(-44, 30, 6, 3.5);
    expect(top).toBeGreaterThan(0.45);
    expect(sim.position.z).toBeGreaterThan(44);
    expect(sim.bailCount).toBe(0);
  });
});
