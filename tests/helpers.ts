import { CONFIG, type BoxDef, type PoleDef, type RailDef, type SimConfig, type SolidDef } from '../src/config';
import { worldDef } from '../src/sim/layout';
import { SkaterSim } from '../src/sim/SkaterSim';
import type { InputState } from '../src/sim/types';
import { World } from '../src/sim/World';

export const DT = CONFIG.loop.fixedDt;

export function box(x: number, z: number, sizeX: number, sizeZ: number, height: number): SolidDef {
  return { x, z, sizeX, sizeZ, height };
}

export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...structuredClone(CONFIG.sim), ...overrides };
}

export function makeSim(boxes: SolidDef[] = [], overrides: Partial<SimConfig> = {}): SkaterSim {
  return new SkaterSim(new World({ size: CONFIG.world.size, boxes }), makeConfig(overrides));
}

export interface TestLayout {
  boxes?: BoxDef[];
  rails?: RailDef[];
  poles?: PoleDef[];
}

/** Sim num mundo montado como no jogo (colisão + segmentos de grind), só com os obstáculos dados. */
export function makeLayoutSim(layout: TestLayout, overrides: Partial<SimConfig> = {}): SkaterSim {
  const world = { ...CONFIG.world, boxes: layout.boxes ?? [], rails: layout.rails ?? [], poles: layout.poles ?? [] };
  return new SkaterSim(new World(worldDef(world)), makeConfig(overrides));
}

export function input(partial: Partial<InputState> = {}): InputState {
  return { forward: false, brake: false, left: false, right: false, jumpPressed: false, ...partial };
}

/** Coloca o skater andando reto no chão a `speed` m/s na direção do yaw. */
export function setSpeed(sim: SkaterSim, speed: number): void {
  sim.velocity.set(Math.sin(sim.yaw) * speed, 0, Math.cos(sim.yaw) * speed);
}

/** Roda `n` passos fixos com o input segurado (jump só no 1º passo). */
export function steps(sim: SkaterSim, n: number, held: Partial<InputState> = {}): void {
  for (let i = 0; i < n; i++) {
    sim.step(input({ ...held, jumpPressed: i === 0 && !!held.jumpPressed }), DT);
  }
}

export function run(sim: SkaterSim, seconds: number, held: Partial<InputState> = {}): void {
  steps(sim, Math.round(seconds / DT), held);
}

/** Roda até `done(sim)` ser verdadeiro; retorna o número de passos. Falha se passar de maxSeconds. */
export function runUntil(
  sim: SkaterSim,
  done: (sim: SkaterSim) => boolean,
  maxSeconds: number,
  held: Partial<InputState> = {},
): number {
  const maxSteps = Math.round(maxSeconds / DT);
  for (let i = 1; i <= maxSteps; i++) {
    sim.step(input({ ...held, jumpPressed: false }), DT);
    if (done(sim)) return i;
  }
  throw new Error(`condição não atingida em ${maxSeconds}s`);
}

export function jump(sim: SkaterSim, held: Partial<InputState> = {}): void {
  sim.step(input({ ...held, jumpPressed: true }), DT);
}
