import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { PoseParams, RigConfig, Vec3Tuple } from '../config';
import { EPSILON } from '../sim/math';

// Matemática pura do rig do personagem (sem cena): mistura de poses, IK de 2 ossos e juntas.
// Espaço do bodyPivot: origem no topo do shape, +Z = nose, +Y = cima, −X = peito.

/** Fração do alcance máximo da perna; evita a perna 100% esticada (IK instável). */
const IK_MAX_REACH = 0.999;

export interface RigJoints {
  hip: Vector3;
  hipF: Vector3;
  hipB: Vector3;
  kneeF: Vector3;
  kneeB: Vector3;
  ankleF: Vector3;
  ankleB: Vector3;
  neckBase: Vector3;
  neckTop: Vector3;
  head: Vector3;
  shoulderF: Vector3;
  shoulderB: Vector3;
  elbowF: Vector3;
  elbowB: Vector3;
  handF: Vector3;
  handB: Vector3;
  torso: Quaternion;
  headRot: Quaternion;
}

export interface RigInput {
  pose: PoseParams;
  ankleF: Vector3;
  ankleB: Vector3;
  /** 0..1: quanto o skater está inclinado na curva (sobe e abre as mãos) */
  curveT: number;
  /** Para onde cada joelho dobra; sem isso, o padrão do rig (lado do peito). */
  poleF?: Vector3;
  poleB?: Vector3;
  /** Mão indo a um alvo (grab): ponto, peso 0..1 e para onde o cotovelo aponta. */
  handTargetF?: Vector3;
  handTargetB?: Vector3;
  handWeightF?: number;
  handWeightB?: number;
  elbowPoleF?: Vector3;
  elbowPoleB?: Vector3;
}

export function createJoints(): RigJoints {
  const v = (): Vector3 => new Vector3();
  return {
    hip: v(), hipF: v(), hipB: v(), kneeF: v(), kneeB: v(), ankleF: v(), ankleB: v(),
    neckBase: v(), neckTop: v(), head: v(),
    shoulderF: v(), shoulderB: v(), elbowF: v(), elbowB: v(), handF: v(), handB: v(),
    torso: new Quaternion(), headRot: new Quaternion(),
  };
}

export function createPose(): PoseParams {
  return {
    hipX: 0, hipY: 0, lean: 0, twist: 0, headYaw: 0, headPitch: 0,
    elbowF: [0, 0, 0], handF: [0, 0, 0], elbowB: [0, 0, 0], handB: [0, 0, 0],
  };
}

function lerpTuple(out: Vec3Tuple, a: Vec3Tuple, b: Vec3Tuple, t: number): void {
  out[0] = MathUtils.lerp(a[0], b[0], t);
  out[1] = MathUtils.lerp(a[1], b[1], t);
  out[2] = MathUtils.lerp(a[2], b[2], t);
}

/** out = a + (b − a)·t, campo a campo. `out` pode ser o próprio `a`. */
export function lerpPose(out: PoseParams, a: PoseParams, b: PoseParams, t: number): PoseParams {
  out.hipX = MathUtils.lerp(a.hipX, b.hipX, t);
  out.hipY = MathUtils.lerp(a.hipY, b.hipY, t);
  out.lean = MathUtils.lerp(a.lean, b.lean, t);
  out.twist = MathUtils.lerp(a.twist, b.twist, t);
  out.headYaw = MathUtils.lerp(a.headYaw, b.headYaw, t);
  out.headPitch = MathUtils.lerp(a.headPitch, b.headPitch, t);
  lerpTuple(out.elbowF, a.elbowF, b.elbowF, t);
  lerpTuple(out.handF, a.handF, b.handF, t);
  lerpTuple(out.elbowB, a.elbowB, b.elbowB, t);
  lerpTuple(out.handB, a.handB, b.handB, t);
  return out;
}

const ikDir = new Vector3();
const ikBend = new Vector3();

/**
 * IK analítico de 2 ossos (lei dos cossenos). Calcula a junta do meio dobrando para `pole`.
 * Se o alvo estiver fora de alcance, `outEnd` recebe o ponto alcançável mais próximo.
 */
export function solveTwoBoneIK(
  root: Vector3,
  target: Vector3,
  lenA: number,
  lenB: number,
  pole: Vector3,
  outMid: Vector3,
  outEnd: Vector3,
): void {
  ikDir.subVectors(target, root);
  let d = ikDir.length();
  if (d < EPSILON) ikDir.set(0, -1, 0);
  else ikDir.divideScalar(d);
  d = MathUtils.clamp(d, Math.abs(lenA - lenB) + EPSILON, (lenA + lenB) * IK_MAX_REACH);

  outEnd.copy(root).addScaledVector(ikDir, d);

  const along = (d * d + lenA * lenA - lenB * lenB) / (2 * d);
  const h = Math.sqrt(Math.max(0, lenA * lenA - along * along));

  // componente do pole perpendicular ao osso
  ikBend.copy(pole).addScaledVector(ikDir, -pole.dot(ikDir));
  if (ikBend.lengthSq() < EPSILON) ikBend.set(-1, 0, 0);
  ikBend.normalize();

  outMid.copy(root).addScaledVector(ikDir, along).addScaledVector(ikBend, h);
}

