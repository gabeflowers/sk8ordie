import { describe, expect, it } from 'vitest';
import type { SkaterSim } from '../src/sim/SkaterSim';
import { resolveGrab, type PopIntent } from '../src/sim/tricks/gesture';
import type { InputState } from '../src/sim/types';
import { DT, input, makeConfig, makeSim, runUntil, setSpeed, steps } from './helpers';

const cfg = makeConfig();
const t = cfg.tricks;
const notAirborne = (s: SkaterSim): boolean => s.state !== 'AIRBORNE';

function pop(sim: SkaterSim, p: Partial<PopIntent> = {}, extra: Partial<InputState> = {}): void {
  sim.step(input({ jumpPressed: true, pop: { nollie: false, charge: 1, trick: null, ...p }, ...extra }), DT);
}

function hold(sim: SkaterSim, n: number, held: Partial<InputState>): void {
  for (let i = 0; i < n; i++) sim.step(input(held), DT);
}

describe('grabs', () => {
  it('mão + W/S escolhe o grab', () => {
    expect(resolveGrab('front', 0)).toBe('melon');
    expect(resolveGrab('front', 1)).toBe('nosegrab');
    expect(resolveGrab('front', -1)).toBe('mute');
    expect(resolveGrab('back', 0)).toBe('indy');
    expect(resolveGrab('back', -1)).toBe('tailgrab');
    expect(resolveGrab('back', 1)).toBe('stalefish');
  });

  it('segurar e soltar antes de pousar: pontua o grab', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    pop(sim);
    hold(sim, 3, {});
    hold(sim, 15, { grab: 'back' });
    expect(sim.grab?.id).toBe('indy');
    hold(sim, 1, {});
    expect(sim.grab).toBeNull();
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.score.line.map((a) => a.name)).toEqual(['Indy']);
    expect(sim.score.lastTrick?.points).toBeGreaterThan(t.grabs.indy.points);
  });

  it('pousar ainda segurando = bail', () => {
    const sim = makeSim();
    pop(sim);
    runUntil(sim, notAirborne, 2, { grab: 'front' });
    expect(sim.state).toBe('BAILED');
  });

  it('grab só depois de o flip terminar; flip + grab contam separado', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    pop(sim, { trick: 'kickflip' });
    hold(sim, 3, { grab: 'front' });
    expect(sim.grab).toBeNull(); // o shape ainda está girando
    const flipSteps = Math.ceil(t.catalog.kickflip.duration / DT);
    hold(sim, flipSteps - 3, {});
    hold(sim, 5, { grab: 'front' });
    expect(sim.grab?.id).toBe('melon');
    hold(sim, 1, {});
    runUntil(sim, notAirborne, 2);
    expect(sim.score.line.map((a) => a.name).sort()).toEqual(['Kickflip', 'Melon']);
    expect(sim.score.multiplier).toBe(2);
  });
});

describe('manual', () => {
  it('S no chão em velocidade entra em manual; sem corrigir, perde o equilíbrio e pontua', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    sim.step(input({ tap: 'S' }), DT);
    expect(sim.manual?.nose).toBe(false);
    expect(sim.manual?.balance).toBeLessThan(0);
    runUntil(sim, (s) => s.manual === null, 5);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.score.lastTrick?.name).toBe('Manual');
  });

  it('corrigir com W mantém o manual por mais tempo', () => {
    const free = makeSim();
    const fixed = makeSim();
    for (const s of [free, fixed]) {
      setSpeed(s, 7);
      s.step(input({ tap: 'S' }), DT);
    }
    let freeSteps = 0;
    while (free.manual && freeSteps < 600) {
      free.step(input(), DT);
      freeSteps++;
    }
    let fixedSteps = 0;
    while (fixed.manual && fixedSteps < 600) {
      // correção simples: empurra contra o lado para onde está caindo
      const b = fixed.manual.balance;
      fixed.step(input({ tilt: b < 0 ? 1 : -1 }), DT);
      fixedSteps++;
    }
    expect(fixedSteps).toBeGreaterThan(freeSteps * 2);
  });

  it('W = nose manual; não dá para remar em manual', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    sim.step(input({ tap: 'W' }), DT);
    expect(sim.manual?.nose).toBe(true);
    const v = sim.speed;
    sim.step(input({ forward: true }), DT);
    expect(sim.pushing).toBe(false);
    expect(sim.speed).toBeLessThan(v);
  });

  it('ollie para fora do manual: o manual conta e a linha continua', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    sim.step(input({ tap: 'S' }), DT);
    steps(sim, 10);
    pop(sim, { trick: 'kickflip' });
    expect(sim.manual).toBeNull();
    runUntil(sim, notAirborne, 2);
    expect(sim.score.line.map((a) => a.name)).toEqual(['Manual', 'Kickflip']);
  });

  it('pousar segurando S entra direto em manual', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    pop(sim);
    runUntil(sim, notAirborne, 2, { tilt: -1 });
    expect(sim.state).toBe('GROUNDED');
    expect(sim.manual?.nose).toBe(false);
  });

  it('a linha não fecha enquanto está em manual', () => {
    const sim = makeSim();
    setSpeed(sim, 7);
    pop(sim);
    runUntil(sim, notAirborne, 2, { tilt: -1 });
    const lines = sim.score.lineCount;
    for (let i = 0; i < Math.round(cfg.score.comboTimeout / DT) && sim.manual; i++) {
      const b = sim.manual.balance;
      sim.step(input({ tilt: b < 0 ? 1 : -1 }), DT);
    }
    expect(sim.score.lineCount).toBe(lines);
  });
});

describe('powerslide e revert', () => {
  it('↓ + lado em velocidade: powerslide freia mais forte que o freio, não vira e pontua', () => {
    const slide = makeSim();
    const brake = makeSim();
    for (const s of [slide, brake]) setSpeed(s, 7);
    hold(slide, 20, { brake: true, left: true });
    hold(brake, 20, { brake: true });
    expect(slide.powerslide).not.toBeNull();
    expect(slide.yaw).toBe(0);
    expect(slide.speed).toBeLessThan(brake.speed);
    hold(slide, 1, {});
    expect(slide.powerslide).toBeNull();
    expect(slide.score.lastTrick?.name).toBe('Powerslide');
  });

  it('devagar não dá powerslide (só freia e vira)', () => {
    const sim = makeSim();
    setSpeed(sim, 2);
    hold(sim, 5, { brake: true, left: true });
    expect(sim.powerslide).toBeNull();
    expect(sim.yaw).toBeGreaterThan(0);
  });

  it('revert: logo depois de pousar fakie, ↓ + lado volta a andar de frente', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    pop(sim);
    steps(sim, 31, { left: true });
    runUntil(sim, notAirborne, 2);
    expect(sim.fakie).toBe(true);
    sim.step(input({ brake: true, right: true }), DT);
    expect(sim.fakie).toBe(false);
    expect(sim.powerslide).toBeNull();
    expect(sim.score.lastTrick?.name).toBe('Revert');
    expect(sim.score.line.map((a) => a.name)).toEqual(['FS 180', 'Revert']);
  });
});
