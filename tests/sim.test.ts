import { describe, expect, it } from 'vitest';
import { forwardFromYaw } from '../src/sim/math';
import type { SkaterSim } from '../src/sim/SkaterSim';
import { box, DT, input, jump, makeConfig, makeSim, run, runUntil, setSpeed, steps } from './helpers';

const cfg = makeConfig();
const notAirborne = (s: SkaterSim): boolean => s.state !== 'AIRBORNE';

describe('GROUNDED: remar, frear, virar', () => {
  it('↑ acelera e estabiliza exatamente em maxPushSpeed', () => {
    const sim = makeSim();
    run(sim, 1, { forward: true });
    expect(sim.speed).toBeGreaterThan(4);
    expect(sim.speed).toBeLessThan(cfg.maxPushSpeed);
    run(sim, 5, { forward: true });
    expect(sim.speed).toBeCloseTo(cfg.maxPushSpeed, 9);
  });

  it('nunca passa de maxSpeed', () => {
    const sim = makeSim();
    setSpeed(sim, 20);
    sim.step(input({ forward: true }), DT);
    expect(sim.speed).toBeCloseTo(cfg.maxSpeed, 9);
  });

  it('acima de maxPushSpeed, remar não acelera (só friction)', () => {
    const sim = makeSim();
    setSpeed(sim, 10);
    run(sim, 1, { forward: true });
    expect(sim.speed).toBeCloseTo(10 - cfg.rollingFriction, 6);
  });

  it('↓ freia até parar e não anda de ré', () => {
    const sim = makeSim();
    setSpeed(sim, 7);
    run(sim, 1, { brake: true });
    expect(sim.speed).toBe(0);
    const z = sim.position.z;
    run(sim, 1, { brake: true });
    expect(sim.position.z).toBe(z);
  });

  it('rollingFriction para o skater sozinho', () => {
    const sim = makeSim();
    setSpeed(sim, 2);
    run(sim, 4);
    expect(sim.speed).toBe(0);
  });

  it('ao virar, a velocidade acompanha o shape sem derrapar nem perder magnitude', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    run(sim, 1, { left: true });
    expect(sim.yaw).toBeGreaterThan(1);
    const f = forwardFromYaw(sim.yaw);
    expect(Math.abs(sim.velocity.x * f.z - sim.velocity.z * f.x)).toBeLessThan(1e-9);
    expect(sim.velocity.x * f.x + sim.velocity.z * f.z).toBeGreaterThan(0);
    expect(sim.speed).toBeCloseTo(5 - cfg.rollingFriction, 6);
  });

  it('taxa de giro vai de turnRateSlow (parado) a turnRateFast (maxSpeed)', () => {
    const still = makeSim();
    still.step(input({ left: true }), DT);
    expect(still.yaw).toBeCloseTo(cfg.turnRateSlow * DT, 12);

    const fast = makeSim();
    setSpeed(fast, cfg.maxSpeed);
    fast.step(input({ right: true }), DT);
    expect(fast.yaw).toBeCloseTo(-cfg.turnRateFast * DT, 12);
  });
});

describe('ollie', () => {
  it('sobe com ollieVelocity, mantém a horizontal e aterrissa limpo', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    jump(sim);
    expect(sim.state).toBe('AIRBORNE');
    expect(sim.ollieCount).toBe(1);
    expect(sim.velocity.y).toBeCloseTo(cfg.ollieVelocity - cfg.gravity * DT, 9);

    const horizontal = sim.speed;
    let apex = 0;
    runUntil(
      sim,
      (s) => {
        apex = Math.max(apex, s.position.y);
        if (s.state === 'AIRBORNE') expect(s.speed).toBe(horizontal);
        return notAirborne(s);
      },
      2,
    );

    const theoreticalApex = cfg.ollieVelocity ** 2 / (2 * cfg.gravity);
    expect(apex).toBeGreaterThan(theoreticalApex - 0.1);
    expect(apex).toBeLessThanOrEqual(theoreticalApex);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.landCount).toBe(1);
  });

  it('SPACE no ar (sem coyote) não dá outro ollie', () => {
    const sim = makeSim();
    setSpeed(sim, 5);
    jump(sim);
    run(sim, 0.15);
    jump(sim);
    expect(sim.ollieCount).toBe(1);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.ollieCount).toBe(1);
  });

  it('ollie parado sobe e desce reto', () => {
    const sim = makeSim();
    jump(sim);
    runUntil(sim, notAirborne, 2);
    expect(sim.position.x).toBe(0);
    expect(sim.position.z).toBe(0);
    expect(sim.state).toBe('GROUNDED');
  });
});

describe('AIRBORNE: spin', () => {
  it('girar no ar não altera a trajetória', () => {
    const still = makeSim();
    const spin = makeSim();
    for (const s of [still, spin]) {
      setSpeed(s, 6);
      jump(s);
    }

    while (still.state === 'AIRBORNE') {
      still.step(input(), DT);
      spin.step(input({ left: true }), DT);
      expect(spin.position.x).toBe(still.position.x);
      expect(spin.position.y).toBe(still.position.y);
      expect(spin.position.z).toBe(still.position.z);
    }

    expect(spin.yaw).toBeGreaterThan(still.yaw + 1);
  });
});

