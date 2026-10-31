import { MathUtils, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG, type BoxDef, type RailDef } from '../src/config';
import { boardRailAngle, classifyGrind, findGrindSnap, lockedGrindYaw } from '../src/sim/grind';
import { boxGrindEdges, grindRails, railGrindSegment, worldDef } from '../src/sim/layout';
import { headingOf, wrapAngle } from '../src/sim/math';
import type { SkaterSim } from '../src/sim/SkaterSim';
import { World } from '../src/sim/World';
import { DT, input, jump, makeConfig, makeLayoutSim, run, runUntil, setSpeed, steps, type TestLayout } from './helpers';

const cfg = makeConfig();
const deg = MathUtils.degToRad;

// corrimão ao longo de Z: segmento de (0, 2) a (0, 8) com topo 0.5
const RAIL: RailDef = { x: 0, z: 5, length: 6, axis: 'z', top: 0.5 };
// ledge 2 × 6: arestas longas em x = ±1, z ∈ [5, 11], topo 0.4
const LEDGE: BoxDef = { x: 0, z: 8, sizeX: 2, sizeZ: 6, height: 0.4, kind: 'ledge' };

const notAirborne = (s: SkaterSim): boolean => s.state !== 'AIRBORNE';
const notGrinding = (s: SkaterSim): boolean => s.state !== 'GRINDING';
const grinding = (s: SkaterSim): boolean => s.state === 'GRINDING';

/** Põe o skater no ar em `pos` com `vel`; o yaw segue a velocidade, salvo `yaw`. */
function airborne(sim: SkaterSim, pos: [number, number, number], vel: [number, number, number], yaw?: number): void {
  sim.state = 'AIRBORNE';
  sim.position.set(...pos);
  sim.prevPosition.copy(sim.position);
  sim.velocity.set(...vel);
  sim.yaw = yaw ?? Math.atan2(vel[0], vel[2]);
  sim.prevYaw = sim.yaw;
  sim.coyoteTimer = 0;
}

/** Andando no chão a `speed` m/s com yaw `yawDeg` a partir de (x, z), dá ollie no 1º passo. */
function ollieFrom(x: number, z: number, yawDeg: number, speed: number, layout: TestLayout = { rails: [RAIL] }): SkaterSim {
  const sim = makeLayoutSim(layout, { spawnX: x, spawnZ: z, spawnYaw: deg(yawDeg) });
  setSpeed(sim, speed);
  jump(sim);
  return sim;
}

/** Ollie em diagonal (10°) que cruza o eixo do corrimão na descida; para no fim do voo. */
function diagonalSnap(speed = 7, layout?: TestLayout): SkaterSim {
  const sim = ollieFrom(-0.6, 0, 10, speed, layout);
  runUntil(sim, notAirborne, 2);
  return sim;
}

/** Roda passos sem input enquanto `cond` vale, chamando `each` depois de cada um. */
function stepWhile(sim: SkaterSim, cond: (s: SkaterSim) => boolean, each: () => void, maxSeconds = 5): void {
  for (let i = 0; cond(sim); i++) {
    if (i > maxSeconds / DT) throw new Error('não terminou');
    sim.step(input(), DT);
    each();
  }
}

describe('layout: segmentos de grind', () => {
  it('corrimão vira o eixo do tubo na altura do topo', () => {
    expect(railGrindSegment(RAIL)).toEqual({ ax: 0, az: 2, bx: 0, bz: 8, y: 0.5, kind: 'rail' });
    expect(railGrindSegment({ x: 14, z: 26, length: 6, axis: 'x', top: 0.45 })).toEqual({
      ax: 11,
      az: 26,
      bx: 17,
      bz: 26,
      y: 0.45,
      kind: 'rail',
    });
  });

  it('cada caixa vira as 4 arestas do topo, em contorno fechado', () => {
    const edges = boxGrindEdges(LEDGE);
    expect(edges).toHaveLength(4);
    edges.forEach((e, i) => {
      const next = edges[(i + 1) % 4]!;
      expect(e.kind).toBe('edge');
      expect(e.y).toBe(LEDGE.height);
      expect([e.bx, e.bz]).toEqual([next.ax, next.az]);
      expect(Math.max(Math.abs(e.ax), Math.abs(e.bx))).toBe(1);
    });
    const lengths = edges.map((e) => Math.hypot(e.bx - e.ax, e.bz - e.az)).sort();
    expect(lengths).toEqual([2, 2, 6, 6]);
  });

  it('o mapa: corrimões + 4 arestas por caixa + coping dos quarter pipes; postes não', () => {
    const w = CONFIG.world;
    const copings = w.ramps.filter((r) => r.profile === 'quarter').length;
    const expected = w.rails.length + 4 * w.boxes.length + copings;
    expect(grindRails(w)).toHaveLength(expected);
    expect(new World(worldDef(w)).grindSegments).toHaveLength(expected);
  });

  it('a AABB do corrimão colide mas não é chão', () => {
    const world = new World(worldDef({ ...CONFIG.world, boxes: [], rails: [RAIL], poles: [] }));
    expect(world.groundHeightAt(0, 5, 10)).toBe(0);
    const pos = new Vector3(-0.2, 0, 5);
    expect(world.resolveCircleCollisions(pos, 0.3, 0.05, new Vector3())).toBe(true);
  });

  it('World sem grindRails não tem segmentos (mundos antigos)', () => {
    expect(new World({ size: 120, boxes: [] }).grindSegments).toEqual([]);
  });
});

