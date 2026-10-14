import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/core/FixedStepper';

const cfg = { fixedDt: 1 / 60, maxStepsPerFrame: 5, maxFrameDt: 0.1 };

function count(stepper: FixedStepper, frameDt: number): { steps: number; alpha: number } {
  return stepper.advance(frameDt, () => {});
}

describe('FixedStepper', () => {
  it('um frame de 1/60 s roda exatamente 1 passo', () => {
    const r = count(new FixedStepper(cfg), 1 / 60);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0, 9);
  });

  it('acumula frames curtos (120 Hz)', () => {
    const s = new FixedStepper(cfg);
    const a = count(s, 1 / 120);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeCloseTo(0.5, 9);
    expect(count(s, 1 / 120).steps).toBe(1);
  });

  it('passa sempre o dt fixo para a simulação', () => {
    const dts: number[] = [];
    new FixedStepper(cfg).advance(0.055, (dt) => dts.push(dt));
    expect(dts).toEqual([1 / 60, 1 / 60, 1 / 60]);
  });

  it('no máximo maxStepsPerFrame passos e alpha em [0, 1)', () => {
    const r = count(new FixedStepper(cfg), 10);
    expect(r.steps).toBe(5);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });

  it('não carrega atraso depois de um frame gigante', () => {
    const s = new FixedStepper(cfg);
    count(s, 10);
    expect(count(s, 1 / 60).steps).toBeLessThanOrEqual(2);
  });

  it('dt negativo não roda passos', () => {
    expect(count(new FixedStepper(cfg), -1).steps).toBe(0);
  });
});
