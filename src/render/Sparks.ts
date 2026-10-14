import {
  AdditiveBlending,
  BoxGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { VisualConfig } from '../config';

type SparksConfig = VisualConfig['sparks'];

interface Spark {
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
}

/** Faíscas do grind: cubinhos aditivos na cor de acento, 1 draw call (InstancedMesh). */
export class Sparks {
  readonly mesh: InstancedMesh;
  private readonly pool: Spark[] = [];
  private next = 0;
  private spawnDebt = 0;
  private readonly dummy = new Object3D();
  private readonly jitter = new Vector3();

  constructor(
    private readonly cfg: SparksConfig,
    accent: number,
  ) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(cfg.size, cfg.size, cfg.size),
      new MeshBasicMaterial({ color: accent, blending: AdditiveBlending, transparent: true, depthWrite: false }),
      cfg.count,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < cfg.count; i++) {
      this.pool.push({ position: new Vector3(), velocity: new Vector3(), age: Infinity, life: 1 });
    }
  }

  /**
   * Avança as faíscas. Enquanto `emitting`, nasce `rate` faíscas/s em `origin`,
   * lançadas para trás (`backward`, unitário) com espalhamento e um pouco para cima.
   */
  update(dt: number, emitting: boolean, origin: Vector3, backward: Vector3): void {
    const c = this.cfg;
    if (emitting) {
      this.spawnDebt += c.rate * dt;
      while (this.spawnDebt >= 1) {
        this.spawnDebt -= 1;
        this.spawn(origin, backward);
      }
    } else {
      this.spawnDebt = 0;
    }

    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[i];
      if (!s) continue;
      s.age += dt;
      const alive = s.age < s.life;
      if (alive) {
        s.velocity.y -= c.gravity * dt;
        s.position.addScaledVector(s.velocity, dt);
      }
      this.dummy.position.copy(s.position);
      this.dummy.scale.setScalar(alive ? 1 - s.age / s.life : 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const s of this.pool) s.age = Infinity;
    this.spawnDebt = 0;
  }

  private spawn(origin: Vector3, backward: Vector3): void {
    const c = this.cfg;
    const s = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    if (!s) return;
    const speed = c.minSpeed + Math.random() * (c.maxSpeed - c.minSpeed);
    s.position.copy(origin);
    // espalhamento lateral centrado em zero, sempre para cima
    this.jitter.set((Math.random() - 0.5) * c.spread, Math.random() * c.lift, (Math.random() - 0.5) * c.spread);
    s.velocity.copy(backward).multiplyScalar(speed).add(this.jitter);
    s.age = 0;
    s.life = c.life * (1 - c.lifeJitter * Math.random());
  }
}
