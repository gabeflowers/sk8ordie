import {
  BoxGeometry,
  Euler,
  CylinderGeometry,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { SimConfig, VisualConfig } from '../config';
import { EPSILON, wrapAngle } from '../sim/math';
import type { SkaterSim } from '../sim/SkaterSim';
import type { GrabId } from '../sim/tricks/gesture';
import { BoardBody } from './boardBody';
import { boneCapsule, merge, paint } from './geometry';
import { RAGDOLL_JOINTS, Ragdoll, type RagdollJoint, type RagdollPose } from './ragdoll';
import { computeJoints, createJoints, createPose, lerpPose, type RigJoints } from './rig';
import { Sparks } from './Sparks';

/** Envelope 0 → 1 → 0 ao longo de `duration`; 0 fora do intervalo. */
function pulse(t: number, duration: number): number {
  return t >= 0 && t < duration ? Math.sin((Math.PI * t) / duration) : 0;
}

function smoothstep(t: number): number {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

const UP = new Vector3(0, 1, 0);
const FRONT_GRABS = new Set<GrabId>(['melon', 'nosegrab', 'mute']);
const tmp = new Vector3();
const tmp2 = new Vector3();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpM = new Matrix4();
const tmpM2 = new Matrix4();
const ONE = new Vector3(1, 1, 1);

interface Bone {
  mesh: Mesh;
  restLength: number;
}

/** Pose completa do corpo no espaço do bodyPivot: juntas + orientação dos tênis. */
interface BodyFrame {
  joints: RigJoints;
  shoeF: Quaternion;
  shoeB: Quaternion;
}

const JOINT_VECTORS = [
  'hip', 'hipF', 'hipB', 'kneeF', 'kneeB', 'ankleF', 'ankleB', 'neckBase', 'neckTop', 'head',
  'shoulderF', 'shoulderB', 'elbowF', 'elbowB', 'handF', 'handB',
] as const;

/** Junta do ragdoll → junta do rig. */
const RAGDOLL_TO_RIG: Record<RagdollJoint, (typeof JOINT_VECTORS)[number]> = {
  hipF: 'hipF', hipB: 'hipB', kneeF: 'kneeF', kneeB: 'kneeB', ankleF: 'ankleF', ankleB: 'ankleB',
  shoulderF: 'shoulderF', shoulderB: 'shoulderB', neck: 'neckBase', head: 'head',
  elbowF: 'elbowF', elbowB: 'elbowB', handF: 'handF', handB: 'handB',
};

function createFrame(): BodyFrame {
  return { joints: createJoints(), shoeF: new Quaternion(), shoeB: new Quaternion() };
}

function lerpFrame(out: BodyFrame, a: BodyFrame, b: BodyFrame, t: number): void {
  for (const k of JOINT_VECTORS) out.joints[k].lerpVectors(a.joints[k], b.joints[k], t);
  out.joints.torso.slerpQuaternions(a.joints.torso, b.joints.torso, t);
  out.joints.headRot.slerpQuaternions(a.joints.headRot, b.joints.headRot, t);
  out.shoeF.slerpQuaternions(a.shoeF, b.shoeF, t);
  out.shoeB.slerpQuaternions(a.shoeB, b.shoeB, t);
}

const basisX = new Vector3();
const basisY = new Vector3();
const basisZ = new Vector3();

/** Orientação com +Y em `up` e +Z o mais perto possível de `side` (como no rig: −X = peito). */
function basisQuat(up: Vector3, side: Vector3, out: Quaternion): Quaternion {
  basisY.copy(up);
  if (basisY.lengthSq() < EPSILON) basisY.set(0, 1, 0);
  basisY.normalize();
  basisZ.copy(side).addScaledVector(basisY, -side.dot(basisY));
  if (basisZ.lengthSq() < EPSILON) basisZ.set(0, 0, 1);
  basisZ.normalize();
  basisX.crossVectors(basisY, basisZ);
  return out.setFromRotationMatrix(tmpM.makeBasis(basisX, basisY, basisZ));
}

type Mode = 'attached' | 'bailing' | 'returning';

/**
 * Skater no estilo Vector: proporção humana, sem rosto, membros em cápsula guiados por um rig
 * (IK nas pernas, poses-chave misturadas). No tombo o corpo vira ragdoll e o shape solta do pé;
 * ao levantar, os dois voltam suavemente. Hierarquia:
 * root (posição, yaw) → boardLean → popPivot (tail) → deck (+ marcadores dos pés)
 *                     → bodyPivot (pés: lean) → ossos
 */
export class SkaterView {
  readonly root = new Group();
  /** Posição/yaw interpolados do último update (a câmera usa os mesmos). */
  readonly renderPosition = new Vector3();
  renderYaw = 0;
  /** Faíscas do grind, em espaço de mundo (o Game adiciona `sparks.mesh` à cena). */
  readonly sparks: Sparks;

  private readonly boardLean = new Group();
  private readonly popPivot = new Group();
  private readonly deck = new Group();
  private readonly bodyPivot = new Group();
  private readonly footMarkerF = new Object3D();
  private readonly footMarkerB = new Object3D();

  private readonly torso: Mesh;
  private readonly head: Mesh;
  private readonly neck: Bone;
  private readonly upperArmF: Bone;
  private readonly upperArmB: Bone;
  private readonly forearmF: Bone;
  private readonly forearmB: Bone;
  private readonly thighF: Bone;
  private readonly thighB: Bone;
  private readonly shinF: Bone;
  private readonly shinB: Bone;
  private readonly shoeF: Mesh;
  private readonly shoeB: Mesh;

  private readonly pose = createPose();
  private readonly anim = createFrame();
  private readonly out = createFrame();
  private readonly snapshot = createFrame();
  private readonly baseAnkleF = new Vector3();
  private readonly baseAnkleB = new Vector3();
  private readonly ankleF = new Vector3();
  private readonly ankleB = new Vector3();
  private readonly pivotQuatInv = new Quaternion();
  private readonly frontToe = new Quaternion();

  // tombo
  private mode: Mode = 'attached';
  private readonly ragdoll: Ragdoll;
  private readonly board: BoardBody;
  private readonly ragdollPose: RagdollPose;
  private readonly boardFromPos = new Vector3();
  private readonly boardFromQuat = new Quaternion();
  private readonly returnTarget = new Vector3();
  private readonly returnTargetQuat = new Quaternion();
  private readonly returnPos = new Vector3();
  private readonly returnQuat = new Quaternion();
  private readonly deckAttached = new Vector3();
  private returnTime = 0;
  private returnDuration = 0;
  private returnArc = 0;

  // flips e agachamento antes do pop
  private flipEnv = 0;
  private crouchAmount = 0;
  private readonly flipQuat = new Quaternion();
  private readonly flipCenter = new Vector3();
  private readonly flipAxisY = new Quaternion();

  // grabs, manual, powerslide
  private grabEnv = 0;
  private lastGrab: GrabId | null = null;
  private readonly grabPoints = new Map<GrabId, Object3D>();
  private readonly grabTarget = new Vector3();
  private readonly elbowPoleF = new Vector3();
  private readonly elbowPoleB = new Vector3();
  private manualTilt = 0;
  private slideYaw = 0;
  private slopePitch = 0;
  /** pose atual do shape no grind (amortecida entre as variações) */
  private readonly grindPose = { pitch: 0, roll: 0, yaw: 0, shift: 0, pivotZ: 0 };
  private readonly grindEuler = new Euler(0, 0, 0, 'YXZ');

  private readonly sparkDir = new Vector3();
  /** Quanto o shape desce no grind para os trucks (50-50) ou o meio do shape (boardslide) tocarem o trilho. */
  private readonly drop5050: number;
  private readonly dropBoardslide: number;

  /** Saltos de yaw da sim (snap/saída do grind) viram um offset que decai até 0. */
  private yawOffset = 0;
  private lastRenderYaw = 0;

  private frameDt = 0;
  private lean = 0;
  private airWeight = 0;
  private grindWeight = 0;
  private grindDrop = 0;
  private popTime = Infinity;
  private crouchTime = Infinity;
  private seenOllies = 0;
  private seenLandings = 0;
  private seenGrinds = 0;
  private seenBails = 0;

  // remada
  private pushActive = false;
  private pushTime = 0;
  private pushCooldown = 0;
  private pushEnv = 0;
  private pushFootWeight = 0;
  private pushPlanted = false;
  private pushReleased = false;
  private pushReleaseU = 1;
  private readonly pushFoot = new Vector3();
  private readonly plantWorld = new Vector3();
  private readonly pushReleaseFrom = new Vector3();
  private readonly pushFrontToe = new Quaternion();
  private readonly pushBackToe = new Quaternion();
  private readonly restPoleF = new Vector3();
  private readonly restPoleB = new Vector3();
  private readonly pushPoleF = new Vector3();
  private readonly pushPoleB = new Vector3();
  private readonly poleF = new Vector3();
  private readonly poleB = new Vector3();

  constructor(
    private readonly visual: VisualConfig,
    private readonly simCfg: SimConfig,
  ) {
    const rig = visual.rig;
    const o = visual.outfit;
    const b = visual.board;
    const w = visual.wheels;
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: o.roughness });
    const seg = o.radialSegments;

    this.buildBoard();

    const bone = (geometry: BufferGeometry, restLength: number): Bone => ({ mesh: this.addMesh(geometry, material), restLength });

    // tronco + mochila (o tronco é achatado na profundidade, eixo X)
    const torsoGeo = new CylinderGeometry(o.torsoShoulderRadius, o.torsoHipRadius, o.torsoHeight, seg)
      .translate(0, o.torsoHeight / 2 - o.torsoBelowHip, 0)
      .scale(o.torsoDepthScale, 1, 1);
    const backpackGeo = new BoxGeometry(o.backpackDepth, o.backpackHeight, o.backpackWidth).translate(
      o.backpackBack,
      rig.spine - o.backpackTopDrop - o.backpackHeight / 2,
      0,
    );
    this.torso = this.addMesh(merge([paint(torsoGeo, o.hoodie), paint(backpackGeo, o.backpack)]), material);

    this.neck = bone(paint(boneCapsule(o.neckRadius, rig.neck, seg), o.hoodie), rig.neck);

    // capuz levantado no lugar da cabeça, com a abertura escura virada para o rosto (−X)
    const hood = new SphereGeometry(o.hoodRadius, seg, seg)
      .scale(o.hoodScaleX, o.hoodScaleY, o.hoodScaleZ)
      .translate(o.hoodBack, 0, 0);
    const opening = new SphereGeometry(1, seg, seg)
      .scale(o.openingRadiusX, o.openingRadiusY, o.openingRadiusZ)
      .translate(o.openingX, o.openingY, 0);
    this.head = this.addMesh(merge([paint(hood, o.hoodie), paint(opening, o.hoodInside)]), material);

    const upperArm = (): BufferGeometry => paint(boneCapsule(o.upperArmRadius, rig.upperArm, seg), o.hoodie);
    const forearm = (): BufferGeometry =>
      merge([
        paint(boneCapsule(o.forearmRadius, rig.forearm, seg), o.hoodie),
        paint(new SphereGeometry(o.handRadius, seg, seg).translate(0, rig.forearm, 0), o.skin),
      ]);
    this.upperArmF = bone(upperArm(), rig.upperArm);
    this.upperArmB = bone(upperArm(), rig.upperArm);
    this.forearmF = bone(forearm(), rig.forearm);
    this.forearmB = bone(forearm(), rig.forearm);

    const thigh = (): BufferGeometry => paint(boneCapsule(o.thighRadius, rig.thigh, seg), o.pants);
    const shin = (): BufferGeometry => paint(boneCapsule(o.shinRadius, rig.shin, seg), o.pants);
    this.thighF = bone(thigh(), rig.thigh);
    this.thighB = bone(thigh(), rig.thigh);
    this.shinF = bone(shin(), rig.shin);
    this.shinB = bone(shin(), rig.shin);

    // tênis de cano alto: origem no tornozelo, bico para −X, sola no topo do shape
    const shoe = (): BufferGeometry =>
      merge([
        paint(
          new BoxGeometry(o.shoeLength, o.shoeHeight, o.shoeWidth).translate(
            -o.shoeToeOffset,
            -rig.ankleHeight + o.soleHeight + o.shoeHeight / 2,
            0,
          ),
          o.shoe,
        ),
        paint(
          new BoxGeometry(o.soleLength, o.soleHeight, o.soleWidth).translate(-o.shoeToeOffset, -rig.ankleHeight + o.soleHeight / 2, 0),
          o.sole,
        ),
      ]);
    this.shoeF = this.addMesh(shoe(), material);
    this.shoeB = this.addMesh(shoe(), material);

    this.baseAnkleF.set(rig.ankleX, rig.ankleHeight, rig.stanceHalf);
    this.baseAnkleB.set(rig.ankleX, rig.ankleHeight, -rig.stanceHalf);
    this.frontToe.setFromAxisAngle(UP, rig.frontToeYaw);
    this.elbowPoleF.fromArray(visual.tricks.grabElbowPoleF);
    this.elbowPoleB.fromArray(visual.tricks.grabElbowPoleB);
    const push = visual.push;
    this.pushFrontToe.setFromAxisAngle(UP, push.frontToeYaw);
    this.pushBackToe.setFromAxisAngle(UP, push.backToeYaw);
    this.restPoleF.set(rig.kneePoleX, 0, rig.kneePoleZ);
    this.restPoleB.set(rig.kneePoleX, 0, -rig.kneePoleZ);
    this.pushPoleF.fromArray(push.kneePoleF);
    this.pushPoleB.fromArray(push.kneePoleB);

    // pivô do corpo no topo do shape: o lean gira em torno dos pés
    const deckTop = 2 * w.radius + b.truckHeight + b.thickness;
    this.bodyPivot.position.y = deckTop;
    this.root.add(this.boardLean, this.bodyPivot);
    // yaw primeiro, depois a inclinação da rampa no eixo do próprio shape
    this.root.rotation.order = 'YXZ';

    this.drop5050 = 2 * w.radius;
    this.dropBoardslide = 2 * w.radius + b.truckHeight;
    this.sparks = new Sparks(visual.sparks, visual.palette.accent);

    this.ragdoll = new Ragdoll(visual.bail);
    this.ragdollPose = Object.fromEntries(RAGDOLL_JOINTS.map((j) => [j, new Vector3()])) as RagdollPose;
    const halfZ = b.plankLength / 2 + b.kickLength * Math.cos(b.kickAngle);
    this.board = new BoardBody(visual.bail, b.width / 2, deckTop / 2, halfZ);
    this.deckAttached.set(0, 0, b.tailPivot);
  }

  /** Limpa animações (ex.: depois do reset da sim). */
  reset(sim: SkaterSim): void {
    this.seenOllies = sim.ollieCount;
    this.seenLandings = sim.landCount;
    this.seenGrinds = sim.grindCount;
    this.seenBails = sim.bailCount;
    this.popTime = Infinity;
    this.crouchTime = Infinity;
    this.lean = 0;
    this.airWeight = 0;
    this.grindWeight = 0;
    this.grindDrop = 0;
    this.yawOffset = 0;
    this.lastRenderYaw = sim.yaw;
    this.mode = 'attached';
    this.attachBoard();
    this.pushActive = false;
    this.pushCooldown = 0;
    this.pushEnv = 0;
    this.pushFootWeight = 0;
    this.flipEnv = 0;
    this.crouchAmount = 0;
    this.grabEnv = 0;
    this.lastGrab = null;
    this.manualTilt = 0;
    this.slideYaw = 0;
    this.slopePitch = 0;
    this.sparks.clear();
  }

  update(sim: SkaterSim, alpha: number, dt: number): void {
    this.frameDt = dt;
    const j = this.visual.juice;
    const rig = this.visual.rig;

    this.renderPosition.lerpVectors(sim.prevPosition, sim.position, alpha);
    this.renderYaw = MathUtils.lerp(sim.prevYaw, sim.yaw, alpha);

    // giro mais rápido que qualquer input (snap/saída do grind) não estala: vira offset amortecido
    const yawStep = wrapAngle(this.renderYaw - this.lastRenderYaw);
    this.lastRenderYaw = this.renderYaw;
    const maxLegitStep = Math.max(this.simCfg.airSpinRate, this.simCfg.turnRateSlow) * dt * j.yawSnapMargin;
    if (Math.abs(yawStep) > maxLegitStep) this.yawOffset -= yawStep;
    this.yawOffset = MathUtils.damp(this.yawOffset, 0, j.yawSnapDamping, dt);

    // no grind o pé da sim está no topo do trilho; o shape desce até encostar nele
    const grinding = sim.state === 'GRINDING';
    const targetDrop = !grinding ? 0 : sim.grindType === 'boardslide' ? this.dropBoardslide : this.drop5050;
    this.grindDrop = MathUtils.damp(this.grindDrop, targetDrop, rig.grindDamping, dt);
    this.root.position.copy(this.renderPosition);
    this.root.position.y -= this.grindDrop;
    // powerslide: skater e shape ficam de lado enquanto escorregam
    const vt0 = this.visual.tricks;
    this.slideYaw = MathUtils.damp(
      this.slideYaw,
      sim.powerslide ? (sim.powerslide.dir * Math.PI) / 2 : 0,
      vt0.powerslideDamping,
      dt,
    );
    this.root.rotation.y = this.renderYaw + this.yawOffset + this.slideYaw;

    // rampa / corrimão de escada: o skater inclina junto com o chão, no sentido do shape;
    // no ar, mantém a orientação com que saiu da rampa
    this.slopePitch = MathUtils.damp(this.slopePitch, this.targetPitch(sim), vt0.slopePitchDamping, dt);
    this.root.rotation.x = -this.slopePitch;

    if (sim.ollieCount !== this.seenOllies) {
      this.seenOllies = sim.ollieCount;
      this.popTime = 0;
    }
    // aterrissar e encaixar no trilho dão o mesmo agachamento de impacto
    if (sim.landCount !== this.seenLandings || sim.grindCount !== this.seenGrinds) {
      this.seenLandings = sim.landCount;
      this.seenGrinds = sim.grindCount;
      this.crouchTime = 0;
    }
    this.popTime += dt;
    this.crouchTime += dt;

    // inclina para dentro da curva, proporcional a input × velocidade; de fakie o lado
    // de dentro da curva fica do outro lado do shape
    const speedT = MathUtils.clamp(sim.speed / this.simCfg.maxSpeed, 0, 1);
    const side = sim.fakie ? -1 : 1;
    const targetLean = sim.state === 'GROUNDED' ? -sim.turnInput * side * speedT * j.leanMax : 0;
    this.lean = MathUtils.damp(this.lean, targetLean, j.leanDamping, dt);

    this.bodyPivot.rotation.z = this.lean;
    this.boardLean.rotation.z = this.lean * j.boardLeanFactor;
    // rotação negativa em X levanta o nariz (+Z)
    this.popPivot.rotation.x = -j.popAngle * pulse(this.popTime, j.popDuration);
    if (this.mode === 'attached') this.applyFlip(sim);
    this.root.updateMatrixWorld(true);
    this.bodyPivot.getWorldQuaternion(this.pivotQuatInv).invert();

    if (sim.bailCount !== this.seenBails) {
      this.seenBails = sim.bailCount;
      this.startBail(sim);
    }

    this.animate(sim, dt, grinding);

    switch (this.mode) {
      case 'attached':
        lerpFrame(this.out, this.anim, this.anim, 0);
        break;
      case 'bailing':
        this.ragdoll.step(dt, sim.world, this.renderPosition);
        this.board.step(dt, sim.world);
        this.ragdollFrame(this.out);
        this.placeBoardBody();
        if (sim.state !== 'BAILED') this.beginReturn();
        break;
      case 'returning':
        this.stepReturn(dt);
        break;
    }
    this.applyFrame(this.out);

    // faíscas no ponto de contato com o trilho, voando para trás
    this.sparkDir.copy(sim.grindDir).negate();
    this.sparks.update(dt, grinding, this.renderPosition, this.sparkDir);
  }

  /** Pose animada (poses-chave + pés no shape) em `this.anim`. */
  private animate(sim: SkaterSim, dt: number, grinding: boolean): void {
    const j = this.visual.juice;
    const rig = this.visual.rig;

    // pés presos ao shape (seguem o nose pop e o lean); sem o shape no pé, ficam na base
    // no flip os pés soltam do shape (que está girando) e sobem um pouco
    const footLock = this.mode === 'attached' ? 1 - this.flipEnv : 0;
    this.footTarget(this.footMarkerF, this.baseAnkleF, footLock, this.ankleF);
    this.footTarget(this.footMarkerB, this.baseAnkleB, footLock, this.ankleB);
    const lift = this.visual.tricks.footLift * this.flipEnv;
    this.ankleF.y += lift;
    this.ankleB.y += lift;

    // remada: atualiza o ciclo antes das poses (ele parte do pé de trás no shape)
    this.updatePush(sim, dt);

    // mistura das poses-chave: base → ar → grind → remada → aterrissagem
    this.airWeight = MathUtils.damp(this.airWeight, sim.state === 'AIRBORNE' ? 1 : 0, rig.airDamping, dt);
    this.grindWeight = MathUtils.damp(this.grindWeight, grinding ? 1 : 0, rig.grindDamping, dt);
    const poses = rig.poses;
    lerpPose(this.pose, poses.base, poses.air, this.airWeight);
    lerpPose(this.pose, this.pose, poses.grind, this.grindWeight);
    lerpPose(this.pose, this.pose, poses.push, this.pushEnv);
    lerpPose(this.pose, this.pose, poses.grab, this.grabEnv);
    // agachar segurando o pop usa a mesma pose da aterrissagem
    const vt = this.visual.tricks;
    this.crouchAmount = MathUtils.damp(this.crouchAmount, sim.crouching ? 1 : 0, vt.crouchDamping, dt);
    const crouch = Math.max(pulse(this.crouchTime, j.landCrouchDuration), this.crouchAmount * vt.crouchWeight);
    lerpPose(this.pose, this.pose, poses.landing, crouch);

    // o pé que rema sai do shape; de frente para o nose, os joelhos dobram para a frente
    this.ankleB.lerp(this.pushFoot, this.pushFootWeight);
    this.poleF.lerpVectors(this.restPoleF, this.pushPoleF, this.pushEnv);
    this.poleB.lerpVectors(this.restPoleB, this.pushPoleB, this.pushEnv);

    const curveT = MathUtils.clamp(Math.abs(this.lean) / j.leanMax, 0, 1);
    // grab: a mão certa vai até o ponto do shape
    const grabHand = this.grabHandTarget();
    computeJoints(
      {
        pose: this.pose,
        ankleF: this.ankleF,
        ankleB: this.ankleB,
        curveT,
        poleF: this.poleF,
        poleB: this.poleB,
        handTargetF: grabHand === 'front' ? this.grabTarget : undefined,
        handTargetB: grabHand === 'back' ? this.grabTarget : undefined,
        handWeightF: grabHand === 'front' ? this.grabEnv : 0,
        handWeightB: grabHand === 'back' ? this.grabEnv : 0,
        elbowPoleF: this.elbowPoleF,
        elbowPoleB: this.elbowPoleB,
      },
      rig,
      this.anim.joints,
    );
    // pé da frente gira para o nose na remada; o de trás aponta para a frente quando está no chão
    tmpQ2.slerpQuaternions(this.frontToe, this.pushFrontToe, this.pushEnv);
    this.shoeOrientation(this.footMarkerF, footLock, this.anim.shoeF).multiply(tmpQ2);
    this.shoeOrientation(this.footMarkerB, footLock, this.anim.shoeB).slerp(this.pushBackToe, this.pushFootWeight);
  }

  // ------------------------------------------------------------------- flips

  /**
   * Gira o shape conforme o flip da sim: voltas no eixo longo (flip) e meias-voltas em Y (shove),
   * em torno do centro do shape, subindo um pouco. Sem flip, o shape fica preso no pé.
   */
  private applyFlip(sim: SkaterSim): void {
    const vt = this.visual.tricks;
    const trick = sim.trick;
    this.updateGrabAndManual(sim);
    if (!trick) {
      this.flipEnv = 0;
      this.attachBoard();
      this.applyGrindPose(sim);
      this.applyManualAndGrab();
      return;
    }
    const def = sim.cfg.tricks.catalog[trick.id];
    const e = smoothstep(sim.trickProgress);
    this.flipEnv = Math.min(1, e / vt.envIn) * Math.min(1, (1 - e) / vt.envOut);

    this.flipAxisY.setFromAxisAngle(UP, def.shove * Math.PI * e);
    this.flipQuat.setFromAxisAngle(tmp2.set(0, 0, 1), def.flip * 2 * Math.PI * e).premultiply(this.flipAxisY);
    // gira em torno do centro do shape (a origem do deck fica no chão)
    this.flipCenter.set(0, this.board.halfY, 0);
    this.deck.position
      .copy(this.deckAttached)
      .add(this.flipCenter)
      .sub(tmp.copy(this.flipCenter).applyQuaternion(this.flipQuat));
    this.deck.position.y += vt.boardLift * this.flipEnv;
    this.deck.quaternion.copy(this.flipQuat);
  }

  // ------------------------------------------------------- grabs e manual

  private updateGrabAndManual(sim: SkaterSim): void {
    const vt = this.visual.tricks;
    const dt = this.frameDt;
    if (sim.grab) this.lastGrab = sim.grab.id;
    this.grabEnv = MathUtils.damp(this.grabEnv, sim.grab ? 1 : 0, vt.grabDamping, dt);

    const m = sim.manual;
    const target = m ? (m.nose ? 1 : -1) * vt.manualAngle * (1 + vt.manualWobble * Math.abs(m.balance)) : 0;
    this.manualTilt = MathUtils.damp(this.manualTilt, target, vt.manualDamping, dt);
  }

  /**
   * Manual: o shape empina sobre o eixo das rodas de trás (manual) ou da frente (nose manual).
   * Grab: o shape sobe em direção às mãos.
   */
  private applyManualAndGrab(): void {
    const vt = this.visual.tricks;
    if (Math.abs(this.manualTilt) > EPSILON) {
      const pivotZ = (this.manualTilt < 0 ? -1 : 1) * this.visual.wheels.axleOffset;
      this.flipQuat.setFromAxisAngle(tmp2.set(1, 0, 0), this.manualTilt);
      this.flipCenter.set(0, 0, pivotZ);
      this.deck.position
        .copy(this.deckAttached)
        .add(this.flipCenter)
        .sub(tmp.copy(this.flipCenter).applyQuaternion(this.flipQuat));
      this.deck.quaternion.copy(this.flipQuat);
    }
    this.deck.position.y += vt.grabBoardLift * this.grabEnv;
  }

  /** Pose do shape em cada variação de grind: inclina/rola/gira em torno do truck de apoio. */
  private applyGrindPose(sim: SkaterSim): void {
    const vt = this.visual.tricks;
    const gp = this.grindPose;
    const dt = this.frameDt;
    const target = sim.state === 'GRINDING' && sim.grindVariant ? vt.grindPoses[sim.grindVariant] : undefined;
    const k = vt.grindPoseDamping;
    gp.pitch = MathUtils.damp(gp.pitch, target?.pitch ?? 0, k, dt);
    gp.roll = MathUtils.damp(gp.roll, target?.roll ?? 0, k, dt);
    gp.yaw = MathUtils.damp(gp.yaw, target?.yaw ?? 0, k, dt);
    gp.shift = MathUtils.damp(gp.shift, target?.shift ?? 0, k, dt);
    if (target) {
      const axle = this.visual.wheels.axleOffset;
      gp.pivotZ = MathUtils.damp(gp.pivotZ, target.pivot === 'rear' ? -axle : target.pivot === 'front' ? axle : 0, k, dt);
    }
    if (Math.abs(gp.pitch) + Math.abs(gp.roll) + Math.abs(gp.yaw) + Math.abs(gp.shift) < EPSILON) return;

    this.flipQuat.setFromEuler(this.grindEuler.set(gp.pitch, gp.yaw, gp.roll, 'YXZ'));
    this.flipCenter.set(0, 0, gp.pivotZ);
    this.deck.position
      .copy(this.deckAttached)
      .add(this.flipCenter)
      .sub(tmp.copy(this.flipCenter).applyQuaternion(this.flipQuat));
    this.deck.position.z += gp.shift;
    this.deck.quaternion.copy(this.flipQuat);
  }

  /** Ponto do shape que a mão do grab alcança (espaço do bodyPivot) e qual mão. */
  private grabHandTarget(): 'front' | 'back' | null {
    if (!this.lastGrab || this.grabEnv < EPSILON) return null;
    const point = this.grabPoints.get(this.lastGrab);
    if (!point) return null;
    point.getWorldPosition(this.grabTarget);
    this.bodyPivot.worldToLocal(this.grabTarget);
    return FRONT_GRABS.has(this.lastGrab) ? 'front' : 'back';
  }

  // ------------------------------------------------------------------- remada

  /**
   * Ciclo da remada. Ida: o pé de trás sai do shape num arco até o chão, do lado do peito.
   * Contato: fica cravado no asfalto (em espaço de mundo) enquanto o shape passa. Volta: arco
   * de volta para o tail. A pose de remada entra e sai junto com o ciclo.
   */
  private updatePush(sim: SkaterSim, dt: number): void {
    const p = this.visual.push;
    const canPush = this.mode === 'attached' && sim.state === 'GROUNDED' && !sim.fakie && !sim.manual && !sim.powerslide;
    this.pushCooldown = Math.max(0, this.pushCooldown - dt);

    if (!canPush) this.pushActive = false;
    if (canPush && !this.pushActive && sim.pushing && this.pushCooldown <= 0) {
      this.pushActive = true;
      this.pushTime = 0;
      this.pushPlanted = false;
      this.pushReleased = false;
      this.pushReleaseU = p.contactEnd;
    }

    let envTarget = 0;
    let footTarget = 0;
    if (this.pushActive) {
      this.pushTime += dt;
      const u = this.pushTime / p.cycleDuration;
      if (u >= 1) {
        this.pushActive = false;
        // perto da velocidade máxima, rema de vez em quando, só para manter o embalo
        this.pushCooldown = p.maxGap * MathUtils.clamp(sim.speed / this.simCfg.maxPushSpeed, 0, 1) ** 2;
      } else {
        envTarget = smoothstep(u / p.envelopeIn) * (1 - smoothstep((u - (1 - p.envelopeOut)) / p.envelopeOut));
        footTarget = 1;
        this.pushFootAt(u, sim);
      }
    }

    this.pushEnv = MathUtils.damp(this.pushEnv, envTarget, p.followDamping, dt);
    this.pushFootWeight = MathUtils.damp(this.pushFootWeight, footTarget, p.followDamping, dt);
  }

  /** Posição do pé que rema (espaço do bodyPivot) na fração `u` do ciclo. */
  private pushFootAt(u: number, sim: SkaterSim): void {
    const p = this.visual.push;

    if (u < p.reachEnd) {
      const s = u / p.reachEnd;
      this.plantPoint(sim, tmp2);
      this.pushFoot.lerpVectors(this.ankleB, tmp2, smoothstep(s));
      this.pushFoot.y += p.liftReach * Math.sin(Math.PI * s);
      return;
    }

    if (u < this.pushReleaseU) {
      if (!this.pushPlanted) {
        // crava o pé no chão: daqui até soltar ele não se mexe no mundo
        this.plantPoint(sim, tmp2);
        this.bodyPivot.localToWorld(this.plantWorld.copy(tmp2));
        this.pushPlanted = true;
      }
      this.bodyPivot.worldToLocal(this.pushFoot.copy(this.plantWorld));
      // ficou para trás demais: solta antes do fim do contato
      if (this.pushFoot.z < p.strokeMinZ) this.pushReleaseU = u;
      return;
    }

    if (!this.pushReleased) {
      this.pushReleaseFrom.copy(this.pushFoot);
      this.pushReleased = true;
    }
    const s = (u - this.pushReleaseU) / (1 - this.pushReleaseU);
    this.pushFoot.lerpVectors(this.pushReleaseFrom, this.ankleB, smoothstep(s));
    this.pushFoot.y += p.liftRecover * Math.sin(Math.PI * s);
  }

  /** Onde o pé pisa: ao lado do shape, na altura do chão de verdade (pode ser o topo de uma caixa). */
  private plantPoint(sim: SkaterSim, out: Vector3): Vector3 {
    const p = this.visual.push;
    const rig = this.visual.rig;
    this.bodyPivot.localToWorld(out.set(p.plantX, 0, p.plantZ));
    const ground = sim.world.groundHeightAt(out.x, out.z, this.root.position.y + p.groundTolerance);
    out.y = ground + rig.ankleHeight;
    return this.bodyPivot.worldToLocal(out);
  }

  // ------------------------------------------------------------------- tombo

  /** O corpo vira ragdoll a partir da pose na tela; o shape solta do pé com o momento do tombo. */
  private startBail(sim: SkaterSim): void {
    const c = this.visual.bail;
    const v = sim.bailVelocity;
    const impact = sim.bailNormal.lengthSq() > EPSILON;

    for (const joint of RAGDOLL_JOINTS) {
      this.bodyPivot.localToWorld(this.ragdollPose[joint].copy(this.out.joints[RAGDOLL_TO_RIG[joint]]));
    }
    this.ragdoll.start(
      this.ragdollPose,
      v,
      impact ? c.feetVelocityImpact : c.feetVelocityLanding,
      impact ? c.kneeVelocityImpact : 1,
    );

    // shape: bate na parede e quica de volta, ou segue o momento do tombo; sempre com um pop e giro
    const boardVel = tmp.copy(v);
    if (impact) {
      const n = sim.bailNormal;
      const vn = boardVel.dot(n);
      boardVel.addScaledVector(n, -vn * (1 + c.boardWallRestitution));
    } else {
      boardVel.multiplyScalar(c.boardKick);
      tmp2.set(-v.z, 0, v.x);
      if (tmp2.lengthSq() > EPSILON) boardVel.addScaledVector(tmp2.normalize(), (Math.random() * 2 - 1) * c.boardSideJitter);
    }
    boardVel.y = Math.max(boardVel.y, 0) + c.boardPop;

    this.deck.getWorldQuaternion(tmpQ);
    const spinAxis = tmp2.set(0, 0, 1).applyQuaternion(tmpQ);
    // gira em torno do eixo longo (flip) e um pouco em torno de Y; aleatório a cada tombo
    const angular = new Vector3()
      .addScaledVector(spinAxis, (Math.random() * 2 - 1) * c.boardSpin)
      .addScaledVector(UP, (Math.random() * 2 - 1) * c.boardSpin * c.boardYawSpinFactor);
    const center = this.deck.getWorldPosition(new Vector3()).add(new Vector3(0, this.board.halfY, 0).applyQuaternion(tmpQ));
    this.board.start(center, tmpQ, boardVel, angular);

    this.mode = 'bailing';
  }

  /** Juntas do ragdoll (mundo) → pose no espaço do bodyPivot. */
  private ragdollFrame(out: BodyFrame): void {
    const jt = out.joints;
    for (const joint of RAGDOLL_JOINTS) {
      this.bodyPivot.worldToLocal(jt[RAGDOLL_TO_RIG[joint]].copy(this.ragdoll.get(joint)));
    }
    jt.hip.addVectors(jt.hipF, jt.hipB).multiplyScalar(0.5);
    jt.neckTop
      .subVectors(jt.head, jt.neckBase)
      .setLength(this.visual.rig.neck)
      .add(jt.neckBase);

    const sideways = tmp2.subVectors(jt.shoulderF, jt.shoulderB);
    basisQuat(tmp.subVectors(jt.neckBase, jt.hip), sideways, jt.torso);
    basisQuat(tmp.subVectors(jt.head, jt.neckTop), sideways, jt.headRot);
    const hips = tmp2.subVectors(jt.hipF, jt.hipB);
    basisQuat(tmp.subVectors(jt.kneeF, jt.ankleF), hips, out.shoeF);
    basisQuat(tmp.subVectors(jt.kneeB, jt.ankleB), hips, out.shoeB);
  }

  /** Levantar: o corpo sai do ragdoll para a pose em pé e o shape volta para o pé num arco. */
  private beginReturn(): void {
    const c = this.visual.bail;
    this.mode = 'returning';
    this.returnTime = 0;
    lerpFrame(this.snapshot, this.out, this.out, 0);
    this.deck.getWorldPosition(this.boardFromPos);
    this.deck.getWorldQuaternion(this.boardFromQuat);
    const distance = this.boardFromPos.distanceTo(this.renderPosition);
    this.returnDuration = c.boardReturnDuration + distance * c.boardReturnPerMeter;
    this.returnArc = c.boardReturnArc + distance * c.boardReturnArcPerMeter;
  }

  private stepReturn(dt: number): void {
    const c = this.visual.bail;
    this.returnTime += dt;
    lerpFrame(this.out, this.snapshot, this.anim, smoothstep(this.returnTime / c.getupDuration));

    // alvo: o shape preso no pé (recalculado, porque o skater já pode estar andando)
    const e = smoothstep(this.returnTime / this.returnDuration);
    tmpM2.compose(this.deckAttached, this.returnQuat.identity(), ONE).premultiply(this.popPivot.matrixWorld);
    tmpM2.decompose(this.returnTarget, this.returnTargetQuat, tmp2);
    this.returnPos.lerpVectors(this.boardFromPos, this.returnTarget, e);
    this.returnPos.y += this.returnArc * Math.sin(Math.PI * e);
    this.returnQuat.slerpQuaternions(this.boardFromQuat, this.returnTargetQuat, e);
    this.setDeckWorld(this.returnPos, this.returnQuat);

    if (this.returnTime >= Math.max(c.getupDuration, this.returnDuration)) {
      this.mode = 'attached';
      this.attachBoard();
    }
  }

  private placeBoardBody(): void {
    const q = this.board.quaternion;
    const origin = tmp.set(0, -this.board.halfY, 0).applyQuaternion(q).add(this.board.center);
    this.setDeckWorld(origin, q);
  }

  /** Posiciona o shape (origem no chão, centro do shape) por uma transformação de mundo. */
  private setDeckWorld(position: Vector3, quaternion: Quaternion): void {
    tmpM.compose(position, quaternion, ONE).premultiply(tmpM2.copy(this.popPivot.matrixWorld).invert());
    tmpM.decompose(this.deck.position, this.deck.quaternion, this.deck.scale);
  }

  private attachBoard(): void {
    this.deck.position.copy(this.deckAttached);
    this.deck.quaternion.identity();
    this.deck.scale.copy(ONE);
  }

  // ------------------------------------------------------------------- pose

  private applyFrame(f: BodyFrame): void {
    const jt = f.joints;
    this.torso.position.copy(jt.hip);
    this.torso.quaternion.copy(jt.torso);
    this.head.position.copy(jt.head);
    this.head.quaternion.copy(jt.headRot);
    this.place(this.neck, jt.neckBase, jt.neckTop);
    this.place(this.upperArmF, jt.shoulderF, jt.elbowF);
    this.place(this.upperArmB, jt.shoulderB, jt.elbowB);
    this.place(this.forearmF, jt.elbowF, jt.handF);
    this.place(this.forearmB, jt.elbowB, jt.handB);
    this.place(this.thighF, jt.hipF, jt.kneeF);
    this.place(this.thighB, jt.hipB, jt.kneeB);
    this.place(this.shinF, jt.kneeF, jt.ankleF);
    this.place(this.shinB, jt.kneeB, jt.ankleB);
    this.shoeF.position.copy(jt.ankleF);
    this.shoeB.position.copy(jt.ankleB);
    this.shoeF.quaternion.copy(f.shoeF);
    this.shoeB.quaternion.copy(f.shoeB);
  }

  /** Tornozelo-alvo no espaço do bodyPivot: marcador do shape misturado com a pose base. */
  private footTarget(marker: Object3D, base: Vector3, lock: number, out: Vector3): void {
    marker.getWorldPosition(tmp);
    this.bodyPivot.worldToLocal(tmp);
    out.lerpVectors(base, tmp, lock);
  }

  /** O tênis copia a orientação do shape (no pop ele inclina junto). */
  private shoeOrientation(marker: Object3D, lock: number, out: Quaternion): Quaternion {
    marker.getWorldQuaternion(tmpQ);
    tmpQ.premultiply(this.pivotQuatInv);
    return out.identity().slerp(tmpQ, lock);
  }

  /** Posiciona um osso (cápsula de 0 a restLength em +Y) entre duas juntas. */
  private place(bone: Bone, a: Vector3, b: Vector3): void {
    bone.mesh.position.copy(a);
    tmp.subVectors(b, a);
    const len = tmp.length();
    if (len > EPSILON) bone.mesh.quaternion.setFromUnitVectors(UP, tmp.divideScalar(len));
    bone.mesh.scale.set(1, len / bone.restLength, 1);
  }

  private buildBoard(): void {
    const b = this.visual.board;
    const w = this.visual.wheels;
    const rig = this.visual.rig;
    const deckTop = 2 * w.radius + b.truckHeight + b.thickness;
    const deckY = deckTop - b.thickness / 2;

    // o pop gira em torno do tail, no nível do chão
    this.popPivot.position.set(0, 0, -b.tailPivot);
    this.deck.position.set(0, 0, b.tailPivot);

    const parts: BufferGeometry[] = [paint(new BoxGeometry(b.width, b.thickness, b.plankLength).translate(0, deckY, 0), b.deckColor)];
    for (const side of [-1, 1]) {
      // kicktail: gira em torno da ponta interna, subindo para fora
      const kick = new BoxGeometry(b.width, b.thickness, b.kickLength)
        .translate(0, 0, (side * b.kickLength) / 2)
        .rotateX(-side * b.kickAngle)
        .translate(0, deckY, (side * b.plankLength) / 2);
      parts.push(paint(kick, b.deckColor));
      const truck = new BoxGeometry(b.truckWidth, b.truckHeight, b.truckLength).translate(
        0,
        2 * w.radius + b.truckHeight / 2,
        side * w.axleOffset,
      );
      parts.push(paint(truck, b.truckColor));
    }
    const deckMesh = new Mesh(merge(parts), new MeshStandardMaterial({ vertexColors: true, roughness: this.visual.outfit.roughness }));
    deckMesh.castShadow = true;

    // rodas de LED: cor chapada, sem sombra própria
    const wheelParts: BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        wheelParts.push(
          new CylinderGeometry(w.radius, w.radius, w.width, w.segments)
            .rotateZ(Math.PI / 2)
            .translate(sx * w.trackHalf, w.radius, sz * w.axleOffset),
        );
      }
    }
    const wheels = new Mesh(merge(wheelParts), new MeshBasicMaterial({ color: w.color }));

    // marcadores dos tornozelos presos ao shape
    this.footMarkerF.position.set(rig.ankleX, deckTop + rig.ankleHeight, rig.stanceHalf);
    this.footMarkerB.position.set(rig.ankleX, deckTop + rig.ankleHeight, -rig.stanceHalf);

    this.deck.add(deckMesh, wheels, this.footMarkerF, this.footMarkerB);

    // pontos onde as mãos pegam o shape nos grabs
    const points = this.visual.tricks.grabPoints;
    for (const id of Object.keys(points) as GrabId[]) {
      const marker = new Object3D();
      marker.position.fromArray(points[id]);
      marker.position.y += deckTop;
      this.deck.add(marker);
      this.grabPoints.set(id, marker);
    }
    this.popPivot.add(this.deck);
    this.boardLean.add(this.popPivot);
  }

  private addMesh(geometry: BufferGeometry, material: Material): Mesh {
    const m = new Mesh(geometry, material);
    m.castShadow = true;
    this.bodyPivot.add(m);
    return m;
  }

  /**
   * Inclinação do corpo (rad, + = nose para cima). No chão segue a rampa. No air do quarter pipe
   * fica alinhado com a transição em que decolou (sobe e desce "de pé" na parede). Saindo de
   * kicker/bank acompanha a trajetória (nose sobe, depois desce), limitado ao ângulo do lip;
   * ollie no plano sai reto.
   */
  private targetPitch(sim: SkaterSim): number {
    const along = (): number => Math.cos(wrapAngle(Math.atan2(sim.velocity.x, sim.velocity.z) - sim.yaw));
    if (sim.state !== 'AIRBORNE') return sim.speed > EPSILON ? Math.atan(sim.groundSlope * along()) : 0;
    if (sim.vertAir) return sim.launchPitch;
    const limit = Math.abs(sim.launchPitch);
    if (limit < EPSILON) return 0;
    const h = Math.hypot(sim.velocity.x, sim.velocity.z);
    const path = h > EPSILON ? Math.atan2(sim.velocity.y, h) * Math.sign(along()) : 0;
    return MathUtils.clamp(path, -limit, limit);
  }

}
