import { Vector3 } from 'three';
import type { VisualConfig } from '../config';
import { EPSILON } from '../sim/math';
import type { Aabb } from '../sim/types';

// Ragdoll de partículas (integração de Verlet + restrições de distância), só para o visual do
// tombo. Puro: não conhece cena; trabalha em espaço de mundo.

type BailConfig = VisualConfig['bail'];

/** O que o ragdoll precisa do mundo: chão (topos das caixas) e as caixas para não atravessar. */
export interface RagdollWorld {
  readonly boxes: readonly Aabb[];
  groundHeightAt(x: number, z: number, maxTop: number): number;
}

export const RAGDOLL_JOINTS = [
  'hipF', 'hipB', 'kneeF', 'kneeB', 'ankleF', 'ankleB',
  'shoulderF', 'shoulderB', 'neck', 'head',
  'elbowF', 'elbowB', 'handF', 'handB',
] as const;
export type RagdollJoint = (typeof RAGDOLL_JOINTS)[number];
export type RagdollPose = Record<RagdollJoint, Vector3>;

interface Particle {
  pos: Vector3;
  prev: Vector3;
  radius: number;
  invMass: number;
}

interface Link {
  a: Particle;
  b: Particle;
  min: number;
  max: number;
}

const TORSO = new Set<RagdollJoint>(['hipF', 'hipB', 'shoulderF', 'shoulderB', 'neck']);

function radiusOf(j: RagdollJoint, c: BailConfig): number {
  if (j === 'head') return c.radiusHead;
  if (j === 'neck') return c.radiusNeck;
  if (j.startsWith('shoulder')) return c.radiusShoulder;
  if (j.startsWith('hip')) return c.radiusHip;
  if (j.startsWith('knee')) return c.radiusKnee;
  if (j.startsWith('ankle')) return c.radiusAnkle;
  if (j.startsWith('elbow')) return c.radiusElbow;
  return c.radiusHand;
}

export class Ragdoll {
  private readonly p: Record<RagdollJoint, Particle>;
  private readonly all: Particle[];
  private links: Link[] = [];
  private accumulator = 0;
  private readonly d = new Vector3();

  constructor(private readonly cfg: BailConfig) {
    const entries = RAGDOLL_JOINTS.map((j): [RagdollJoint, Particle] => [
      j,
      {
        pos: new Vector3(),
        prev: new Vector3(),
        radius: radiusOf(j, cfg),
        invMass: 1 / (TORSO.has(j) ? cfg.torsoMass : cfg.limbMass),
      },
    ]);
    this.p = Object.fromEntries(entries) as Record<RagdollJoint, Particle>;
    this.all = entries.map(([, particle]) => particle);
  }

  /** Posição atual da junta (mundo). */
  get(j: RagdollJoint): Vector3 {
    return this.p[j].pos;
  }

  /**
   * Começa na pose dada (mundo) com o momento `velocity`. Pés e joelhos podem começar mais
   * lentos (`feetScale`, `kneeScale`): travados no chão ou no obstáculo, fazem o corpo tombar.
   */
  start(pose: RagdollPose, velocity: Vector3, feetScale: number, kneeScale: number): void {
    const h = this.cfg.substep;
    for (const j of RAGDOLL_JOINTS) {
      const particle = this.p[j];
      const scale = j.startsWith('ankle') ? feetScale : j.startsWith('knee') ? kneeScale : 1;
      particle.pos.copy(pose[j]);
      particle.prev.copy(pose[j]).addScaledVector(velocity, -scale * h);
    }
    this.accumulator = 0;
    this.buildLinks();
  }

  /** Avança em subpassos fixos. `anchor`: posição da sim; o quadril não se afasta muito dela. */
  step(dt: number, world: RagdollWorld, anchor: Vector3): void {
    this.accumulator += dt;
    while (this.accumulator >= this.cfg.substep) {
      this.substep(world, anchor);
      this.accumulator -= this.cfg.substep;
    }
  }

  /** Energia cinética por unidade de massa (para saber se assentou). */
  kineticEnergy(): number {
    const h = this.cfg.substep;
    let e = 0;
    for (const particle of this.all) e += this.d.subVectors(particle.pos, particle.prev).lengthSq() / (h * h);
    return e / 2;
  }