const euler = new Euler();
const tmp = new Vector3();
const dir = new Vector3();
const poleF = new Vector3();
const poleB = new Vector3();

/** Osso a partir de uma direção da pose: out = from + normalize(d)·len. */
function boneFrom(out: Vector3, from: Vector3, d: Vector3, len: number): void {
  if (d.lengthSq() < EPSILON) d.set(0, -1, 0);
  out.copy(from).addScaledVector(d.normalize(), len);
}

const reach = new Vector3();
const defaultElbowPole = new Vector3(1, 0, 0);

function reachHand(
  shoulder: Vector3,
  elbow: Vector3,
  hand: Vector3,
  target: Vector3 | undefined,
  weight: number | undefined,
  pole: Vector3 | undefined,
  cfg: RigConfig,
): void {
  if (!target || !weight || weight <= 0) return;
  reach.lerpVectors(hand, target, Math.min(1, weight));
  solveTwoBoneIK(shoulder, reach, cfg.upperArm, cfg.forearm, pole ?? defaultElbowPole, elbow, hand);
}

/** Calcula todas as juntas do rig para a pose e os tornozelos dados. */
export function computeJoints(input: RigInput, cfg: RigConfig, out: RigJoints): RigJoints {
  const p = input.pose;

  out.hip.set(p.hipX, p.hipY, 0);
  out.torso.setFromEuler(euler.set(0, p.twist, p.lean, 'YXZ'));

  // pernas
  out.hipF.copy(out.hip).setZ(cfg.hipHalf);
  out.hipB.copy(out.hip).setZ(-cfg.hipHalf);
  if (input.poleF) poleF.copy(input.poleF);
  else poleF.set(cfg.kneePoleX, 0, cfg.kneePoleZ);
  if (input.poleB) poleB.copy(input.poleB);
  else poleB.set(cfg.kneePoleX, 0, -cfg.kneePoleZ);
  solveTwoBoneIK(out.hipF, input.ankleF, cfg.thigh, cfg.shin, poleF, out.kneeF, out.ankleF);
  solveTwoBoneIK(out.hipB, input.ankleB, cfg.thigh, cfg.shin, poleB, out.kneeB, out.ankleB);

  // coluna, pescoço e cabeça
  out.neckBase.copy(out.hip).add(tmp.set(0, cfg.spine, 0).applyQuaternion(out.torso));
  out.neckTop.copy(out.neckBase).add(tmp.set(0, cfg.neck, 0).applyQuaternion(out.torso));
  out.headRot.setFromEuler(euler.set(0, p.headYaw, p.headPitch, 'YXZ'));
  out.head.copy(out.neckTop).add(tmp.set(0, cfg.headOffset, 0).applyQuaternion(out.headRot));

  // ombros
  out.shoulderF.copy(out.neckBase).add(tmp.set(0, -cfg.shoulderDrop, cfg.shoulderHalf).applyQuaternion(out.torso));
  out.shoulderB.copy(out.neckBase).add(tmp.set(0, -cfg.shoulderDrop, -cfg.shoulderHalf).applyQuaternion(out.torso));

  // braços: direções da pose, mais fechadas em Z; na curva as mãos sobem e abrem
  const rise = cfg.curveHandRise * input.curveT;
  const spread = cfg.curveHandSpread * input.curveT;
  const s = cfg.armSpreadZ;

  boneFrom(out.elbowF, out.shoulderF, dir.set(p.elbowF[0], p.elbowF[1], p.elbowF[2] * s), cfg.upperArm);
  boneFrom(out.handF, out.elbowF, dir.set(p.handF[0], p.handF[1] + rise, p.handF[2] * s + spread), cfg.forearm);
  boneFrom(out.elbowB, out.shoulderB, dir.set(p.elbowB[0], p.elbowB[1], p.elbowB[2] * s), cfg.upperArm);
  boneFrom(out.handB, out.elbowB, dir.set(p.handB[0], p.handB[1] + rise, p.handB[2] * s - spread), cfg.forearm);

  // grab: a mão vai até o alvo por IK de 2 ossos (mesmo solver das pernas)
  reachHand(out.shoulderF, out.elbowF, out.handF, input.handTargetF, input.handWeightF, input.elbowPoleF, cfg);
  reachHand(out.shoulderB, out.elbowB, out.handB, input.handTargetB, input.handWeightB, input.elbowPoleB, cfg);

  return out;
}