describe('classificação do grind', () => {
  const heading = 1.234; // qualquer direção de trilho

  it.each([
    [0, '5050'],
    [29.9, '5050'],
    [30.1, null],
    [64.9, null],
    [65.1, 'boardslide'],
    [90, 'boardslide'],
    [114.9, 'boardslide'],
    [115.1, null],
    [150.1, '5050'],
    [180, '5050'],
    [-90, 'boardslide'],
  ])('shape a %s° do trilho → %s', (angle, expected) => {
    expect(classifyGrind(heading + deg(angle), heading, cfg)).toBe(expected);
    // yaw acumulado (várias voltas) dá o mesmo resultado
    expect(classifyGrind(heading + deg(angle) + 6 * Math.PI, heading, cfg)).toBe(expected);
  });

  it('ângulo shape × trilho é módulo 180°, em [0°, 90°]', () => {
    expect(boardRailAngle(deg(170), 0)).toBeCloseTo(deg(10), 12);
    expect(boardRailAngle(deg(-100), 0)).toBeCloseTo(deg(80), 12);
  });

  it('yaw travado: o sentido válido mais próximo, sem dar voltas', () => {
    expect(lockedGrindYaw(deg(10), 0, '5050')).toBeCloseTo(0, 12);
    expect(lockedGrindYaw(deg(170), 0, '5050')).toBeCloseTo(Math.PI, 12);
    expect(lockedGrindYaw(deg(100), 0, 'boardslide')).toBeCloseTo(Math.PI / 2, 12);
    expect(lockedGrindYaw(deg(-80), 0, 'boardslide')).toBeCloseTo(-Math.PI / 2, 12);
    expect(lockedGrindYaw(4 * Math.PI + deg(10), 0, '5050')).toBeCloseTo(4 * Math.PI, 12);
  });

  it('com dois segmentos no alcance, engata no mais próximo', () => {
    const world = new World({
      size: 120,
      boxes: [],
      grindRails: [
        { ax: 0, az: 0, bx: 0, bz: 10, y: 0.5, kind: 'rail' },
        { ax: 0.4, az: 0, bx: 0.4, bz: 10, y: 0.5, kind: 'rail' },
      ],
    });
    const snap = findGrindSnap(world.grindSegments, new Vector3(0.25, 0.5, 5), 0.55, new Vector3(0, -1, 5), 0, cfg);
    expect(snap?.x).toBeCloseTo(0.4, 12);
    expect(snap?.type).toBe('5050');
  });
});