describe('BAILED', () => {
  it('pousar atravessado → BAILED, input ignorado, volta de pé parado no mesmo lugar', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    jump(sim);
    steps(sim, 16, { left: true }); // ~92°
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('BAILED');
    expect(sim.bailCount).toBe(1);

    const yaw = sim.yaw;
    steps(sim, 30, { forward: true, left: true, jumpPressed: true });
    expect(sim.state).toBe('BAILED');
    expect(sim.yaw).toBe(yaw);
    expect(sim.ollieCount).toBe(1);

    const n = runUntil(sim, (s) => s.state === 'GROUNDED', 3);
    expect(Math.abs((30 + n) * DT - cfg.bailResetTime)).toBeLessThanOrEqual(2 * DT);
    expect(sim.speed).toBe(0);
    expect(sim.position.distanceTo(sim.prevPosition)).toBeLessThan(1e-9);
    expect(sim.position.z).toBeGreaterThan(1); // não teleporta para o spawn

    run(sim, 0.5);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.ollieCount).toBe(1); // SPACE apertado durante o bail não ficou no buffer
  });
});

describe('fakie: pousar de costas', () => {
  /** Ollie a 6 m/s girando `spinSteps` passos no ar (airSpinRate 6 → 0,1 rad por passo). */
  function spinAndLand(sim: SkaterSim, spinSteps: number): SkaterSim {
    jump(sim);
    steps(sim, spinSteps, { left: true });
    runUntil(sim, notAirborne, 2);
    return sim;
  }

  function rolling(speed = 6): SkaterSim {
    const sim = makeSim();
    setSpeed(sim, speed);
    return sim;
  }

  /** Componente da velocidade ao longo do nose: < 0 = tail na frente. */
  function alongNose(sim: SkaterSim): number {
    const f = forwardFromYaw(sim.yaw);
    return sim.velocity.x * f.x + sim.velocity.z * f.z;
  }

  it('180 no ar: pousa limpo de costas e segue no mesmo sentido', () => {
    const sim = spinAndLand(rolling(), 31); // 3,1 rad ≈ 178°
    expect(sim.state).toBe('GROUNDED');
    expect(sim.fakie).toBe(true);
    expect(sim.bailCount).toBe(0);
    expect(sim.landCount).toBe(1);
    expect(sim.velocity.z).toBeGreaterThan(5);
    expect(alongNose(sim)).toBeLessThan(0);
  });

  it('de fakie: remar acelera no sentido em que anda; virar não derrapa', () => {
    const sim = spinAndLand(rolling(), 31);
    const z0 = sim.position.z;
    run(sim, 1, { forward: true, left: true });
    expect(sim.state).toBe('GROUNDED');
    expect(sim.fakie).toBe(true);
    expect(sim.speed).toBeCloseTo(cfg.maxPushSpeed, 6);
    expect(sim.position.z).toBeGreaterThan(z0);
    const f = forwardFromYaw(sim.yaw);
    expect(Math.abs(sim.velocity.x * f.z - sim.velocity.z * f.x)).toBeLessThan(1e-9);
    expect(alongNose(sim)).toBeLessThan(0);
    // ← vira para a esquerda de quem anda (a direção do movimento gira para +X)
    expect(Math.atan2(sim.velocity.x, sim.velocity.z)).toBeGreaterThan(1);
  });

  it('pular de fakie sem girar continua fakie', () => {
    const sim = spinAndLand(rolling(), 31);
    spinAndLand(sim, 0);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.fakie).toBe(true);
    expect(sim.bailCount).toBe(0);
  });

  it('outro 180 a partir do fakie volta a andar de frente', () => {
    const sim = spinAndLand(rolling(), 31);
    spinAndLand(sim, 31);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.fakie).toBe(false);
    expect(sim.bailCount).toBe(0);
    expect(alongNose(sim)).toBeGreaterThan(0);
  });

  it('só cai quem pousa atravessado', () => {
    expect(spinAndLand(rolling(), 16).state).toBe('BAILED'); // ~92°
    expect(spinAndLand(rolling(), 31).state).toBe('GROUNDED'); // ~178°
  });

  it('reset volta a andar de frente', () => {
    const sim = spinAndLand(rolling(), 31);
    sim.reset();
    expect(sim.fakie).toBe(false);
  });
});

