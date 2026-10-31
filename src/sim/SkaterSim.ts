import { MathUtils, Vector3 } from 'three';
import type { SimConfig } from '../config';
import { findGrindSnap, lockedGrindYaw, type GrindSegment, type GrindSnap } from './grind';
import { resolveLanding } from './landing';
import { EPSILON, forwardFromYaw, headingOf, horizontalSpeed, wrapAngle } from './math';
import { Score } from './score';
import type { PopIntent, TrickId } from './tricks/gesture';
import type { GrindRail, GrindType, InputState, SkaterState } from './types';
import type { World } from './World';

function turnAxis(input: InputState): number {
  return (input.left ? 1 : 0) - (input.right ? 1 : 0);
}

/**
 * Simulação arcade do skater. Pura: só usa classes matemáticas do Three,
 * recebe InputState e um dt fixo. `position.y` é a altura do pé (contato das rodas).
 */
export class SkaterSim {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  state: SkaterState = 'GROUNDED';
  /** Andando de costas (tail na frente), depois de pousar um 180. Só muda ao aterrissar. */
  fakie = false;

  /** Estado do passo anterior, para interpolar o render. */
  readonly prevPosition = new Vector3();
  prevYaw = 0;

  coyoteTimer = 0;
  jumpBufferTimer = 0;
  bailTimer = 0;
  /** Velocidade no instante do bail (antes de a colisão zerar): o tombo e o shape seguem esse momento. */
  readonly bailVelocity = new Vector3();
  /** Normal da parede quando o bail foi batida lateral; (0, 0, 0) quando foi aterrissagem. */
  readonly bailNormal = new Vector3();
  /** Último input de giro aplicado (-1..1), usado pelo visual. */
  turnInput = 0;
  /** Remando neste passo (↑ no chão, sem frear); o visual anima a remada. */
  pushing = false;

  /** Manobra atual; null fora de GRINDING. */
  grindType: GrindType | null = null;
  /** Tangente unitária do trilho no sentido do movimento; (0, 0, 0) fora de GRINDING. */
  readonly grindDir = new Vector3();

  // Contadores monotônicos: o visual detecta eventos sem perder nenhum.
  ollieCount = 0;
  landCount = 0;
  bailCount = 0;
  /** Incrementado a cada entrada em GRINDING. */
  grindCount = 0;

  /** Flip em andamento no ar (o shape gira até `duration`). */
  trick: { id: TrickId; t: number; duration: number; late: boolean } | null = null;
  /** Agachado segurando o pop (o visual agacha o skater). */
  crouching = false;
  /** Pontuação da sessão: linha atual, multiplicador, total. */
  readonly score: Score;

  // rastreio do voo atual, para nomear e pontuar a manobra no pouso
  private pendingPop: PopIntent | null = null;
  private airPopped = false;
  private airNollie = false;
  private airFakie = false;
  private airTime = 0;
  private airYaw0 = 0;
  private grindTime = 0;

  private grindSegment: GrindSegment | null = null;
  private readonly forward = new Vector3();
  private readonly hitNormal = new Vector3();
  private readonly preImpact = new Vector3();

  constructor(
    readonly world: World,
    readonly cfg: SimConfig,
  ) {
    this.score = new Score(cfg.score);
    this.reset();
  }

  /** Progresso do flip atual (0..1); 0 sem flip. */
  get trickProgress(): number {
    return this.trick ? Math.min(1, this.trick.t / this.trick.duration) : 0;
  }

  /** Velocidade horizontal (m/s). */
  get speed(): number {
    return horizontalSpeed(this.velocity);
  }

  /** Direção em que o skater anda no chão: o yaw do shape, virado 180° quando fakie. */
  get travelYaw(): number {
    return this.yaw + (this.fakie ? Math.PI : 0);
  }

  /** Segmento sendo trilhado (corrimão ou aresta de caixa); null fora de GRINDING. */
  get grindRail(): GrindRail | null {
    return this.grindSegment?.rail ?? null;
  }

