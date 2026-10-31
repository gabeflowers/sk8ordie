import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { computeJoints, createJoints, createPose, lerpPose, solveTwoBoneIK } from '../src/render/rig';

const rig = CONFIG.visual.rig;
const ankleF = new Vector3(rig.ankleX, rig.ankleHeight, rig.stanceHalf);
const ankleB = new Vector3(rig.ankleX, rig.ankleHeight, -rig.stanceHalf);

describe('solveTwoBoneIK', () => {
  it('preserva o comprimento dos ossos e dobra para o pole', () => {
    const root = new Vector3(0, 0.88, 0.09);
    const target = new Vector3(0.04, 0.08, 0.21);
    const mid = new Vector3();
    const end = new Vector3();
    solveTwoBoneIK(root, target, 0.43, 0.43, new Vector3(-1, 0, 0), mid, end);
    expect(mid.distanceTo(root)).toBeCloseTo(0.43, 6);
    expect(mid.distanceTo(end)).toBeCloseTo(0.43, 6);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(mid.x).toBeLessThan(Math.min(root.x, target.x)); // joelho para o lado do peito
  });

  it('alvo fora de alcance: estica até o limite sem quebrar os ossos', () => {
    const root = new Vector3(0, 2, 0);
    const target = new Vector3(0, 0, 0);
    const mid = new Vector3();
    const end = new Vector3();
    solveTwoBoneIK(root, target, 0.43, 0.43, new Vector3(-1, 0, 0), mid, end);
    expect(mid.distanceTo(root)).toBeCloseTo(0.43, 6);
    expect(mid.distanceTo(end)).toBeCloseTo(0.43, 6);
    expect(end.y).toBeGreaterThan(target.y);
  });
});

describe('computeJoints', () => {
  for (const name of ['base', 'landing', 'air', 'grind', 'push'] as const) {
    it(`pose ${name}: ossos com o comprimento do rig`, () => {
      const j = computeJoints({ pose: rig.poses[name], ankleF, ankleB, curveT: 0 }, rig, createJoints());
      expect(j.hipF.distanceTo(j.kneeF)).toBeCloseTo(rig.thigh, 6);
      expect(j.kneeF.distanceTo(j.ankleF)).toBeCloseTo(rig.shin, 6);
      expect(j.hipB.distanceTo(j.kneeB)).toBeCloseTo(rig.thigh, 6);
      expect(j.kneeB.distanceTo(j.ankleB)).toBeCloseTo(rig.shin, 6);
      expect(j.shoulderF.distanceTo(j.elbowF)).toBeCloseTo(rig.upperArm, 6);
      expect(j.elbowF.distanceTo(j.handF)).toBeCloseTo(rig.forearm, 6);
      expect(j.shoulderB.distanceTo(j.elbowB)).toBeCloseTo(rig.upperArm, 6);
      expect(j.elbowB.distanceTo(j.handB)).toBeCloseTo(rig.forearm, 6);
      expect(j.hip.distanceTo(j.neckBase)).toBeCloseTo(rig.spine, 6);
    });
  }

  it('pose base: pés no shape e cabeça na altura de uma pessoa de ~1,78 m agachada', () => {
    const j = computeJoints({ pose: rig.poses.base, ankleF, ankleB, curveT: 0 }, rig, createJoints());
    expect(j.ankleF.distanceTo(ankleF)).toBeLessThan(1e-6);
    expect(j.ankleB.distanceTo(ankleB)).toBeLessThan(1e-6);
    expect(j.head.y).toBeGreaterThan(1.45);
    expect(j.head.y).toBeLessThan(1.7);
    expect(j.kneeF.x).toBeLessThan(j.hip.x); // joelhos flexionados para o peito
  });

  it('remada: o pé de trás alcança o chão ao lado do shape e o joelho dobra para o pole dado', () => {
    const push = CONFIG.visual.push;
    const deckTop = 2 * CONFIG.visual.wheels.radius + CONFIG.visual.board.truckHeight + CONFIG.visual.board.thickness;
    const plant = new Vector3(push.plantX, rig.ankleHeight - deckTop, push.plantZ);
    const poleB = new Vector3().fromArray(push.kneePoleB);
    const j = computeJoints(
      { pose: rig.poses.push, ankleF, ankleB: plant, curveT: 0, poleB },
      rig,
      createJoints(),
    );
    expect(j.ankleB.distanceTo(plant)).toBeLessThan(1e-6); // alcançável sem esticar demais
    expect(j.kneeB.z).toBeGreaterThan((j.hipB.z + j.ankleB.z) / 2); // joelho para a frente
  });

  it('na curva as mãos sobem', () => {
    const still = computeJoints({ pose: rig.poses.base, ankleF, ankleB, curveT: 0 }, rig, createJoints());
    const carve = computeJoints({ pose: rig.poses.base, ankleF, ankleB, curveT: 1 }, rig, createJoints());
    expect(carve.handF.y).toBeGreaterThan(still.handF.y);
    expect(carve.handB.y).toBeGreaterThan(still.handB.y);
  });
});

describe('lerpPose', () => {
  it('interpola todos os campos', () => {
    const out = lerpPose(createPose(), rig.poses.base, rig.poses.air, 0.5);
    expect(out.hipY).toBeCloseTo((rig.poses.base.hipY + rig.poses.air.hipY) / 2, 9);
    expect(out.handF[1]).toBeCloseTo((rig.poses.base.handF[1] + rig.poses.air.handF[1]) / 2, 9);
    expect(lerpPose(createPose(), rig.poses.base, rig.poses.air, 0)).toEqual(rig.poses.base);
    expect(lerpPose(createPose(), rig.poses.base, rig.poses.air, 1)).toEqual(rig.poses.air);
  });
});
