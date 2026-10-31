import type { SimConfig } from '../config';

// Pontuação estilo Skate 3. Puro: a sim chama `add` a cada manobra pousada e `tick` a cada passo.

type ScoreConfig = SimConfig['score'];

export interface TrickAward {
  name: string;
  points: number;
}

export interface LineResult {
  points: number;
  banked: boolean;
}

export class Score {
  /** Pontos já garantidos (linhas fechadas). */
  total = 0;
  /** Melhor linha fechada. */
  best = 0;
  /** Manobras da linha atual, em ordem. */
  readonly line: TrickAward[] = [];
  /** Última manobra registrada e um contador que sobe a cada uma (para o HUD). */
  lastTrick: TrickAward | null = null;
  trickCount = 0;
  /** Última linha encerrada (fechada ou perdida no bail) e contador de linhas. */
  lastLine: LineResult | null = null;
  lineCount = 0;

  private linePoints = 0;
  private readonly counts = new Map<string, number>();
  private idle = 0;

  constructor(private readonly cfg: ScoreConfig) {}

  /** Multiplicador = número de manobras diferentes na linha. */
  get multiplier(): number {
    return Math.max(1, this.counts.size);
  }

  get lineBase(): number {
    return Math.round(this.linePoints);
  }

  get lineTotal(): number {
    return Math.round(this.linePoints * this.multiplier);
  }

  /** Registra uma manobra pousada. Repetir a mesma rende `repeatFactor` a cada vez. */
  add(name: string, basePoints: number): TrickAward {
    const repeats = this.counts.get(name) ?? 0;
    const award = { name, points: Math.round(basePoints * this.cfg.repeatFactor ** repeats) };
    this.counts.set(name, repeats + 1);
    this.linePoints += award.points;
    this.line.push(award);
    this.lastTrick = award;
    this.trickCount++;
    this.idle = 0;
    return award;
  }

  /** Mantém a linha viva (no ar, em grind). */
  keepAlive(): void {
    this.idle = 0;
  }

  /** Rolando sem manobra por `comboTimeout`, a linha fecha. */
  tick(dt: number, rollingIdle: boolean): void {
    if (this.line.length === 0) return;
    if (!rollingIdle) {
      this.idle = 0;
      return;
    }
    this.idle += dt;
    if (this.idle >= this.cfg.comboTimeout) this.bank();
  }

  bank(): void {
    if (this.line.length === 0) return;
    const points = this.lineTotal;
    this.total += points;
    this.best = Math.max(this.best, points);
    this.finishLine({ points, banked: true });
  }

  /** Bail: a linha inteira é perdida. */
  bail(): void {
    if (this.line.length === 0) return;
    this.finishLine({ points: this.lineTotal, banked: false });
  }

  reset(): void {
    this.total = 0;
    this.clearLine();
  }

  private finishLine(result: LineResult): void {
    this.lastLine = result;
    this.lineCount++;
    this.clearLine();
  }

  private clearLine(): void {
    this.line.length = 0;
    this.counts.clear();
    this.linePoints = 0;
    this.idle = 0;
  }
}