  reset(): void {
    const c = this.cfg;
    const groundY = this.world.groundHeightAt(c.spawnX, c.spawnZ, Infinity);
    this.position.set(c.spawnX, groundY, c.spawnZ);
    this.velocity.set(0, 0, 0);
    this.yaw = c.spawnYaw;
    this.state = 'GROUNDED';
    this.fakie = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.bailTimer = 0;
    this.turnInput = 0;
    this.clearGrind();
    this.trick = null;
    this.crouching = false;
    this.pendingPop = null;
    this.resetAir(false);
    this.score.reset();
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
  }

  step(input: InputState, dt: number): void {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;

    if (input.jumpPressed && this.state !== 'BAILED') {
      this.jumpBufferTimer = this.cfg.jumpBuffer;
      this.pendingPop = input.pop ?? null;
    }
    this.crouching = this.state === 'GROUNDED' && !!input.crouch;

    if (this.state === 'AIRBORNE') {
      this.airTime += dt;
      if (this.trick) this.trick.t += dt;
      // late flip: bater a tecla logo depois de sair do chão
      if (input.lateTrick && !this.trick && this.airTime <= this.cfg.tricks.lateWindow) {
        this.startTrick(input.lateTrick, true);
      }
    }

    this.pushing = false;
    switch (this.state) {
      case 'GROUNDED':
        this.stepGrounded(input, dt);
        break;
      case 'AIRBORNE':
        this.stepAirborne(input, dt);
        break;
      case 'GRINDING':
        this.stepGrinding(dt);
        break;
      case 'BAILED':
        this.stepBailed(dt);
        break;
    }

    this.world.clampToBounds(this.position, this.velocity, this.cfg.skaterRadius);
    this.score.tick(dt, this.state === 'GROUNDED');
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
  }

  // ---------------------------------------------------------------- GROUNDED

  private stepGrounded(input: InputState, dt: number): void {
    const c = this.cfg;
    const turn = turnAxis(input);
    this.turnInput = turn;
    this.pushing = input.forward && !input.brake;

    let speed = this.speed;
    const speedT = MathUtils.clamp(speed / c.maxSpeed, 0, 1);
    this.yaw += turn * MathUtils.lerp(c.turnRateSlow, c.turnRateFast, speedT) * dt;

    // friction antes do push: segurar ↑ estabiliza exatamente em maxPushSpeed
    speed = Math.max(0, speed - c.rollingFriction * dt);
    if (input.brake) {
      speed = Math.max(0, speed - c.brakeDecel * dt);
    } else if (input.forward && speed < c.maxPushSpeed) {
      speed = Math.min(c.maxPushSpeed, speed + c.pushAccel * dt);
    }
    speed = Math.min(speed, c.maxSpeed);

    // rodas não derrapam: a velocidade segue sempre o shape
    this.alignVelocity(speed);

    if (this.jumpBufferTimer > 0) {
      this.ollie();
      this.moveAirborne(dt);
      return;
    }

    this.position.addScaledVector(this.velocity, dt);
    this.collideSides();
    if (this.state !== 'GROUNDED') return;

    const footY = this.position.y;
    const groundY = this.world.groundHeightAt(this.position.x, this.position.z, footY + c.stepTolerance);
    if (groundY < footY - c.stepTolerance) {
      // o chão sumiu: saiu de uma borda
      this.state = 'AIRBORNE';
      this.velocity.y = 0;
      this.coyoteTimer = c.coyoteTime;
      this.resetAir(false);
    } else {
      this.position.y = groundY;
    }
  }

  // ---------------------------------------------------------------- AIRBORNE

  private stepAirborne(input: InputState, dt: number): void {
    const turn = turnAxis(input);
    this.turnInput = turn;

    // gira no próprio eixo; a trajetória não muda
    this.yaw += turn * this.cfg.airSpinRate * dt;

    if (this.coyoteTimer > 0 && this.jumpBufferTimer > 0) {
      this.ollie();
    }

    this.moveAirborne(dt);
  }

