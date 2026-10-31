import type { SimConfig } from '../../config';

// Adaptação do Flick-It (Skate 3) para teclado. Puro: recebe eventos de tecla com tempo e
// devolve intenções; o Input (DOM) só repassa os eventos.

export type TrickId = keyof SimConfig['tricks']['catalog'];
export type FlipKey = 'A' | 'D' | 'S' | 'W';
export type GrabId = keyof SimConfig['tricks']['grabs'];
export type GrabHand = 'front' | 'back';

/**
 * Mão + inclinação (W = +1, S = −1) → grab.
 * Frente: melon · W nosegrab · S mute. Trás: indy · S tailgrab · W stalefish.
 */
export function resolveGrab(hand: GrabHand, tilt: number): GrabId {
  if (hand === 'front') return tilt > 0 ? 'nosegrab' : tilt < 0 ? 'mute' : 'melon';
  return tilt < 0 ? 'tailgrab' : tilt > 0 ? 'stalefish' : 'indy';
}

/** Pop: soltar Espaço (ollie) ou Q (nollie) depois de agachar. */
export interface PopIntent {
  nollie: boolean;
  /** 0..1: quanto tempo agachou, em relação a `chargeTime` */
  charge: number;
  trick: TrickId | null;
}

type TricksConfig = Pick<SimConfig['tricks'], 'chargeTime' | 'doubleTap'>;

const FLIP_CODES: Record<string, FlipKey> = { KeyA: 'A', KeyD: 'D', KeyS: 'S', KeyW: 'W' };
const POP_CODES = new Set(['Space', 'KeyQ']);

/**
 * Teclas seguradas (e batidas duplas) → manobra.
 * A kickflip · D heelflip · S pop shove-it · W FS shove-it · A+S varial kickflip ·
 * D+W varial heelflip · A+W hardflip · D+S inward heelflip · S duas vezes (+A) = 360 shove (360 flip) ·
 * A ou D duas vezes = double.
 */
export function resolveTrick(held: ReadonlySet<FlipKey>, taps: ReadonlyMap<FlipKey, number>, doubleTap: number): TrickId | null {
  const has = (k: FlipKey): boolean => held.has(k) || (taps.get(k) ?? 0) > 0;
  const double = (k: FlipKey): boolean => (taps.get(k) ?? 0) >= doubleTap;
  const a = has('A');
  const d = has('D');
  const s = has('S');
  const w = has('W');

  if (double('S') && a) return 'treFlip';
  if (double('S')) return 'shove360';
  if (a && s) return 'varialKickflip';
  if (d && w) return 'varialHeelflip';
  if (a && w) return 'hardflip';
  if (d && s) return 'inwardHeelflip';
  if (double('A')) return 'doubleKickflip';
  if (double('D')) return 'doubleHeelflip';
  if (a) return 'kickflip';
  if (d) return 'heelflip';
  if (s) return 'popShove';
  if (w) return 'fsShove';
  return null;
}

export class TrickGesture {
  private popKey: string | null = null;
  private crouchStart = 0;
  private readonly held = new Set<FlipKey>();
  private readonly taps = new Map<FlipKey, number>();
  private pendingPop: PopIntent | null = null;
  private pendingLate: TrickId | null = null;
  private pendingTap: FlipKey | null = null;

  constructor(private readonly cfg: TricksConfig) {}

  /** Agachado, esperando soltar para dar o pop. */
  get crouching(): boolean {
    return this.popKey !== null;
  }

  keyDown(code: string, time: number): void {
    if (POP_CODES.has(code)) {
      if (this.popKey === null) {
        this.popKey = code;
        this.crouchStart = time;
        this.taps.clear();
      }
      return;
    }
    const k = FLIP_CODES[code];
    if (!k) return;
    this.held.add(k);
    if (this.popKey !== null) {
      this.taps.set(k, (this.taps.get(k) ?? 0) + 1);
    } else {
      // sem agachar: no ar vira late flip; no chão, S/W entram em manual (a sim decide)
      this.pendingLate = resolveTrick(this.held, new Map(), this.cfg.doubleTap);
      this.pendingTap = k;
    }
  }

  keyUp(code: string, time: number): void {
    if (code === this.popKey) {
      const charge = Math.min(1, Math.max(0, (time - this.crouchStart) / this.cfg.chargeTime));
      this.pendingPop = {
        nollie: code === 'KeyQ',
        charge,
        trick: resolveTrick(this.held, this.taps, this.cfg.doubleTap),
      };
      this.popKey = null;
      this.taps.clear();
      return;
    }
    const k = FLIP_CODES[code];
    if (k) this.held.delete(k);
  }

  /** Pop pendente (uma vez). */
  consumePop(): PopIntent | null {
    const p = this.pendingPop;
    this.pendingPop = null;
    return p;
  }

  /** Late flip pendente (uma vez). */
  consumeLate(): TrickId | null {
    const t = this.pendingLate;
    this.pendingLate = null;
    return t;
  }

  /** Batida de A/D/S/W sem agachar (uma vez). */
  consumeTap(): FlipKey | null {
    const t = this.pendingTap;
    this.pendingTap = null;
    return t;
  }

  /** W segurado = +1, S segurado = −1 (manual, grabs). */
  get tilt(): number {
    return (this.held.has('W') ? 1 : 0) - (this.held.has('S') ? 1 : 0);
  }

  clear(): void {
    this.popKey = null;
    this.held.clear();
    this.taps.clear();
    this.pendingPop = null;
    this.pendingLate = null;
    this.pendingTap = null;
  }
}