describe('GRINDING: 50-50 no corrimão', () => {
  it('ollie em diagonal engata no corrimão', () => {
    const sim = diagonalSnap();
    expect(sim.state).toBe('GRINDING');
    expect(sim.grindType).toBe('5050');
    expect(sim.grindCount).toBe(1);
    expect(sim.grindRail?.kind).toBe('rail');
    expect(sim.landCount).toBe(0);
    expect(sim.position.x).toBeCloseTo(0, 9);
    expect(sim.position.y).toBe(RAIL.top);
    expect(sim.position.z).toBeGreaterThan(2);
    expect(sim.position.z).toBeLessThan(8);
    expect(sim.grindDir.x).toBeCloseTo(0, 12);
    expect(sim.grindDir.z).toBeCloseTo(1, 12);
    expect(sim.yaw).toBeCloseTo(0, 9); // travado no eixo do trilho
    // a componente lateral se perde: speed = projeção na tangente
    expect(sim.speed).toBeCloseTo((7 - cfg.rollingFriction * DT) * Math.cos(deg(10)), 9);
  });

  it('percorre o trilho travado, com atrito, sai na ponta para AIRBORNE e pousa limpo', () => {
    const sim = diagonalSnap();
    let speed = sim.speed;
    stepWhile(sim, grinding, () => {
      if (sim.state !== 'GRINDING') return;
      // a AABB do próprio corrimão não empurra: o skater fica no eixo
      expect(sim.position.x).toBe(0);
      expect(sim.position.y).toBe(RAIL.top);
      expect(sim.yaw).toBeCloseTo(0, 9);
      expect(sim.speed).toBeCloseTo(speed - cfg.grindFriction * DT, 9);
      expect(sim.position.z - sim.prevPosition.z).toBeCloseTo(sim.speed * DT, 9);
      speed = sim.speed;
    });

    expect(sim.state).toBe('AIRBORNE');
    expect(sim.position.z).toBeGreaterThan(8);
    expect(sim.velocity.y).toBe(0);
    expect(sim.coyoteTimer).toBeGreaterThan(0);
    expect(sim.grindType).toBeNull();
    expect(sim.grindRail).toBeNull();
    expect(sim.grindDir.lengthSq()).toBe(0);

    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.bailCount).toBe(0);
    expect(sim.landCount).toBe(1);
    expect(sim.grindCount).toBe(1);
  });

  it('SPACE logo depois de sair da ponta ainda dá ollie (coyote)', () => {
    const sim = diagonalSnap();
    runUntil(sim, notGrinding, 3);
    steps(sim, 2);
    jump(sim);
    expect(sim.ollieCount).toBe(2);
    expect(sim.velocity.y).toBeGreaterThan(0);
  });

  it('SPACE no grind: ollie para fora mantendo a velocidade tangente (e volta a trilhar)', () => {
    const sim = diagonalSnap();
    steps(sim, 3);
    const speed = sim.speed;
    jump(sim);
    expect(sim.state).toBe('AIRBORNE');
    expect(sim.ollieCount).toBe(2);
    expect(sim.velocity.y).toBeCloseTo(cfg.ollieVelocity - cfg.gravity * DT, 9);
    expect(sim.speed).toBe(speed);
    expect(sim.velocity.x).toBe(0);
    expect(sim.position.y).toBeGreaterThan(RAIL.top);
    expect(sim.grindType).toBeNull();

    // ainda em cima do corrimão na descida: engata de novo
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GRINDING');
    expect(sim.grindCount).toBe(2);
  });

  it('ollie perto da ponta: passa do fim e pousa limpo no chão', () => {
    const sim = diagonalSnap();
    runUntil(sim, (s) => s.position.z > 6.5, 2);
    expect(sim.state).toBe('GRINDING');
    jump(sim);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.z).toBeGreaterThan(8);
    expect(sim.grindCount).toBe(1);
    expect(sim.bailCount).toBe(0);
  });

  it('atrito: perde grindFriction m/s por segundo; remar e frear são ignorados', () => {
    const pushing = diagonalSnap();
    const braking = diagonalSnap();
    const v0 = pushing.speed;
    run(pushing, 0.5, { forward: true });
    run(braking, 0.5, { brake: true });
    for (const sim of [pushing, braking]) {
      expect(sim.state).toBe('GRINDING');
      expect(sim.speed).toBeCloseTo(v0 - 30 * cfg.grindFriction * DT, 9);
    }
  });

  it('devagar demais: cai do trilho no meio e vai até o chão (não fica em cima do tubo)', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 0.55, 3], [0, 0, 2]);
    runUntil(sim, grinding, 1);
    runUntil(sim, notGrinding, 3);
    expect(sim.state).toBe('AIRBORNE');
    expect(sim.position.z).toBeLessThan(8);
    expect(sim.speed).toBeLessThan(cfg.grindExitSpeed);
    expect(sim.velocity.y).toBe(0);

    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.bailCount).toBe(0);
  });
});

