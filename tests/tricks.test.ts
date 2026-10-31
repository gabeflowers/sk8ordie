import { describe, expect, it } from 'vitest';
import type { RailDef } from '../src/config';
import { Score } from '../src/sim/score';
import type { SkaterSim } from '../src/sim/SkaterSim';
import { resolveTrick, TrickGesture, type FlipKey, type PopIntent, type TrickId } from '../src/sim/tricks/gesture';
import { DT, input, makeConfig, makeLayoutSim, makeSim, run, runUntil, setSpeed, steps } from './helpers';

const cfg = makeConfig();
const t = cfg.tricks;
const notAirborne = (s: SkaterSim): boolean => s.state !== 'AIRBORNE';

function pop(sim: SkaterSim, p: Partial<PopIntent> = {}): void {
  sim.step(input({ jumpPressed: true, pop: { nollie: false, charge: 1, trick: null, ...p } }), DT);
}

describe('gesto do teclado → manobra', () => {
  const held = (...k: FlipKey[]): Set<FlipKey> => new Set(k);
  const none = new Map<FlipKey, number>();

  it.each<[FlipKey[], TrickId | null]>([
    [[], null],
    [['A'], 'kickflip'],
    [['D'], 'heelflip'],
    [['S'], 'popShove'],
    [['W'], 'fsShove'],
    [['A', 'S'], 'varialKickflip'],
    [['D', 'W'], 'varialHeelflip'],
    [['A', 'W'], 'hardflip'],
    [['D', 'S'], 'inwardHeelflip'],
  ])('teclas %j → %s', (keys, expected) => {
    expect(resolveTrick(held(...keys), none, t.doubleTap)).toBe(expected);
  });

  it('batidas duplas: double flips, 360 shove e 360 flip', () => {
    expect(resolveTrick(held(), new Map([['A', 2]]), t.doubleTap)).toBe('doubleKickflip');
    expect(resolveTrick(held(), new Map([['D', 2]]), t.doubleTap)).toBe('doubleHeelflip');
    expect(resolveTrick(held(), new Map([['S', 2]]), t.doubleTap)).toBe('shove360');
    expect(resolveTrick(held('A'), new Map([['S', 2]]), t.doubleTap)).toBe('treFlip');
  });

  it('segurar Espaço e soltar = ollie com carga proporcional ao tempo', () => {
    const g = new TrickGesture(t);
    g.keyDown('Space', 10);
    expect(g.crouching).toBe(true);
    g.keyUp('Space', 10 + t.chargeTime / 2);
    const p = g.consumePop();
    expect(p?.nollie).toBe(false);
    expect(p?.trick).toBeNull();
    expect(p?.charge).toBeCloseTo(0.5, 9);
    expect(g.consumePop()).toBeNull();
    expect(g.crouching).toBe(false);
  });

  it('Q = nollie; flip escolhido pelas teclas seguradas ao soltar', () => {
    const g = new TrickGesture(t);
    g.keyDown('KeyQ', 0);
    g.keyDown('KeyA', 0.1);
    g.keyUp('KeyQ', 1);
    expect(g.consumePop()).toEqual({ nollie: true, charge: 1, trick: 'kickflip' });
  });

  it('bater S duas vezes agachado e segurar A = 360 flip', () => {
    const g = new TrickGesture(t);
    g.keyDown('Space', 0);
    g.keyDown('KeyS', 0.05);
    g.keyUp('KeyS', 0.08);
    g.keyDown('KeyS', 0.12);
    g.keyUp('KeyS', 0.15);
    g.keyDown('KeyA', 0.2);
    g.keyUp('Space', 0.3);
    expect(g.consumePop()?.trick).toBe('treFlip');
  });

  it('flip sem agachar vira late flip', () => {
    const g = new TrickGesture(t);
    g.keyDown('KeyD', 0);
    expect(g.consumeLate()).toBe('heelflip');
    expect(g.consumeLate()).toBeNull();
  });
});

