import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BoardBody } from '../src/render/boardBody';
import { RAGDOLL_JOINTS, Ragdoll, type RagdollJoint, type RagdollPose } from '../src/render/ragdoll';
import { computeJoints, createJoints } from '../src/render/rig';
import { World } from '../src/sim/World';
import { box } from './helpers';

const bail = CONFIG.visual.bail;
const rig = CONFIG.visual.rig;
const board = CONFIG.visual.board;
const wheels = CONFIG.visual.wheels;
const FRAME = 1 / 60;
const deckTop = 2 * wheels.radius + board.truckHeight + board.thickness;

/** Pose base do rig em espaço de mundo, com o skater em (0, 0, 0) olhando para +Z. */
function standingPose(): RagdollPose {
  const ankleF = new Vector3(rig.ankleX, rig.ankleHeight, rig.stanceHalf);
  const ankleB = new Vector3(rig.ankleX, rig.ankleHeight, -rig.stanceHalf);
  const j = computeJoints({ pose: rig.poses.base, ankleF, ankleB, curveT: 0 }, rig, createJoints());
  const map: Record<RagdollJoint, Vector3> = {
    hipF: j.hipF, hipB: j.hipB, kneeF: j.kneeF, kneeB: j.kneeB, ankleF: j.ankleF, ankleB: j.ankleB,
    shoulderF: j.shoulderF, shoulderB: j.shoulderB, neck: j.neckBase, head: j.head,
    elbowF: j.elbowF, elbowB: j.elbowB, handF: j.handF, handB: j.handB,
  };
  for (const v of Object.values(map)) v.y += deckTop;
  return map;
}

function run(seconds: number, step: () => void): void {
  for (let t = 0; t < seconds; t += FRAME) step();
}

const BONES: [RagdollJoint, RagdollJoint][] = [
  ['hipF', 'kneeF'], ['kneeF', 'ankleF'], ['hipB', 'kneeB'], ['kneeB', 'ankleB'],
  ['shoulderF', 'elbowF'], ['elbowF', 'handF'], ['neck', 'head'], ['hipF', 'shoulderF'],
];

describe('ragdoll do tombo', () => {
  it('com momento: tomba para a frente, assenta no chão sem atravessar e sem esticar os ossos', () => {
    const world = new World({ size: 120, boxes: [] });
    const pose = standingPose();
    const rest = BONES.map(([a, b]) => pose[a].distanceTo(pose[b]));
    const ragdoll = new Ragdoll(bail);
    ragdoll.start(pose, new Vector3(0, 0, 6), bail.feetVelocityLanding, 1);
    const anchor = new Vector3(0, 0, 3);

    run(3, () => {
      ragdoll.step(FRAME, world, anchor);
      for (const j of RAGDOLL_JOINTS) expect(ragdoll.get(j).y).toBeGreaterThan(0);
    });

    for (const j of RAGDOLL_JOINTS) expect(Number.isFinite(ragdoll.get(j).length())).toBe(true);
    BONES.forEach(([a, b], i) => {
      expect(ragdoll.get(a).distanceTo(ragdoll.get(b))).toBeCloseTo(rest[i] ?? 0, 1);
    });
    expect(ragdoll.kineticEnergy()).toBeLessThan(0.05);
    expect(ragdoll.get('head').y).toBeLessThan(0.5); // caiu
    expect(ragdoll.get('neck').y).toBeLessThan(0.5); // deitado, não sentado
    expect(ragdoll.get('hipF').z).toBeGreaterThan(1); // o momento levou o corpo para a frente
  });

  it('batendo numa caixa: nenhuma junta termina dentro dela', () => {
    const wall = box(0, 2, 4, 2, 0.5); // z ∈ [1, 3]
    const world = new World({ size: 120, boxes: [wall] });
    const ragdoll = new Ragdoll(bail);
    ragdoll.start(standingPose(), new Vector3(0, 0, 7), bail.feetVelocityImpact, bail.kneeVelocityImpact);
    const anchor = new Vector3(0, 0, 0.7);
    run(2, () => ragdoll.step(FRAME, world, anchor));

    for (const j of RAGDOLL_JOINTS) {
      const p = ragdoll.get(j);
      const inside = p.x > -2 && p.x < 2 && p.z > 1 && p.z < 3 && p.y < 0.5 - 1e-3;
      expect(inside).toBe(false);
    }
  });
});

describe('shape solto', () => {
  const halfY = deckTop / 2;
  const halfZ = board.plankLength / 2 + board.kickLength * Math.cos(board.kickAngle);
  const make = (): BoardBody => new BoardBody(bail, board.width / 2, halfY, halfZ);
  const flatWorld = new World({ size: 120, boxes: [] });

  it('arremessado girando: quica, para e assenta deitado no chão', () => {
    const b = make();
    b.start(new Vector3(0, 0.4, 0), new Quaternion(), new Vector3(0, 2, 6), new Vector3(9, 0, 0));
    run(5, () => b.step(FRAME, flatWorld));
    expect(Math.hypot(b.velocity.x, b.velocity.z)).toBeLessThan(0.05);
    const up = new Vector3(0, 1, 0).applyQuaternion(b.quaternion);
    expect(Math.abs(up.y)).toBeGreaterThan(0.99);
    expect(b.center.y).toBeCloseTo(halfY, 2);
  });

  it('com as rodas para baixo rola bem mais longe que de cabeça para baixo', () => {
    const wheelsDown = make();
    const upsideDown = make();
    const flipped = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    wheelsDown.start(new Vector3(0, halfY, 0), new Quaternion(), new Vector3(0, 0, 4), new Vector3());
    upsideDown.start(new Vector3(0, halfY, 0), flipped, new Vector3(0, 0, 4), new Vector3());
    run(3, () => {
      wheelsDown.step(FRAME, flatWorld);
      upsideDown.step(FRAME, flatWorld);
    });
    expect(wheelsDown.center.z).toBeGreaterThan(upsideDown.center.z + 0.5);
  });

  it('bate na lateral de uma caixa e volta', () => {
    const world = new World({ size: 120, boxes: [box(0, 3, 4, 2, 0.6)] }); // z ∈ [2, 4]
    const b = make();
    b.start(new Vector3(0, halfY, 0), new Quaternion(), new Vector3(0, 0, 5), new Vector3());
    let minVz = Infinity;
    run(1.5, () => {
      b.step(FRAME, world);
      minVz = Math.min(minVz, b.velocity.z);
    });
    expect(minVz).toBeLessThan(0);
    expect(b.center.z).toBeLessThan(2);
  });
});