describe('GRINDING: boardslide', () => {
  it('shape atravessado (~90°) vira boardslide, yaw travado; sai realinhado e pousa limpo', () => {
    const sim = ollieFrom(-0.6, 0, 10, 7);
    steps(sim, 15, { left: true }); // +86° no ar
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GRINDING');
    expect(sim.grindType).toBe('boardslide');
    expect(sim.yaw).toBeCloseTo(Math.PI / 2, 9); // perpendicular ao trilho (eixo Z)

    // girar no grind não muda nada
    run(sim, 0.2, { left: true });
    expect(sim.state).toBe('GRINDING');
    expect(sim.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(sim.turnInput).toBe(0);

    runUntil(sim, notGrinding, 3);
    expect(sim.state).toBe('AIRBORNE');
    expect(wrapAngle(sim.yaw - headingOf(sim.velocity))).toBeCloseTo(0, 9);

    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.fakie).toBe(false);
    expect(sim.bailCount).toBe(0);
  });
});

describe('GRINDING: 50-50 de costas', () => {
  it('entra de costas, sai de costas e pousa fakie', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 0.55, 3], [0, 0, 6], Math.PI); // nose para −Z, indo para +Z
    runUntil(sim, grinding, 1);
    expect(sim.grindType).toBe('5050');
    expect(sim.yaw).toBeCloseTo(Math.PI, 9);

    runUntil(sim, notGrinding, 3);
    expect(sim.state).toBe('AIRBORNE');
    expect(Math.abs(wrapAngle(sim.yaw - headingOf(sim.velocity)))).toBeCloseTo(Math.PI, 9);

    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.fakie).toBe(true);
    expect(sim.bailCount).toBe(0);
    expect(sim.velocity.z).toBeGreaterThan(0);
  });
});

describe('GRINDING: não engata', () => {
  it.each([
    [0.25, 'GRINDING'],
    [0.35, 'GROUNDED'],
  ])('passando a %s m do eixo do corrimão → %s', (offset, expected) => {
    const sim = ollieFrom(-offset, 0, 0, 7);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe(expected);
    expect(sim.grindCount).toBe(expected === 'GRINDING' ? 1 : 0);
  });

  it('alto demais: o ollie passa por cima de um corrimão baixo e curto', () => {
    const sim = ollieFrom(0, 0, 0, 7, { rails: [{ x: 0, z: 1, length: 1, axis: 'z', top: 0.2 }] });
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.grindCount).toBe(0);
    expect(sim.position.z).toBeGreaterThan(2.2);
  });

  it('pé acima da janela não engata; engata quando entra nela', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, RAIL.top + cfg.grindSnapAbove + 0.02, 3], [0, 0, 6]);
    sim.step(input(), DT);
    expect(sim.state).toBe('AIRBORNE');
    runUntil(sim, notAirborne, 1);
    expect(sim.state).toBe('GRINDING');
  });

  it('subindo (vy > 0) não engata; na descida, sim', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, RAIL.top, 4], [0, 3, 6]);
    stepWhile(
      sim,
      (s) => s.velocity.y > 0,
      () => expect(sim.state).toBe('AIRBORNE'),
    );
    runUntil(sim, notAirborne, 1);
    expect(sim.state).toBe('GRINDING');
  });

  it('shape entre 30° e 65° do trilho: não engata e atravessa o topo (corrimão não é chão)', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 0.6, 3], [0, 0, 6], deg(45));
    stepWhile(sim, (s) => s.state === 'AIRBORNE', () => expect(sim.state).not.toBe('GRINDING'));
    expect(sim.grindCount).toBe(0);
    expect(sim.position.y).toBe(0);
  });

  it('velocidade a mais de 45° do trilho não engata, mesmo com o shape alinhado', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    const h = deg(60);
    airborne(sim, [-0.4, 0.6, 4], [6 * Math.sin(h), 0, 6 * Math.cos(h)], 0);
    stepWhile(sim, (s) => s.state === 'AIRBORNE', () => expect(sim.state).not.toBe('GRINDING'));
    expect(sim.grindCount).toBe(0);
  });

  it('devagar demais (< grindMinSpeed) não engata', () => {
    const sim = makeLayoutSim({ rails: [RAIL] });
    airborne(sim, [0, 0.6, 4], [0, 0, cfg.grindMinSpeed * 0.8]);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.grindCount).toBe(0);
    expect(sim.position.y).toBe(0);
  });
});