  private moveAirborne(dt: number): void {
    const c = this.cfg;
    const prevFootY = this.position.y;

    this.velocity.y -= c.gravity * dt;
    this.position.addScaledVector(this.velocity, dt);

    // O grind vem antes do pouso e da colisão lateral: cair perto da aresta de uma caixa
    // trilha em vez de pousar no topo. No coyote (acabou de sair rolando de uma borda ou
    // da ponta de um trilho) não engata, para não "grudar" na aresta de onde saiu.
    if (this.coyoteTimer <= 0 && this.trickCaught()) {
      const snap = findGrindSnap(this.world.grindSegments, this.position, prevFootY, this.velocity, this.yaw, c);
      if (snap) {
        this.startGrind(snap);
        this.collideGrinding();
        return;
      }
    }

    // usa o pé mais alto do passo para não "furar" o topo de uma caixa numa queda rápida
    const maxTop = Math.max(prevFootY, this.position.y) + c.stepTolerance;
    const groundY = this.world.groundHeightAt(this.position.x, this.position.z, maxTop);
    if (this.velocity.y <= 0 && this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.land();
    }

    this.collideSides();
  }

  private land(): void {
    // não pegou o shape: o flip não terminou a tempo
    if (!this.trickCaught()) {
      this.bail();
      return;
    }
    const outcome = resolveLanding(this.yaw, this.velocity, this.cfg);
    switch (outcome.type) {
      case 'clean':
        this.awardAir();
        this.state = 'GROUNDED';
        this.fakie = outcome.fakie;
        this.coyoteTimer = 0;
        this.alignVelocity(outcome.speed);
        this.landCount++;
        // jump buffer: SPACE apertado pouco antes de tocar o chão
        if (this.jumpBufferTimer > 0) this.ollie();
        break;
      case 'bail':
        this.bail();
        break;
    }
  }

  private ollie(): void {
    const t = this.cfg.tricks;
    const pop = this.pendingPop;
    this.pendingPop = null;
    // agachar mais = pop mais alto (sem dados de pop, altura máxima)
    this.velocity.y = this.cfg.ollieVelocity * MathUtils.lerp(t.minPopFactor, 1, pop ? pop.charge : 1);
    this.state = 'AIRBORNE';
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.ollieCount++;
    this.resetAir(true);
    this.airNollie = pop?.nollie ?? false;
    if (pop?.trick) this.startTrick(pop.trick, false);
  }

  // ------------------------------------------------------------------ MANOBRAS

  private startTrick(id: TrickId, late: boolean): void {
    this.trick = { id, t: 0, duration: this.cfg.tricks.catalog[id].duration, late };
  }

  /** Sem flip, ou flip adiantado o bastante para o pé pegar o shape. */
  private trickCaught(): boolean {
    return !this.trick || this.trick.t / this.trick.duration >= this.cfg.tricks.catchThreshold;
  }

  /** Começa a rastrear um voo (pop ou saída de borda/trilho). */
  private resetAir(popped: boolean): void {
    this.airPopped = popped;
    this.airNollie = false;
    this.airFakie = this.fakie;
    this.airTime = 0;
    this.airYaw0 = this.yaw;
    this.trick = null;
  }

  /** Giro do corpo no voo: meias-voltas completas (com tolerância) e o lado. */
  private spin(): { degrees: number; side: 'FS' | 'BS' } {
    const total = this.yaw - this.airYaw0;
    const half = Math.round(Math.abs(total) / Math.PI);
    if (half < 1 || Math.abs(Math.abs(total) - half * Math.PI) > this.cfg.tricks.spinTolerance) {
      return { degrees: 0, side: 'FS' };
    }
    // girar para o lado do peito primeiro (yaw +) é frontside
    return { degrees: half * 180, side: total > 0 ? 'FS' : 'BS' };
  }