describe('pontuação', () => {
  it('multiplicador = manobras diferentes; repetir rende menos', () => {
    const s = new Score(cfg.score);
    s.add('Kickflip', 300);
    s.add('Heelflip', 300);
    expect(s.multiplier).toBe(2);
    expect(s.lineTotal).toBe(1200);
    const again = s.add('Kickflip', 300);
    expect(again.points).toBe(150);
    expect(s.multiplier).toBe(2);
  });

  it('rolando sem manobra a linha fecha e entra no total; bail perde a linha', () => {
    const s = new Score(cfg.score);
    s.add('Ollie', 50);
    s.tick(cfg.score.comboTimeout / 2, true);
    expect(s.total).toBe(0);
    s.tick(cfg.score.comboTimeout, true);
    expect(s.total).toBe(50);
    expect(s.lastLine).toEqual({ points: 50, banked: true });

    s.add('Kickflip', 300);
    s.bail();
    expect(s.total).toBe(50);
    expect(s.line).toHaveLength(0);
    expect(s.lastLine).toEqual({ points: 300, banked: false });
  });

  it('no ar ou no grind a linha não fecha', () => {
    const s = new Score(cfg.score);
    s.add('Ollie', 50);
    s.tick(10, false);
    expect(s.total).toBe(0);
  });
});

describe('manobras na simulação', () => {
  function apex(charge: number): number {
    const sim = makeSim();
    pop(sim, { charge });
    let top = 0;
    runUntil(sim, (s) => {
      top = Math.max(top, s.position.y);
      return notAirborne(s);
    }, 2);
    return top;
  }

  it('agachar mais = pop mais alto', () => {
    expect(apex(1)).toBeGreaterThan(apex(0) + 0.3);
  });

  it('kickflip: o shape gira no ar, pousa limpo e pontua com o nome certo', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    pop(sim, { trick: 'kickflip' });
    expect(sim.trick?.id).toBe('kickflip');
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.trick).toBeNull();
    expect(sim.score.lastTrick?.name).toBe('Kickflip');
    expect(sim.score.lastTrick?.points).toBeGreaterThan(t.catalog.kickflip.points);
  });

  it('nollie e fakie entram no nome', () => {
    const sim = makeSim();
    pop(sim, { nollie: true, trick: 'heelflip' });
    runUntil(sim, notAirborne, 2);
    expect(sim.score.lastTrick?.name).toBe('Nollie Heelflip');
  });

  it('giro de 180 no ar vira "FS 180" e pousa fakie', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    pop(sim);
    steps(sim, 31, { left: true });
    runUntil(sim, notAirborne, 2);
    expect(sim.fakie).toBe(true);
    expect(sim.score.lastTrick?.name).toBe('FS 180');
  });

  it('late flip começado tarde num pop baixo não completa: bail e a linha é perdida', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    pop(sim, { trick: 'kickflip' });
    runUntil(sim, notAirborne, 2); // linha: Kickflip
    pop(sim, { charge: 0 });
    steps(sim, Math.floor(t.lateWindow / DT) - 1);
    sim.step(input({ lateTrick: 'kickflip' }), DT);
    expect(sim.trick?.late).toBe(true);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('BAILED');
    expect(sim.score.line).toHaveLength(0);
    expect(sim.score.lastLine?.banked).toBe(false);
  });

  it('late flip a tempo pousa e ganha o prefixo "Late"', () => {
    const sim = makeSim();
    pop(sim);
    steps(sim, 2);
    sim.step(input({ lateTrick: 'popShove' }), DT);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.score.lastTrick?.name).toBe('Late Pop Shove-it');
  });

  it('flip para dentro do grind: conta o flip e depois o grind', () => {
    const RAIL: RailDef = { x: 0, z: 5, length: 6, axis: 'z', top: 0.5 };
    const sim = makeLayoutSim({ rails: [RAIL] }, { spawnX: -0.6, spawnZ: 0, spawnYaw: (10 * Math.PI) / 180 });
    setSpeed(sim, 7);
    pop(sim, { trick: 'kickflip' });
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GRINDING');
    expect(sim.score.lastTrick?.name).toBe('Kickflip');
    runUntil(sim, (s) => s.state === 'GROUNDED', 4);
    expect(sim.score.line.map((a) => a.name)).toEqual(['Kickflip', '50-50']);
    expect(sim.score.multiplier).toBe(2);
  });

  it('a linha fecha depois de rolar sem manobra', () => {
    const sim = makeSim();
    setSpeed(sim, 4);
    pop(sim, { trick: 'kickflip' });
    runUntil(sim, notAirborne, 2);
    run(sim, cfg.score.comboTimeout + 0.1, { forward: true });
    expect(sim.score.total).toBeGreaterThan(0);
    expect(sim.score.line).toHaveLength(0);
  });
});
