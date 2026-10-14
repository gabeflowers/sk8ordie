import { Quaternion, Vector3 } from 'three';
import type { VisualConfig } from '../config';
import { EPSILON } from '../sim/math';
import type { RagdollWorld } from './ragdoll';

// Shape solto no tombo: corpo rígido simples (caixa com giro), só para o visual. Puro.

type BailConfig = VisualConfig['bail'];

const Y = new Vector3(0, 1, 0);
const NEG_Y = new Vector3(0, -1, 0);
const Z = new Vector3(0, 0, 1);

export class BoardBody {
  /** Centro da caixa do shape (mundo). */
  readonly center = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  /** Velocidade angular (mundo, rad/s). */
  readonly angular = new Vector3();

  private readonly corners: Vector3[] = [];
  private accumulator = 0;
  private readonly tmp = new Vector3();
  private readonly up = new Vector3();
  private readonly fwd = new Vector3();
  private readonly lat = new Vector3();
  private readonly dq = new Quaternion();
  private readonly align = new Quaternion();

  constructor(
    private readonly cfg: BailConfig,
    readonly halfX: number,
    readonly halfY: number,
    readonly halfZ: number,
  ) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      this.corners.push(new Vector3(sx * halfX, sy * halfY, sz * halfZ));
    }
  }

  start(center: Vector3, quaternion: Quaternion, velocity: Vector3, angular: Vector3): void {
    this.center.copy(center);
    this.quaternion.copy(quaternion);
    this.velocity.copy(velocity);
    this.angular.copy(angular);
    this.accumulator = 0;
  }

  step(dt: number, world: RagdollWorld): void {
    this.accumulator += dt;
    while (this.accumulator >= this.cfg.substep) {
      this.substep(world);
      this.accumulator -= this.cfg.substep;
    }
  }

  /** Rodas para baixo (o shape está "de pé" e pode rolar). */
  get wheelsDown(): boolean {
    return this.up.copy(Y).applyQuaternion(this.quaternion).y > this.cfg.boardWheelsDownCos;
  }

  private substep(world: RagdollWorld): void {
    const c = this.cfg;
    const h = c.substep;

    this.velocity.y -= c.gravity * h;
    this.center.addScaledVector(this.velocity, h);
    const w = this.angular.length();
    if (w > EPSILON) {
      this.dq.setFromAxisAngle(this.tmp.copy(this.angular).divideScalar(w), w * h);
      this.quaternion.premultiply(this.dq).normalize();
    }

    this.collideWalls(world);
    this.collideGround(world);
  }

  /** Lateral das caixas: empurra para fora e quica de volta. */
  private collideWalls(world: RagdollWorld): void {
    const c = this.cfg;
    const r = c.boardWallRadius;
    const p = this.center;
    for (const box of world.boxes) {
      if (p.y - this.halfY >= box.top) continue;
      if (p.x <= box.minX - r || p.x >= box.maxX + r || p.z <= box.minZ - r || p.z >= box.maxZ + r) continue;
      const pushes: [number, number, number][] = [
        [p.x - (box.minX - r), -1, 0],
        [box.maxX + r - p.x, 1, 0],
        [p.z - (box.minZ - r), 0, -1],
        [box.maxZ + r - p.z, 0, 1],
      ];
      let best = pushes[0];
      for (const push of pushes) if (best && push[0] < best[0]) best = push;
      if (!best) continue;
      const [depth, nx, nz] = best;
      p.x += nx * depth;
      p.z += nz * depth;
      const vn = this.velocity.x * nx + this.velocity.z * nz;
      if (vn < 0) {
        this.velocity.x -= nx * vn * (1 + c.boardWallRestitution);
        this.velocity.z -= nz * vn * (1 + c.boardWallRestitution);
      }
    }
  }

  private collideGround(world: RagdollWorld): void {
    const c = this.cfg;
    const h = c.substep;

    let minY = Infinity;
    for (const corner of this.corners) {
      minY = Math.min(minY, this.tmp.copy(corner).applyQuaternion(this.quaternion).y + this.center.y);
    }
    const ground = world.groundHeightAt(this.center.x, this.center.z, this.center.y);
    if (minY >= ground) return;

    this.center.y += ground - minY;
    if (this.velocity.y < 0) this.velocity.y = -this.velocity.y * c.boardRestitution;

    // atrito: com as rodas no chão rola no sentido do shape; senão arrasta
    if (this.wheelsDown) {
      this.fwd.copy(Z).applyQuaternion(this.quaternion).setY(0);
      if (this.fwd.lengthSq() > EPSILON) this.fwd.normalize();
      const along = this.velocity.x * this.fwd.x + this.velocity.z * this.fwd.z;
      this.lat.set(this.velocity.x - this.fwd.x * along, 0, this.velocity.z - this.fwd.z * along);
      const alongNext = Math.sign(along) * Math.max(0, Math.abs(along) - c.boardRollFriction * h);
      const latLen = this.lat.length();
      const latScale = latLen > EPSILON ? Math.max(0, latLen - c.boardLateralFriction * h) / latLen : 0;
      this.velocity.x = this.fwd.x * alongNext + this.lat.x * latScale;
      this.velocity.z = this.fwd.z * alongNext + this.lat.z * latScale;
    } else {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const scale = speed > EPSILON ? Math.max(0, speed - c.boardSlideFriction * h) / speed : 0;
      this.velocity.x *= scale;
      this.velocity.z *= scale;
    }

    // no chão o giro morre e o shape assenta deitado (rodas para baixo ou para cima)
    this.angular.multiplyScalar(Math.max(0, 1 - c.boardContactSpinDamping * h));
    this.up.copy(Y).applyQuaternion(this.quaternion);
    this.align.setFromUnitVectors(this.up, this.up.y >= 0 ? Y : NEG_Y);
    this.dq.copy(this.align).multiply(this.quaternion);
    this.quaternion.slerp(this.dq, Math.min(1, c.boardSettleRate * h));
  }
}