  /** Nomeia e pontua o voo que acabou bem (pouso ou encaixe num trilho). */
  private awardAir(): void {
    const t = this.cfg.tricks;
    const flip = this.trick ? t.catalog[this.trick.id] : null;
    const spin = this.spin();
    if (!flip && spin.degrees === 0 && !this.airPopped) {
      this.resetAir(false);
      return;
    }

    const core = flip ? flip.name : spin.degrees > 0 || this.airNollie ? '' : t.ollie.name;
    const name = [
      this.airNollie ? 'Nollie' : this.airFakie ? 'Fakie' : '',
      spin.degrees > 0 ? `${spin.side} ${spin.degrees}` : '',
      this.trick?.late ? 'Late' : '',
      core,
    ]
      .filter((p) => p !== '')
      .join(' ');

    let points =
      (flip ? flip.points : spin.degrees > 0 ? 0 : t.ollie.points) +
      t.spinPointsPer180 * (spin.degrees / 180) +
      t.airPointsPerSecond * this.airTime;
    if (this.airNollie) points *= t.nollieFactor;
    else if (this.airFakie) points *= t.fakieFactor;
    if (this.trick?.late) points *= t.lateFactor;

    this.score.add(name, points);
    this.resetAir(false);
  }

  // ---------------------------------------------------------------- GRINDING

  private startGrind(snap: GrindSnap): void {
    // o que foi feito no ar antes de encaixar (flip in) conta
    this.awardAir();
    this.grindTime = 0;
    this.state = 'GRINDING';
    this.grindSegment = snap.segment;
    this.grindType = snap.type;
    this.grindDir.set(snap.dirX, 0, snap.dirZ);
    this.position.set(snap.x, snap.segment.rail.y, snap.z);
    this.velocity.set(snap.dirX * snap.speed, 0, snap.dirZ * snap.speed);
    this.yaw = lockedGrindYaw(this.yaw, headingOf(this.grindDir), snap.type);
    this.coyoteTimer = 0;
    this.turnInput = 0;
    this.grindCount++;
  }

  /** Desliza no trilho: sem gravidade, yaw travado, remar/frear/girar ignorados. */
  private stepGrinding(dt: number): void {
    const c = this.cfg;
    const seg = this.grindSegment;
    if (!seg) {
      // defensivo: estado inconsistente vira queda
      this.leaveGrind();
      this.moveAirborne(dt);
      return;
    }
    const dir = this.grindDir;
    this.turnInput = 0;
    this.grindTime += dt;

    // só a componente tangente conta (clampToBounds pode ter zerado um eixo)
    let speed = Math.max(0, this.velocity.x * dir.x + this.velocity.z * dir.z);

    if (this.jumpBufferTimer > 0) {
      // ollie para fora: mantém a velocidade tangente
      this.velocity.set(dir.x * speed, 0, dir.z * speed);
      this.leaveGrind();
      this.ollie();
      this.moveAirborne(dt);
      return;
    }

    speed = Math.max(0, speed - c.grindFriction * dt);
    this.velocity.set(dir.x * speed, 0, dir.z * speed);
    this.position.addScaledVector(this.velocity, dt);

    // reprojeta na linha do segmento: sem deriva lateral nem vertical
    const r = seg.rail;
    const s = (this.position.x - r.ax) * seg.tx + (this.position.z - r.az) * seg.tz;
    this.position.set(r.ax + seg.tx * s, r.y, r.az + seg.tz * s);

    if (s < 0 || s > seg.length) {
      // passou da ponta: segue reto e começa a cair, com coyote para um ollie tardio
      this.leaveGrind();
      this.coyoteTimer = c.coyoteTime;
    } else if (speed < c.grindExitSpeed) {
      // devagar demais: cai do trilho
      this.leaveGrind();
    }

    this.collideGrinding();
  }

