import type { LoopConfig } from '../config';

export interface StepResult {
  steps: number;
  /** fração do próximo passo já acumulada, para interpolar o render (0..1) */
  alpha: number;
}

/** Acumulador de timestep fixo. Puro: não conhece DOM nem relógio. */
export class FixedStepper {
  private accumulator = 0;

  constructor(private readonly cfg: LoopConfig) {}

  advance(frameDt: number, step: (dt: number) => void): StepResult {
    const { fixedDt, maxStepsPerFrame, maxFrameDt } = this.cfg;
    this.accumulator += Math.min(Math.max(frameDt, 0), maxFrameDt);

    let steps = 0;
    while (this.accumulator >= fixedDt && steps < maxStepsPerFrame) {
      step(fixedDt);
      this.accumulator -= fixedDt;
      steps++;
    }

    // bateu no limite de passos: descarta o atraso em vez de acumular (sem espiral)
    if (this.accumulator >= fixedDt) this.accumulator %= fixedDt;

    return { steps, alpha: this.accumulator / fixedDt };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