  private buildLinks(): void {
    const c = this.cfg;
    const P = this.p;
    const dist = (a: RagdollJoint, b: RagdollJoint): number => P[a].pos.distanceTo(P[b].pos);
    const links: Link[] = [];
    const rigid = (a: RagdollJoint, b: RagdollJoint): void => {
      const l = dist(a, b);
      links.push({ a: P[a], b: P[b], min: l, max: l });
    };
    const range = (a: RagdollJoint, b: RagdollJoint, min: number, max: number): void => {
      links.push({ a: P[a], b: P[b], min, max });
    };

    // ossos
    rigid('hipF', 'kneeF');
    rigid('kneeF', 'ankleF');
    rigid('hipB', 'kneeB');
    rigid('kneeB', 'ankleB');
    rigid('shoulderF', 'elbowF');
    rigid('elbowF', 'handF');
    rigid('shoulderB', 'elbowB');
    rigid('elbowB', 'handB');
    rigid('neck', 'head');

    // tronco: caixa travada pelas diagonais, pescoço preso aos ombros e ao quadril
    rigid('hipF', 'hipB');
    rigid('shoulderF', 'shoulderB');
    rigid('hipF', 'shoulderF');
    rigid('hipB', 'shoulderB');
    rigid('hipF', 'shoulderB');
    rigid('hipB', 'shoulderF');
    rigid('shoulderF', 'neck');
    rigid('shoulderB', 'neck');
    rigid('hipF', 'neck');
    rigid('hipB', 'neck');

    // limites de articulação: a cabeça balança pouco; perna e braço não dobram ao meio
    for (const s of ['shoulderF', 'shoulderB'] as const) {
      const l = dist('head', s);
      range('head', s, l * c.headBendMin, l * c.headBendMax);
    }
    for (const [hip, knee, ankle] of [['hipF', 'kneeF', 'ankleF'], ['hipB', 'kneeB', 'ankleB']] as const) {
      const full = dist(hip, knee) + dist(knee, ankle);
      range(hip, ankle, full * c.legFoldMin, full);
    }
    for (const [shoulder, elbow, hand] of [['shoulderF', 'elbowF', 'handF'], ['shoulderB', 'elbowB', 'handB']] as const) {
      const full = dist(shoulder, elbow) + dist(elbow, hand);
      range(shoulder, hand, full * c.armFoldMin, full);
    }

    this.links = links;
  }

  private substep(world: RagdollWorld, anchor: Vector3): void {
    const c = this.cfg;
    const h = c.substep;
    const fall = c.gravity * h * h;

    for (const particle of this.all) {
      this.d.subVectors(particle.pos, particle.prev).multiplyScalar(c.airDrag);
      particle.prev.copy(particle.pos);
      particle.pos.add(this.d);
      particle.pos.y -= fall;
    }

    // mola suave: o quadril fica perto de onde a sim está deslizando
    const hipF = this.p.hipF.pos;
    const hipB = this.p.hipB.pos;
    const dx = anchor.x - (hipF.x + hipB.x) / 2;
    const dz = anchor.z - (hipF.z + hipB.z) / 2;
    const off = Math.hypot(dx, dz);
    if (off > c.anchorSlack) {
      const k = (c.anchorStiffness * h * (off - c.anchorSlack)) / off;
      for (const hip of [hipF, hipB]) {
        hip.x += dx * k;
        hip.z += dz * k;
      }
    }

    for (let i = 0; i < c.iterations; i++) {
      for (const link of this.links) this.satisfy(link);
      for (const particle of this.all) this.collide(particle, world);
    }
  }

  private satisfy(link: Link): void {
    const { a, b } = link;
    this.d.subVectors(b.pos, a.pos);
    const len = this.d.length();
    if (len < EPSILON) return;
    const target = Math.min(Math.max(len, link.min), link.max);
    if (target === len) return;
    const k = (len - target) / (len * (a.invMass + b.invMass));
    a.pos.addScaledVector(this.d, k * a.invMass);
    b.pos.addScaledVector(this.d, -k * b.invMass);
  }

  private collide(particle: Particle, world: RagdollWorld): void {
    const pos = particle.pos;
    const r = particle.radius;

    // dentro de uma caixa: sai pelo lado mais raso (inclusive por cima)
    for (const box of world.boxes) {
      if (pos.y - r >= box.top) continue;
      if (pos.x <= box.minX - r || pos.x >= box.maxX + r || pos.z <= box.minZ - r || pos.z >= box.maxZ + r) continue;
      const pushes = [
        { d: pos.x - (box.minX - r), x: -1, y: 0, z: 0 },
        { d: box.maxX + r - pos.x, x: 1, y: 0, z: 0 },
        { d: pos.z - (box.minZ - r), x: 0, y: 0, z: -1 },
        { d: box.maxZ + r - pos.z, x: 0, y: 0, z: 1 },
        { d: box.top + r - pos.y, x: 0, y: 1, z: 0 },
      ];
      let best = pushes[0];
      for (const push of pushes) if (best && push.d < best.d) best = push;
      if (!best) continue;
      pos.x += best.x * best.d;
      pos.y += best.y * best.d;
      pos.z += best.z * best.d;
      if (best.y > 0) this.rub(particle);
    }

    // chão (topos de caixa abaixo do centro da partícula contam)
    const floor = world.groundHeightAt(pos.x, pos.z, pos.y) + r;
    if (pos.y < floor) {
      pos.y = floor;
      this.rub(particle);
    }
  }

  /** Contato: perde parte do deslizamento horizontal e todo o quique. */
  private rub(particle: Particle): void {
    const f = this.cfg.groundFriction;
    particle.prev.x += (particle.pos.x - particle.prev.x) * f;
    particle.prev.z += (particle.pos.z - particle.prev.z) * f;
    particle.prev.y = particle.pos.y;
  }
}
