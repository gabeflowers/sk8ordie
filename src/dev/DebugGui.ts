import GUI from 'lil-gui';
import { MathUtils } from 'three';
import { CONFIG } from '../config';
import type { Game } from '../core/Game';

// Faixas dos sliders: metadados da ferramenta de dev, não parâmetros do jogo.
type Range = [min: number, max: number, step: number];

const SIM_FOLDERS: Record<string, Partial<Record<keyof typeof CONFIG.sim, Range>>> = {
  Movimento: {
    maxPushSpeed: [0, 20, 0.1],
    maxSpeed: [0, 30, 0.1],
    pushAccel: [0, 20, 0.1],
    brakeDecel: [0, 30, 0.1],
    rollingFriction: [0, 5, 0.05],
    turnRateSlow: [0, 6, 0.05],
    turnRateFast: [0, 6, 0.05],
  },
  Ar: {
    gravity: [1, 60, 0.5],
    ollieVelocity: [0, 15, 0.1],
    airSpinRate: [0, 15, 0.1],
    landingMinSpeed: [0, 3, 0.05],
  },
  Tolerâncias: {
    coyoteTime: [0, 0.5, 0.01],
    jumpBuffer: [0, 0.5, 0.01],
    stepTolerance: [0, 0.3, 0.01],
    skaterRadius: [0.1, 1, 0.01],
  },
  Bail: {
    bailResetTime: [0, 5, 0.1],
    bailImpactSpeed: [0, 20, 0.1],
    bailDecel: [0, 30, 0.5],
  },
  Grind: {
    grindSnapBelow: [0, 0.5, 0.01],
    grindSnapAbove: [0, 0.5, 0.01],
    grindSnapDistance: [0, 1, 0.01],
    grindMinSpeed: [0, 6, 0.1],
    grindExitSpeed: [0, 6, 0.05],
    grindFriction: [0, 8, 0.1],
  },
};

/** Ângulos guardados em radianos no config e editados em graus na GUI. */
const DEGREE_KEYS: Partial<Record<keyof typeof CONFIG.sim, [folder: string, max: number]>> = {
  landingTolerance: ['Ar', 90],
  grindMaxApproachAngle: ['Grind', 90],
  grindFiftyFiftyAngle: ['Grind', 90],
  grindBoardslideTolerance: ['Grind', 90],
};

const CAMERA_RANGES: Partial<Record<keyof typeof CONFIG.camera, Range>> = {
  camDistance: [1, 15, 0.1],
  camHeight: [0, 8, 0.1],
  camLookAhead: [0, 10, 0.1],
  camLookHeight: [0, 3, 0.05],
  camDamping: [0.5, 30, 0.5],
  camLookDamping: [0.5, 30, 0.5],
  fovMin: [30, 110, 1],
  fovMax: [30, 110, 1],
};

const JUICE_RANGES: Partial<Record<keyof typeof CONFIG.visual.juice, Range>> = {
  leanMax: [0, 1.2, 0.01],
  boardLeanFactor: [0, 1, 0.01],
  popAngle: [0, 1, 0.01],
  popDuration: [0.05, 1, 0.01],
  landCrouchDuration: [0.05, 1, 0.01],
};

const LIGHT_RANGES: Partial<Record<keyof typeof CONFIG.visual.lights, Range>> = {
  hemiIntensity: [0, 3, 0.05],
  moonIntensity: [0, 5, 0.05],
  rimIntensity: [0, 5, 0.05],
  lightMapIntensity: [0, 40, 0.5],
};

const FOG_RANGES: Partial<Record<keyof typeof CONFIG.visual.fog, Range>> = {
  near: [0, 100, 1],
  far: [20, 300, 1],
};

function addRanges<T extends object>(folder: GUI, target: T, ranges: Partial<Record<keyof T, Range>>): void {
  for (const [key, range] of Object.entries(ranges) as [keyof T & string, Range][]) {
    folder.add(target, key, ...range);
  }
}

/** Painel de tuning em tempo real (só em dev, carregado por import dinâmico). */
export function setupDebugGui(game: Game): GUI {
  const defaults = structuredClone(CONFIG);
  const gui = new GUI({ title: 'Tuning (dev)' });

  const info = gui.addFolder('Estado');
  const readout = {
    get state(): string {
      return game.sim.fakie ? `${game.sim.state} (fakie)` : game.sim.state;
    },
    get speed(): string {
      return `${game.sim.speed.toFixed(2)} m/s`;
    },
    get height(): string {
      return `${game.sim.position.y.toFixed(2)} m`;
    },
  };
  for (const key of ['state', 'speed', 'height'] as const) info.add(readout, key).listen().disable();

  const simFolders = new Map<string, GUI>();
  for (const [name, ranges] of Object.entries(SIM_FOLDERS)) {
    const folder = gui.addFolder(name);
    addRanges(folder, CONFIG.sim, ranges);
    simFolders.set(name, folder);
  }

  // ângulos ficam em radianos no config; aqui são editados em graus por um proxy
  const deg: Record<string, number> = {};
  const syncDegrees = (): void => {
    for (const key of Object.keys(DEGREE_KEYS) as (keyof typeof CONFIG.sim)[]) {
      deg[key] = MathUtils.radToDeg(CONFIG.sim[key]);
    }
  };
  syncDegrees();
  for (const [key, spec] of Object.entries(DEGREE_KEYS) as [keyof typeof CONFIG.sim, [string, number]][]) {
    simFolders
      .get(spec[0])
      ?.add(deg, key, 0, spec[1], 1)
      .name(`${key} (°)`)
      .onChange((v: number) => {
        CONFIG.sim[key] = MathUtils.degToRad(v);
      });
  }

  addRanges(gui.addFolder('Câmera'), CONFIG.camera, CAMERA_RANGES);
  addRanges(gui.addFolder('Juice'), CONFIG.visual.juice, JUICE_RANGES);

  const visual = gui.addFolder('Luz e névoa');
  visual.add(CONFIG.visual, 'debugGrid').name('grid de debug');
  addRanges(visual, CONFIG.visual.lights, LIGHT_RANGES);
  addRanges(visual, CONFIG.visual.fog, FOG_RANGES);

  // só o readout de estado começa aberto
  gui.folders.filter((f) => f !== info).forEach((f) => f.close());

  gui.add(
    {
      reset: (): void => {
        Object.assign(CONFIG.sim, defaults.sim);
        Object.assign(CONFIG.camera, defaults.camera);
        Object.assign(CONFIG.visual.juice, defaults.visual.juice);
        Object.assign(CONFIG.visual.lights, defaults.visual.lights);
        Object.assign(CONFIG.visual.fog, defaults.visual.fog);
        CONFIG.visual.debugGrid = defaults.visual.debugGrid;
        syncDegrees();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    },
    'reset',
  ).name('Reset defaults');

  gui.add(
    {
      copy: (): void => {
        const tuned = {
          sim: CONFIG.sim,
          camera: CONFIG.camera,
          juice: CONFIG.visual.juice,
          lights: CONFIG.visual.lights,
          fog: CONFIG.visual.fog,
        };
        void navigator.clipboard.writeText(JSON.stringify(tuned, null, 2));
      },
    },
    'copy',
  ).name('Copiar config JSON');

  return gui;
}
