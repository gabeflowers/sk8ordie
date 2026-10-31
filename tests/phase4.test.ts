import { describe, expect, it } from 'vitest';
import { CONFIG, type RampDef } from '../src/config';
import { rampParts } from '../src/render/kit';
import { Challenges } from '../src/sim/challenges';
import { worldDef } from '../src/sim/layout';
import { Score } from '../src/sim/score';
import type { SkaterSim } from '../src/sim/SkaterSim';
import { World } from '../src/sim/World';
import { makeConfig, makeLayoutSim, runUntil, setSpeed } from './helpers';

const cfg = makeConfig();
// quarter pipe subindo para +Z: pé em z = 3, lip (1,5 m) em z = 5,4
const QUARTER: RampDef = { x: 0, z: 4.2, width: 4, length: 2.4, height: 1.5, dir: 'z+', profile: 'quarter' };

function quarterWorld(): World {
  return new World(worldDef({ ...CONFIG.world, boxes: [], rails: [], poles: [], ramps: [QUARTER] }));
}

describe('quarter pipe', () => {
  it('o perfil é um arco: começa rente ao chão, fica abaixo da reta e termina no lip', () => {
    const world = quarterWorld();
    expect(world.groundHeightAt(0, 3, 10)).toBeCloseTo(0, 6);
    expect(world.groundHeightAt(0, 5.4, 10)).toBeCloseTo(1.5, 6);
    expect(world.groundHeightAt(0, 4.2, 10)).toBeLessThan(0.75 * 0.6);
  });

  it('a geometria curva acompanha a colisão (nunca passa da superfície)', () => {
    const world = quarterWorld();
    const pos = rampParts(QUARTER, CONFIG.world, CONFIG.visual).body.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const inside = Math.min(Math.abs(x) - 2, Math.abs(z - 4.2) - 1.2) < -1e-3;
      if (inside) expect(y).toBeLessThanOrEqual(world.groundHeightAt(x, z, 10) + 1e-3);
    }
  });

  it('subindo rápido sai no ar quase vertical, pontua o air e desce de fakie', () => {
    const sim = makeLayoutSim({ ramps: [QUARTER] });
    setSpeed(sim, 8);
    runUntil(sim, (s) => s.state === 'AIRBORNE', 2);
    expect(sim.velocity.y).toBeGreaterThan(Math.hypot(sim.velocity.x, sim.velocity.z));
    runUntil(sim, (s: SkaterSim) => s.state !== 'AIRBORNE', 3);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.bailCount).toBe(0);
    expect(sim.score.line.map((a) => a.name)).toContain(cfg.tricks.vertAir.name);
    // pousa na transição e desce de costas
    runUntil(sim, (s) => s.fakie, 2);
    expect(sim.state).toBe('GROUNDED');
  });

  it('devagar, para na transição e desce de fakie', () => {
    const sim = makeLayoutSim({ ramps: [QUARTER] });
    setSpeed(sim, 4);
    runUntil(sim, (s) => s.fakie, 3);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBeLessThan(QUARTER.height);
  });
});

describe('desafios', () => {
  const defs = CONFIG.challenges.list;

  it('manobra pousada conclui o desafio pelo nome (contém)', () => {
    const score = new Score(cfg.score);
    const ch = new Challenges(defs, score);
    score.add('Varial Kickflip', 500);
    expect(ch.update(score).map((d) => d.id)).toEqual(['kickflip']);
    expect(ch.update(score)).toEqual([]);
    expect(ch.pending.some((d) => d.id === 'kickflip')).toBe(false);
  });

  it('multiplicador e tamanho da linha contam na hora; linha só quando fecha', () => {
    const score = new Score(cfg.score);
    const ch = new Challenges(defs, score);
    const done: string[] = [];
    for (const name of ['Ollie', 'Pop Shove-it', 'Heelflip', '50-50', 'Nosegrab']) {
      score.add(name, 700);
      done.push(...ch.update(score).map((d) => d.id));
    }
    expect(done).toContain('x2');
    expect(done).toContain('combo5');
    expect(done).not.toContain('line3k');
    score.bank();
    expect(ch.update(score).map((d) => d.id)).toEqual(['line3k', 'line10k']);
  });

  it('várias manobras no mesmo passo contam todas', () => {
    const score = new Score(cfg.score);
    const ch = new Challenges(defs, score);
    score.add('Kickflip', 300);
    score.add('Feeble', 300);
    expect(ch.update(score).map((d) => d.id)).toEqual(['kickflip', 'feeble']);
  });

  it('linha perdida no bail não conta; concluídos salvos voltam concluídos', () => {
    const score = new Score(cfg.score);
    const ch = new Challenges(defs, score, ['kickflip']);
    score.add('Kickflip', 5000);
    score.bail();
    expect(ch.update(score)).toEqual([]);
    expect(ch.completed.size).toBe(1);
  });
});