  /** Sai do trilho para AIRBORNE com vy = 0 (quem chama decide coyote/ollie). */
  private leaveGrind(): void {
    const sc = this.cfg.score;
    if (this.grindType) {
      const slide = this.grindType === 'boardslide';
      const points = (sc.grindBasePoints + sc.grindPointsPerSecond * this.grindTime) * (slide ? sc.slideFactor : 1);
      this.score.add(sc.grindNames[this.grindType], points);
    }
    this.state = 'AIRBORNE';
    this.velocity.y = 0;
    // arcade: o shape volta para o eixo do movimento, então o pouso é limpo. O boardslide sai
    // de frente; o 50-50 mantém o sentido em que entrou (de costas continua fakie).
    if (this.speed > EPSILON) {
      const d = wrapAngle(headingOf(this.velocity) - this.yaw);
      this.yaw += this.grindType === 'boardslide' || Math.abs(d) <= Math.PI / 2 ? d : wrapAngle(d + Math.PI);
    }
    this.clearGrind();
    this.resetAir(false);
  }

  private clearGrind(): void {
    this.grindSegment = null;
    this.grindType = null;
    this.grindDir.set(0, 0, 0);
  }

  /**
   * Colisão lateral no grind. O próprio trilho não é parede (topo = pé, abaixo de
   * pé + stepTolerance); encostar em qualquer outra coisa tira do trilho (ou derruba).
   */
  private collideGrinding(): void {
    if (this.collideSides() && this.state === 'GRINDING') this.leaveGrind();
  }

  // ------------------------------------------------------------------ BAILED

  private bail(velocity: Vector3 = this.velocity, wallNormal?: Vector3): void {
    this.bailVelocity.copy(velocity);
    if (wallNormal) this.bailNormal.copy(wallNormal);
    else this.bailNormal.set(0, 0, 0);
    this.state = 'BAILED';
    this.score.bail();
    this.trick = null;
    this.pendingPop = null;
    this.bailTimer = 0;
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.turnInput = 0;
    this.clearGrind();
    this.bailCount++;
  }

  private stepBailed(dt: number): void {
    const c = this.cfg;
    this.bailTimer += dt;

    const speed = this.speed;
    if (speed > 0) {
      const k = Math.max(0, speed - c.bailDecel * dt) / speed;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }

    // o corpo continua sujeito à gravidade (bail no ar cai até o chão)
    const prevFootY = this.position.y;
    this.velocity.y -= c.gravity * dt;
    this.position.addScaledVector(this.velocity, dt);

    const maxTop = Math.max(prevFootY, this.position.y) + c.stepTolerance;
    const groundY = this.world.groundHeightAt(this.position.x, this.position.z, maxTop);
    const onGround = this.position.y <= groundY;
    if (onGround) {
      this.position.y = groundY;
      this.velocity.y = 0;
    }

    this.collideSides();

    if (onGround && this.bailTimer >= c.bailResetTime) {
      // volta de pé, parado, no mesmo lugar
      this.state = 'GROUNDED';
      this.velocity.set(0, 0, 0);
    }
  }

  // ----------------------------------------------------------------- helpers

  /** Velocidade ao longo do shape, no sentido em que ele anda (fakie = tail na frente). */
  private alignVelocity(speed: number): void {
    forwardFromYaw(this.travelYaw, this.forward);
    this.velocity.set(this.forward.x * speed, 0, this.forward.z * speed);
  }

  /** Colisão lateral com caixas mais altas que o pé. Retorna true se encostou em alguma. */
  private collideSides(): boolean {
    const c = this.cfg;
    const minWallTop = this.position.y + c.stepTolerance;
    if (!this.world.resolveCircleCollisions(this.position, c.skaterRadius, minWallTop, this.hitNormal)) return false;

    // componente da velocidade contra a parede
    const impact = -(this.velocity.x * this.hitNormal.x + this.velocity.z * this.hitNormal.z);
    if (impact <= 0) return true; // já se afastando: só corrige a posição

    this.preImpact.copy(this.velocity);
    this.velocity.x = 0;
    this.velocity.z = 0;
    if (this.state !== 'BAILED' && impact > c.bailImpactSpeed) this.bail(this.preImpact, this.hitNormal);
    return true;
  }
}
