import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { CameraConfig, SimConfig } from '../config';
import { forwardFromYaw, headingOf, horizontalSpeed, wrapAngle } from '../sim/math';
import type { SkaterState } from '../sim/types';

export interface ChaseTarget {
  position: Vector3;
  yaw: number;
  velocity: Vector3;
  state: SkaterState;
}

/** Câmera em 3ª pessoa atrás e acima do skater, com suavização independente de framerate. */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;

  private heading = 0;
  /** giro extra em volta do skater (vista 3/4 no grind) e o lado escolhido na entrada */
  private orbit = 0;
  private orbitSide = 1;
  private wasGrinding = false;
  private readonly orbitDir = new Vector3();
  private readonly lookPoint = new Vector3();
  private readonly dir = new Vector3();
  private readonly desiredPos = new Vector3();
  private readonly desiredLook = new Vector3();

  constructor(
    private readonly cfg: CameraConfig,
    private readonly simCfg: SimConfig,
  ) {
    this.camera = new PerspectiveCamera(cfg.fovMin, 1, cfg.near, cfg.far);
  }

  /** Posiciona sem suavização (início e reset). */
  snap(target: ChaseTarget): void {
    this.heading = this.desiredHeading(target);
    this.orbit = 0;
    this.wasGrinding = false;
    this.computeDesired(target);
    this.camera.position.copy(this.desiredPos);
    this.lookPoint.copy(this.desiredLook);
    this.camera.fov = this.fovFor(target);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.lookPoint);
  }

  update(dt: number, target: ChaseTarget): void {
    const c = this.cfg;
    const alpha = 1 - Math.exp(-c.camDamping * dt);
    const lookAlpha = 1 - Math.exp(-c.camLookDamping * dt);

    this.heading += wrapAngle(this.desiredHeading(target) - this.heading) * alpha;

    const grinding = target.state === 'GRINDING';
    if (grinding && !this.wasGrinding) {
      // gira para o lado em que a câmera já está, sem cruzar por trás do skater
      forwardFromYaw(this.heading, this.dir);
      const cross = this.dir.z * (this.camera.position.x - target.position.x) - this.dir.x * (this.camera.position.z - target.position.z);
      this.orbitSide = cross >= 0 ? 1 : -1;
    }
    this.wasGrinding = grinding;
    this.orbit += ((grinding ? c.grindOrbit * this.orbitSide : 0) - this.orbit) * alpha;
    this.computeDesired(target);

    this.camera.position.lerp(this.desiredPos, alpha);
    this.lookPoint.lerp(this.desiredLook, lookAlpha);
    this.camera.lookAt(this.lookPoint);

    this.camera.fov = MathUtils.lerp(this.camera.fov, this.fovFor(target), alpha);
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * No chão segue o shape; no ar e no grind segue a trajetória (não gira junto com os spins
   * nem com o shape atravessado no boardslide).
   */
  private desiredHeading(target: ChaseTarget): number {
    if (target.state !== 'AIRBORNE' && target.state !== 'GRINDING') return target.yaw;
    return horizontalSpeed(target.velocity) > this.cfg.minHeadingSpeed ? headingOf(target.velocity) : this.heading;
  }

  private computeDesired(target: ChaseTarget): void {
    const c = this.cfg;
    forwardFromYaw(this.heading, this.dir);
    forwardFromYaw(this.heading + this.orbit, this.orbitDir);
    const distance = MathUtils.lerp(c.camDistance, c.grindDistance, c.grindOrbit > 0 ? Math.abs(this.orbit) / c.grindOrbit : 0);
    this.desiredPos.copy(target.position).addScaledVector(this.orbitDir, -distance);
    this.desiredPos.y += c.camHeight;
    this.desiredLook.copy(target.position).addScaledVector(this.dir, c.camLookAhead);
    this.desiredLook.y += c.camLookHeight;
  }

  private fovFor(target: ChaseTarget): number {
    const t = MathUtils.clamp(horizontalSpeed(target.velocity) / this.simCfg.maxSpeed, 0, 1);
    return MathUtils.lerp(this.cfg.fovMin, this.cfg.fovMax, t);
  }
}