describe('GRINDING: aresta de caixa', () => {
  it.each([
    ['por fora', 1.15],
    ['por cima do topo', 0.85],
  ])('ollie paralelo à aresta, vindo %s, engata 50-50 na aresta e sai no fim', (_, x) => {
    const sim = ollieFrom(x, 2, 0, 7, { boxes: [LEDGE] });
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GRINDING');
    expect(sim.grindType).toBe('5050');
    expect(sim.grindRail?.kind).toBe('edge');
    expect(sim.position.x).toBeCloseTo(1, 9);
    expect(sim.position.y).toBe(LEDGE.height);

    runUntil(sim, notGrinding, 3);
    expect(sim.state).toBe('AIRBORNE');
    expect(sim.position.z).toBeGreaterThan(11);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.bailCount).toBe(0);
  });

  it('pousar no meio de uma caixa larga continua sendo pouso no topo', () => {
    const sim = ollieFrom(0, 2, 0, 7, { boxes: [LEDGE] });
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(LEDGE.height);
    expect(sim.grindCount).toBe(0);
  });

  it('sair rolando pela aresta (sem ollie) não gruda nela', () => {
    const sim = makeLayoutSim({ boxes: [LEDGE] }, { spawnX: 0.7, spawnZ: 6, spawnYaw: deg(10) });
    expect(sim.position.y).toBe(LEDGE.height);
    setSpeed(sim, 5);
    runUntil(sim, (s) => s.state === 'AIRBORNE', 1);
    runUntil(sim, notAirborne, 1);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.grindCount).toBe(0);
  });
});

describe('GRINDING: colisão', () => {
  it.each([
    [2, 'GROUNDED'],
    [8, 'BAILED'],
  ])('bater de lado no corrimão sem ollie (%s m/s) ainda colide como antes → %s', (speed, expected) => {
    const sim = makeLayoutSim({ rails: [RAIL] }, { spawnX: -3, spawnZ: 5, spawnYaw: Math.PI / 2 });
    setSpeed(sim, speed);
    // para no passo em que encosta (ou em 3 s)
    runUntil(sim, (s) => s.speed === 0 || s.state !== 'GROUNDED', 3);
    expect(sim.state).toBe(expected);
    expect(sim.grindCount).toBe(0);
    expect(sim.bailCount).toBe(expected === 'BAILED' ? 1 : 0);
    expect(sim.position.x).toBeCloseTo(-CONFIG.world.railCollisionWidth / 2 - cfg.skaterRadius, 9);
    if (expected === 'GROUNDED') {
      run(sim, 0.5);
      expect(sim.speed).toBe(0);
      expect(sim.state).toBe('GROUNDED');
    }
  });

  it('no grind, bater rápido num poste derruba', () => {
    const sim = diagonalSnap(8, { rails: [RAIL], poles: [{ x: 0, z: 6.5, armYaw: 0 }] });
    expect(sim.state).toBe('GRINDING');
    runUntil(sim, notGrinding, 2);
    expect(sim.state).toBe('BAILED');
    expect(sim.bailCount).toBe(1);
    expect(sim.grindType).toBeNull();
    expect(sim.grindDir.lengthSq()).toBe(0);
  });

  it('no grind, encostar devagar num poste tira do trilho sem bail', () => {
    const sim = makeLayoutSim({ rails: [RAIL], poles: [{ x: 0, z: 6.5, armYaw: 0 }] });
    airborne(sim, [0, 0.55, 4.5], [0, 0, 3]);
    runUntil(sim, grinding, 1);
    runUntil(sim, notGrinding, 2);
    expect(sim.state).toBe('AIRBORNE');
    expect(sim.speed).toBe(0);
    runUntil(sim, notAirborne, 2);
    expect(sim.state).toBe('GROUNDED');
    expect(sim.position.y).toBe(0);
    expect(sim.bailCount).toBe(0);
    expect(sim.grindCount).toBe(1);
  });
});

describe('GRINDING: reset', () => {
  it('reset limpa o grind (contadores continuam monotônicos)', () => {
    const sim = diagonalSnap();
    expect(sim.state).toBe('GRINDING');
    sim.reset();
    expect(sim.state).toBe('GROUNDED');
    expect(sim.grindType).toBeNull();
    expect(sim.grindRail).toBeNull();
    expect(sim.grindDir.lengthSq()).toBe(0);
    expect(sim.position.toArray()).toEqual([-0.6, 0, 0]);
    expect(sim.prevPosition.toArray()).toEqual([-0.6, 0, 0]);
    expect(sim.grindCount).toBe(1);
  });
});
