import { MathUtils, Vector3 } from 'three';
import type { SimConfig } from '../config';
import { findGrindSnap, grindVariant, lockedGrindYaw, railHeightAt, type GrindSegment, type GrindSnap } from './grind';
import { resolveLanding } from './landing';
import { EPSILON, forwardFromYaw, headingOf, horizontalSpeed, wrapAngle } from './math';
import { Score, type TrickAward } from './score';
import { resolveGrab, type GrabId, type PopIntent, type TrickId } from './tricks/gesture';
import type { GrindRail, GrindType, GrindVariant, InputState, SkaterState } from './types';
import type { Ramp, World } from './World';

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
  /** Variação escolhida no encaixe (5-0, smith, noseslide...); null fora de GRINDING. */
  grindVariant: GrindVariant | null = null;
  /** Inclinação do chão (ou do trilho) no sentido em que o skater anda: dy por metro. */
  groundSlope = 0;
  /** Inclinação do shape (rad, + = nose para cima) no instante em que saiu do chão ou do trilho. */
  launchPitch = 0;
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
  /** Manual (nose = nose manual) com equilíbrio em −1..1; fora disso as rodas voltam ao chão. */
  manual: { nose: boolean; balance: number; vel: number; time: number } | null = null;
  /** Grab segurado no ar. */
  grab: { id: GrabId; time: number } | null = null;
  /** Powerslide em andamento (dir = lado para onde o shape atravessou). */
  powerslide: { dir: number; time: number } | null = null;
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
  private airGrab: { id: GrabId; time: number } | null = null;
  private revertTimer = 0;
  private slideLock = false;
  private lastTilt = 0;
  private lastSide = 0;
  /** rodando na transição de um quarter pipe (subindo) */
  /** quarter pipe em que está subindo (null fora da transição ou descendo) */
  private quarter: Ramp | null = null;
  private airVert = false;
  private readonly probe = new Vector3();

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
    this.manual = null;
    this.powerslide = null;
    this.revertTimer = 0;
    this.slideLock = false;
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
      if (input.lateTrick && !this.trick && !this.grab && this.airTime <= this.cfg.tricks.lateWindow) {
        this.startTrick(input.lateTrick, true);
      }
      // grab: só depois de o flip terminar; soltar guarda o grab para pontuar no pouso
      if (input.grab && this.trickCaught()) {
        if (!this.grab) this.grab = { id: resolveGrab(input.grab, input.tilt ?? 0), time: 0 };
        this.grab.time += dt;
      } else if (this.grab) {
        this.finishGrab();
      }
    }
    this.revertTimer = Math.max(0, this.revertTimer - dt);

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
    this.score.tick(dt, this.state === 'GROUNDED' && !this.manual && !this.powerslide);
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
  }

  // ---------------------------------------------------------------- GROUNDED

  private stepGrounded(input: InputState, dt: number): void {
    const c = this.cfg;
    const tc = c.tricks;
    const turn = turnAxis(input);
    this.turnInput = turn;
    this.lastTilt = input.tilt ?? 0;

    // revert: logo depois de pousar fakie, ↓ + lado gira 180° e volta a andar de frente
    if (this.revertTimer > 0 && this.fakie && input.brake && turn !== 0) {
      this.yaw += Math.PI * turn;
      this.fakie = false;
      this.revertTimer = 0;
      this.slideLock = true;
      this.score.add(tc.powerslide.revertName, tc.powerslide.revertPoints);
    }
    this.updatePowerslide(input, turn, dt);
    this.updateManual(input, dt);
    this.pushing = input.forward && !input.brake && !this.manual && !this.powerslide;

    let speed = this.speed;
    const speedT = MathUtils.clamp(speed / c.maxSpeed, 0, 1);
    const turnScale = this.powerslide ? 0 : this.manual ? tc.manual.turnFactor : 1;
    this.yaw += turn * MathUtils.lerp(c.turnRateSlow, c.turnRateFast, speedT) * dt * turnScale;

    // rampa: a gravidade freia na subida e acelera na descida
    speed = Math.max(0, speed - c.gravity * c.slopeGravity * (this.groundSlope / Math.hypot(1, this.groundSlope)) * dt);

    // friction antes do push: segurar ↑ estabiliza exatamente em maxPushSpeed
    speed = Math.max(0, speed - c.rollingFriction * dt);
    if (this.powerslide) {
      speed = Math.max(0, speed - tc.powerslide.decel * dt);
    } else if (input.brake) {
      speed = Math.max(0, speed - c.brakeDecel * dt);
    } else if (this.pushing && speed < c.maxPushSpeed) {
      speed = Math.min(c.maxPushSpeed, speed + c.pushAccel * dt);
    }
    speed = Math.min(speed, c.maxSpeed);

    // parado subindo uma rampa: rola para trás, de fakie
    if (speed <= 0 && this.groundSlope > c.rollbackSlope && !this.manual) {
      this.fakie = !this.fakie;
      this.groundSlope = -this.groundSlope;
    }

    // rodas não derrapam: a velocidade segue sempre o shape
    this.alignVelocity(speed);

    if (this.jumpBufferTimer > 0) {
      // ollie para fora do manual/powerslide: eles contam na linha
      this.endManual(true);
      this.endPowerslide(true);
      this.ollie();
      this.moveAirborne(dt);
      return;
    }

    this.position.addScaledVector(this.velocity, dt);
    const q = this.quarter;
    if (q?.vert && pastLip(q, this.position)) {
      // passou do coping: decola ali mesmo, antes que o deck atrás vire parede
      clampToLip(q, this.position);
      this.position.y = q.height;
      this.takeOff(true);
      return;
    }
    this.collideSides();
    if (this.state !== 'GROUNDED') return;

    const footY = this.position.y;
    const groundY = this.world.groundHeightAt(this.position.x, this.position.z, footY + c.stepTolerance);
    // descendo rampa, o chão cai até slope × passo a cada frame: continua colado nela
    const descent = this.groundSlope < 0 ? -this.groundSlope * this.speed * dt * c.rampStickFactor : 0;
    if (groundY < footY - c.stepTolerance - descent) {
      // o chão sumiu: saiu de uma borda (ou passou pelo lip da rampa e é lançado)
      this.takeOff(this.quarter?.vert === true);
    } else {
      this.position.y = groundY;
      this.groundSlope = this.measureSlope();
      this.quarter = this.groundSlope > c.rollbackSlope ? this.world.quarterAt(this.position.x, this.position.z) : null;
    }
  }

  /** Sai do chão rodando (sem pop): borda, lip de kicker ou coping do quarter pipe (`vert`). */
  private takeOff(vert: boolean): void {
    const c = this.cfg;
    this.state = 'AIRBORNE';
    if (vert) {
      // saiu pelo coping: air quase vertical, que volta para a transição
      this.velocity.y = MathUtils.clamp(this.speed * this.groundSlope, 0, c.vertMaxLaunch);
      this.launchVert();
    } else {
      this.velocity.y = Math.max(0, this.speed * this.groundSlope * c.rampLaunch);
    }
    this.captureLaunch();
    this.groundSlope = 0;
    this.quarter = null;
    this.coyoteTimer = c.coyoteTime;
    this.endManual(true);
    this.endPowerslide(false);
    this.resetAir(false);
    this.airVert = vert;
  }

  /**
   * Inclinação do chão no sentido em que anda, medida para trás (o trecho que acabou de rodar):
   * no lip da rampa a sonda à frente cairia do outro lado.
   */
  private measureSlope(): number {
    const c = this.cfg;
    const d = c.slopeProbe;
    forwardFromYaw(this.travelYaw, this.forward);
    this.probe.copy(this.position).addScaledVector(this.forward, -d);
    const behind = this.world.groundHeightAt(this.probe.x, this.probe.z, this.position.y + c.stepTolerance);
    const rise = this.position.y - behind;
    // degraus (caixas) não são rampa: só conta se a diferença é contínua
    if (Math.abs(rise) > d * c.maxGroundSlope) return 0;
    return rise / d;
  }

  // ---------------------------------------------------------------- AIRBORNE

  private stepAirborne(input: InputState, dt: number): void {
    const turn = turnAxis(input);
    this.lastTilt = input.tilt ?? 0;
    this.lastSide = input.side ?? 0;
    this.groundSlope = 0;
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
    // não pegou o shape (flip incompleto) ou pousou ainda segurando o grab
    if (!this.trickCaught() || this.grab) {
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
        if (outcome.fakie) this.revertTimer = this.cfg.tricks.powerslide.revertWindow;
        // pousar segurando W/S já entra em manual
        if (this.lastTilt !== 0 && outcome.speed >= this.cfg.tricks.manual.minSpeed) this.startManual(this.lastTilt > 0);
        // jump buffer: SPACE apertado pouco antes de tocar o chão
        if (this.jumpBufferTimer > 0) this.ollie();
        break;
      case 'bail':
        this.bail();
        break;
    }
  }

  /**
   * Air de quarter pipe: sobe quase reto. A componente para fora do lip vira uma leve volta para
   * dentro (pousa de novo na transição); a lateral sobra em parte.
   */
  private launchVert(): void {
    const r = this.quarter;
    if (!r) return;
    const c = this.cfg;
    if (r.axis === 'x') {
      this.velocity.x = -r.sign * c.vertReturn;
      this.velocity.z *= c.vertCarry;
    } else {
      this.velocity.z = -r.sign * c.vertReturn;
      this.velocity.x *= c.vertCarry;
    }
  }

  private ollie(): void {
    const t = this.cfg.tricks;
    const pop = this.pendingPop;
    this.pendingPop = null;
    // agachar mais = pop mais alto (sem dados de pop, altura máxima)
    // na rampa, a subida soma ao pop
    const vert = this.state === 'GROUNDED' && this.quarter?.vert === true;
    const climb = this.state === 'GROUNDED' ? Math.max(0, this.speed * this.groundSlope) : 0;
    const rampLift = vert ? Math.min(climb, this.cfg.vertMaxLaunch) : climb * this.cfg.rampLaunch;
    this.velocity.y = this.cfg.ollieVelocity * MathUtils.lerp(t.minPopFactor, 1, pop ? pop.charge : 1) + rampLift;
    // pop na transição: sobe reto e volta para a rampa
    if (vert) this.launchVert();
    this.captureLaunch();
    this.groundSlope = 0;
    this.quarter = null;
    this.state = 'AIRBORNE';
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.ollieCount++;
    this.resetAir(true);
    this.airNollie = pop?.nollie ?? false;
    this.airVert = vert;
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

  // ---------------------------------------------------------- MANUAL / SLIDE / GRAB

  private startManual(nose: boolean): void {
    const m = this.cfg.tricks.manual;
    this.manual = { nose, balance: m.startBalance * (nose ? 1 : -1), vel: 0, time: 0 };
  }

  /** Entra com S/W no chão; o desequilíbrio cresce sozinho e W/S corrigem. */
  private updateManual(input: InputState, dt: number): void {
    const m = this.cfg.tricks.manual;
    if (!this.manual) {
      const tap = input.tap;
      if ((tap === 'S' || tap === 'W') && this.speed >= m.minSpeed && !this.powerslide && !this.crouching) {
        this.startManual(tap === 'W');
      }
      return;
    }
    const man = this.manual;
    const acc =
      man.balance * m.instability * (1 + m.instabilityGrowth * man.time) + (input.tilt ?? 0) * m.correction - man.vel * m.damping;
    man.vel += acc * dt;
    man.balance += man.vel * dt;
    man.time += dt;
    if (Math.abs(man.balance) >= 1 || this.speed < m.exitSpeed) this.endManual(true);
  }

  private endManual(award: boolean): void {
    const man = this.manual;
    if (!man) return;
    const m = this.cfg.tricks.manual;
    if (award) this.score.add(man.nose ? m.names.nose : m.names.tail, m.points + m.pointsPerSecond * man.time);
    this.manual = null;
  }

  private updatePowerslide(input: InputState, turn: number, dt: number): void {
    const ps = this.cfg.tricks.powerslide;
    if (!input.brake) this.slideLock = false;
    const wants = !this.manual && !this.slideLock && input.brake && turn !== 0;
    if (this.powerslide) {
      if (wants && this.speed > this.cfg.tricks.manual.exitSpeed) this.powerslide.time += dt;
      else this.endPowerslide(true);
    } else if (wants && this.speed >= ps.minSpeed) {
      this.powerslide = { dir: turn, time: 0 };
    }
  }

  private endPowerslide(award: boolean): void {
    const slide = this.powerslide;
    if (!slide) return;
    const ps = this.cfg.tricks.powerslide;
    if (award && slide.time >= ps.minTime) this.score.add(ps.name, ps.points);
    this.powerslide = null;
  }

  /** Soltou o grab no ar: guarda o mais longo do voo para pontuar no pouso. */
  private finishGrab(): void {
    if (this.grab && (!this.airGrab || this.grab.time > this.airGrab.time)) this.airGrab = this.grab;
    this.grab = null;
  }

  /** Começa a rastrear um voo (pop ou saída de borda/trilho). */
  /** Air saído do coping do quarter pipe (o corpo fica alinhado com a transição). */
  get vertAir(): boolean {
    return this.airVert;
  }

  /** Guarda a inclinação do shape na decolagem (antes de zerar groundSlope). */
  private captureLaunch(): void {
    // no chão a velocidade segue o shape: de fakie o nose aponta para trás
    this.launchPitch = Math.atan(this.groundSlope * (this.fakie ? -1 : 1));
  }

  private resetAir(popped: boolean): void {
    this.airVert = false;
    this.grab = null;
    this.airGrab = null;
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
    if (this.grab) this.finishGrab();
    const flip = this.trick ? t.catalog[this.trick.id] : null;
    const spin = this.spin();
    const grab = this.airGrab;
    if (grab) {
      const g = t.grabs[grab.id];
      this.score.add(g.name, g.points + t.grabPointsPerSecond * grab.time);
    }
    if (!flip && spin.degrees === 0 && !this.airVert && (!this.airPopped || grab)) {
      this.resetAir(false);
      return;
    }

    // air no quarter pipe sem flip/grab ganha o nome "Air" ("FS 180 Air")
    const vertCore = this.airVert && !grab;
    const core = flip ? flip.name : vertCore ? t.vertAir.name : spin.degrees > 0 || this.airNollie ? '' : t.ollie.name;
    const name = [
      this.airNollie ? 'Nollie' : this.airFakie ? 'Fakie' : '',
      spin.degrees > 0 ? `${spin.side} ${spin.degrees}` : '',
      this.trick?.late ? 'Late' : '',
      core,
    ]
      .filter((p) => p !== '')
      .join(' ');

    let points =
      (flip ? flip.points : vertCore ? t.vertAir.points : spin.degrees > 0 ? 0 : t.ollie.points) +
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
    this.position.set(snap.x, snap.y, snap.z);
    this.grindVariant = grindVariant(snap.type, this.lastTilt, this.lastSide);
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

    // corrimão inclinado: a gravidade acelera na descida (e freia na subida)
    const slope = seg.grade * (dir.x * seg.tx + dir.z * seg.tz);
    this.groundSlope = slope;
    speed = Math.max(0, speed - c.gravity * c.grindSlopeGravity * (slope / Math.hypot(1, slope)) * dt);
    speed = Math.max(0, speed - c.grindFriction * dt);
    this.velocity.set(dir.x * speed, 0, dir.z * speed);
    this.position.addScaledVector(this.velocity, dt);

    // reprojeta na linha do segmento: sem deriva lateral; a altura acompanha o trilho
    const r = seg.rail;
    const s = (this.position.x - r.ax) * seg.tx + (this.position.z - r.az) * seg.tz;
    this.position.set(r.ax + seg.tx * s, railHeightAt(seg, Math.min(Math.max(s, 0), seg.length)), r.az + seg.tz * s);

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

  /** Grind em andamento com os pontos acumulados até agora (o HUD mostra ao vivo). */
  get liveGrind(): TrickAward | null {
    if (!this.grindVariant) return null;
    const sc = this.cfg.score;
    const v = sc.grindVariants[this.grindVariant];
    return { name: v.name, points: Math.round((sc.grindBasePoints + sc.grindPointsPerSecond * this.grindTime) * v.factor) };
  }

  /** Sai do trilho para AIRBORNE com vy = 0 (quem chama decide coyote/ollie). */
  private leaveGrind(): void {
    const live = this.liveGrind;
    if (live) this.score.add(live.name, live.points);
    this.state = 'AIRBORNE';
    // descendo um corrimão de escada, sai já caindo junto com ele
    this.velocity.y = Math.min(0, this.speed * this.groundSlope);
    this.captureLaunch();
    this.groundSlope = 0;
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
    this.grindVariant = null;
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
    this.manual = null;
    this.powerslide = null;
    this.grab = null;
    this.airGrab = null;
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
    // subindo rampa, a borda do círculo chega antes do pé no que está no topo (deck, funbox):
    // vale a altura da rampa embaixo da borda da frente
    let floor = this.position.y;
    const h = horizontalSpeed(this.velocity);
    if (this.state === 'GROUNDED' && this.groundSlope > 0 && h > EPSILON) {
      const k = c.skaterRadius / h;
      const p = this.position;
      floor = Math.max(floor, this.world.rampSurfaceAhead(p.x, p.z, p.x + this.velocity.x * k, p.z + this.velocity.z * k));
    }
    const minWallTop = floor + c.stepTolerance;
    // trilhando um corrimão, a colisão dele mesmo não conta
    const ignore = this.state === 'GRINDING' ? this.grindSegment?.rail.railId : undefined;
    if (!this.world.resolveCircleCollisions(this.position, c.skaterRadius, minWallTop, this.hitNormal, ignore)) return false;

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

/** Passou da linha do coping (a ponta alta da rampa)? */
function pastLip(r: Ramp, p: Vector3): boolean {
  if (r.axis === 'x') return r.sign > 0 ? p.x > r.maxX : p.x < r.minX;
  return r.sign > 0 ? p.z > r.maxZ : p.z < r.minZ;
}

/** Traz o ponto de volta para a linha do coping, um tico para dentro da rampa. */
function clampToLip(r: Ramp, p: Vector3): void {
  const inset = 1e-3;
  if (r.axis === 'x') p.x = r.sign > 0 ? r.maxX - inset : r.minX + inset;
  else p.z = r.sign > 0 ? r.maxZ - inset : r.minZ + inset;
}
