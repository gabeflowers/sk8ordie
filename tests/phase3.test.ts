import { describe, expect, it } from 'vitest';
import type { RailDef, RampDef } from '../src/config';
import { grindVariant } from '../src/sim/grind';
import type { SkaterSim } from '../src/sim/SkaterSim';
import type { GrindVariant } from '../src/sim/types';
import { World } from '../src/sim/World';
import { DT, input, makeConfig, makeLayoutSim, runUntil, setSpeed } from './helpers';

const cfg = makeConfig();
const notAirborne = (s: SkaterSim): boolean => s.state !== 'AIRBORNE';
const grinding = (s: SkaterSim): boolean => s.state === 'GRINDING';

function airborne(sim: SkaterSim, pos: [number, number, number], vel: [number, number, number]): void {
  sim.state = 'AIRBORNE';
  sim.position.set(...pos);
  sim.prevPosition.copy(sim.position);
  sim.velocity.set(...vel);
  sim.yaw = Math.atan2(vel[0], vel[2]);
  sim.prevYaw = sim.yaw;
  sim.coyoteTimer = 0;
}

describe('variações de grind', () => {
  it.each<['5050' | 'boardslide', number, number, GrindVariant]>([
    ['5050', 0, 0, '5050'],
    ['5050', -1, 0, 'fiveO'],
    ['5050', 1, 0, 'nosegrind'],
    ['5050', -1, -1, 'smith'],
    ['5050', -1, 1, 'feeble'],
    ['5050', 1, 1, 'crooked'],
    ['boardslide', 0, 0, 'boardslide'],
    ['boardslide', 1, 0, 'noseslide'],
    ['boardslide', -1, 0, 'tailslide'],
    ['boardslide', 0, 1, 'lipslide'],
  ])('%s + tilt %i + lado %i → %s', (type, tilt, side, expected) => {
    expect(grindVariant(type, tilt, side)).toBe(expected);
  });

  it('as teclas seguradas no encaixe escolhem a variação e o nome pontuado', () => {
    const RAIL: RailDef = { x: 0, z: 5, length: 6, axis: 'z', top: 0.5 };
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 0.55, 2.5], [0, 0, 5]);
    runUntil(sim, grinding, 1, { tilt: -1, side: 1 });
    expect(sim.grindVariant).toBe('feeble');
    runUntil(sim, (s) => s.state === 'GROUNDED', 3);
    expect(sim.score.line.map((a) => a.name)).toContain('Feeble');
  });
});

describe('corrimão de escada (inclinado)', () => {
  // desce de 1,2 m (z = 2) até 0,5 m (z = 5)
  const RAIL: RailDef = { x: 0, z: 3.5, length: 3, axis: 'z', top: 1.2, topEnd: 0.5 };

  it('acompanha a altura do trilho e acelera na descida', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 1.15, 2.2], [0, 0, 4]);
    runUntil(sim, grinding, 1);
    const v0 = sim.speed;
    sim.step(input(), DT);
    sim.step(input(), DT);
    expect(sim.speed).toBeGreaterThan(v0);
    // altura = interpolação linear do trilho
    const expectedY = 1.2 + ((0.5 - 1.2) * (sim.position.z - 2)) / 3;
    expect(sim.position.y).toBeCloseTo(expectedY, 6);
    expect(sim.groundSlope).toBeLessThan(0);
  });

  it('sai pela ponta de baixo já caindo e pousa limpo', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 1.15, 2.2], [0, 0, 4]);
    runUntil(sim, grinding, 1);
    runUntil(sim, (s) => s.state !== 'GRINDING', 3);
    expect(sim.velocity.y).toBeLessThan(0);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.bailCount).toBe(0);
  });
});

describe('rampas', () => {
  // kicker: sobe de 0 (z = 3) até 0,45 (z = 4,6)
  const KICKER: RampDef = { x: 0, z: 3.8, width: 2, length: 1.6, height: 0.45, dir: 'z+' };

  it('a superfície da rampa é chão inclinado', () => {
    const world = new World({ size: 120, boxes: [], ramps: [KICKER] });
    expect(world.groundHeightAt(0, 3, 10)).toBeCloseTo(0, 9);
    expect(world.groundHeightAt(0, 3.8, 10)).toBeCloseTo(0.225, 9);
    expect(world.groundHeightAt(0, 4.6, 10)).toBeCloseTo(0.45, 9);
    expect(world.groundHeightAt(0, 5, 10)).toBe(0);
  });

  it('subir o kicker lança o skater no lip e ele pousa limpo', () => {
    const sim = makeLayoutSim({ ramps: [KICKER] });
    setSpeed(sim, 7);
    runUntil(sim, (s) => s.state === 'AIRBORNE', 2);
    expect(sim.position.z).toBeGreaterThan(4.4);
    expect(sim.velocity.y).toBeGreaterThan(1);
    let top = 0;
    runUntil(sim, (s) => {
      top = Math.max(top, s.position.y);
      return notAirborne(s);
    }, 3);
    expect(top).toBeGreaterThan(KICKER.height + 0.05);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.bailCount).toBe(0);
  });

  it('a subida freia o skater', () => {
    const flat = makeLayoutSim({});
    const ramp = makeLayoutSim({ ramps: [{ x: 0, z: 6, width: 4, length: 10, height: 1.5, dir: 'z+' }] });
    for (const s of [flat, ramp]) setSpeed(s, 6);
    for (let i = 0; i < 60; i++) {
      flat.step(input(), DT);
      ramp.step(input(), DT);
    }
    expect(ramp.speed).toBeLessThan(flat.speed - 0.5);
  });

  it('ollie na rampa sobe mais que no plano', () => {
    const apex = (ramps: RampDef[]): number => {
      const sim = makeLayoutSim({ ramps }, { spawnZ: 0 });
      setSpeed(sim, 7);
      if (ramps.length) runUntil(sim, (s) => s.position.z > 3.6, 2);
      else runUntil(sim, (s) => s.position.z > 3.6, 2);
      const y0 = sim.position.y;
      sim.step(input({ jumpPressed: true }), DT);
      let top = 0;
      runUntil(sim, (s) => {
        top = Math.max(top, s.position.y);
        return notAirborne(s);
      }, 3);
      return top - y0;
    };
    expect(apex([KICKER])).toBeGreaterThan(apex([]) + 0.1);
  });

  it('a lateral alta da rampa é parede', () => {
    const BANK: RampDef = { x: 3, z: 0, width: 4, length: 4, height: 1, dir: 'z+' };
    const sim = makeLayoutSim({ ramps: [BANK] }, { spawnX: 0, spawnZ: 1.5, spawnYaw: Math.PI / 2 });
    setSpeed(sim, 3);
    for (let i = 0; i < 60; i++) sim.step(input(), DT);
    // a lateral em x = 1 tem ~0,9 m de altura nesse ponto: não atravessa
    expect(sim.position.x).toBeLessThanOrEqual(1 - cfg.skaterRadius + 1e-6);
  });
});