describe('coyote time', () => {
  // caixa z ∈ [0, 4], topo 0.6; spawn em cima dela
  function rollOffLedge(): SkaterSim {
    const sim = makeSim([box(0, 2, 2, 4, 0.6)], { spawnZ: 3 });
    expect(sim.position.y).toBe(0.6);
    setSpeed(sim, 3);
    runUntil(sim, (s) => s.state === 'AIRBORNE', 1);
    return sim;
  }

  it('SPACE logo depois de sair da borda ainda dá ollie', () => {
    const sim = rollOffLedge();
    steps(sim, 3);
    jump(sim);
    expect(sim.ollieCount).toBe(1);
    expect(sim.velocity.y).toBeGreaterThan(0);
  });

  it('SPACE depois de coyoteTime não dá ollie no ar', () => {
    const sim = rollOffLedge();
    run(sim, 0.15);
    jump(sim);
    expect(sim.state).toBe('AIRBORNE');
    expect(sim.ollieCount).toBe(0);
    expect(sim.velocity.y).toBeLessThan(0);
  });

  it('sair da borda sem apertar nada aterrissa limpo', () => {
    const sim = rollOffLedge();
    runUntil(sim, notAirborne, 1);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.bailCount).toBe(0);
  });
});

describe('jump buffer', () => {
  /** Passos entre o ollie e a aterrissagem (o pouso acontece no passo N). */
  function airSteps(): number {
    const sim = makeSim();
    setSpeed(sim, 4);
    jump(sim);
    return runUntil(sim, notAirborne, 2);
  }
  const N = airSteps();

  function ollieThenPressBefore(stepsBeforeLanding: number, held: { spinSteps?: number } = {}): SkaterSim {
    const sim = makeSim();
    setSpeed(sim, 4);
    jump(sim);
    const spin = held.spinSteps ?? 0;
    steps(sim, spin, { left: true });
    steps(sim, N - stepsBeforeLanding - 1 - spin);
    jump(sim);
    steps(sim, stepsBeforeLanding);
    return sim;
  }

  it('SPACE pouco antes de pousar dispara o ollie ao tocar o chão', () => {
    const sim = ollieThenPressBefore(3);
    expect(sim.landCount).toBe(1);
    expect(sim.ollieCount).toBe(2);
    expect(sim.state).toBe('AIRBORNE');
  });

  it('SPACE cedo demais (> jumpBuffer) não dispara', () => {
    const sim = ollieThenPressBefore(12);
    expect(sim.landCount).toBe(1);
    expect(sim.ollieCount).toBe(1);
    expect(sim.state).toBe('GROUNDED');
  });

  it('com aterrissagem ruim, o buffer não salva: bail sem ollie', () => {
    const sim = ollieThenPressBefore(3, { spinSteps: 16 });
    expect(sim.state).toBe('BAILED');
    expect(sim.ollieCount).toBe(1);
  });
});

describe('mundo: caixas e chão', () => {
  it('degrau ≤ stepTolerance: sobe e desce sem sair do chão (snap)', () => {
    const sim = makeSim([box(0, 3, 2, 2, 0.04)]);
    setSpeed(sim, 3);
    let maxY = 0;
    for (let i = 0; i < 120; i++) {
      sim.step(input(), DT);
      expect(sim.state).toBe('GROUNDED');
      maxY = Math.max(maxY, sim.position.y);
    }
    expect(maxY).toBe(0.04);
    expect(sim.position.y).toBe(0);
  });

  it('ollie para cima de uma caixa e aterrissa no topo', () => {
    const sim = makeSim([box(0, 7, 4, 6, 0.45)], { spawnZ: 1.5 });
    setSpeed(sim, 7);
    jump(sim);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0.45);
    expect(sim.position.z).toBeGreaterThan(4);
    expect(sim.bailCount).toBe(0);
  });

  it('bater devagar na lateral: para sem penetrar e continua GROUNDED', () => {
    const sim = makeSim([box(0, 4, 4, 2, 0.5)]); // face em z = 3
    setSpeed(sim, 2);
    run(sim, 3);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.speed).toBe(0);
    expect(sim.position.z).toBeCloseTo(3 - cfg.skaterRadius, 9);
  });

  it('bater rápido de frente: BAILED', () => {
    const sim = makeSim([box(0, 4, 4, 2, 0.5)]);
    setSpeed(sim, 10);
    run(sim, 1);
    expect(sim.bailCount).toBe(1);
    expect(sim.position.z).toBeLessThanOrEqual(3 - cfg.skaterRadius + 1e-9);
  });

  it('limites do mapa: clamp e zera a velocidade naquele eixo', () => {
    const sim = makeSim([], { spawnX: 59, spawnYaw: Math.PI / 2 });
    setSpeed(sim, 5);
    run(sim, 1);
    expect(sim.position.x).toBeCloseTo(60 - cfg.skaterRadius, 9);
    expect(sim.speed).toBe(0);
  });

  it('reset volta ao spawn, parado e de pé', () => {
    const sim = makeSim();
    setSpeed(sim, 6);
    jump(sim);
    run(sim, 0.2, { left: true });
    sim.reset();
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.toArray()).toEqual([0, 0, 0]);
    expect(sim.prevPosition.toArray()).toEqual([0, 0, 0]);
    expect(sim.speed).toBe(0);
    expect(sim.yaw).toBe(cfg.spawnYaw);
  });
});
