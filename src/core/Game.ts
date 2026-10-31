import { Color, PCFShadowMap, Scene, WebGLRenderer } from 'three';
import { CONFIG } from '../config';
import { ChaseCamera, type ChaseTarget } from '../render/ChaseCamera';
import { Hud } from '../render/Hud';
import { SkaterView } from '../render/SkaterView';
import { WorldView } from '../render/WorldView';
import { worldDef } from '../sim/layout';
import { SkaterSim } from '../sim/SkaterSim';
import { World } from '../sim/World';
import { FixedStepper } from './FixedStepper';
import { Input } from './Input';

/** Orquestra loop fixo da simulação e render em requestAnimationFrame. */
export class Game {
  readonly sim: SkaterSim;
  readonly input: Input;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly worldView: WorldView;
  private readonly skaterView: SkaterView;
  private readonly chase: ChaseCamera;
  private readonly hud: Hud;
  private readonly stepper = new FixedStepper(CONFIG.loop);
  private lastTime: number | null = null;

  constructor(private readonly container: HTMLElement) {
    const v = CONFIG.visual;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, v.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    // fallback atrás da cúpula do céu
    this.scene.background = new Color(v.palette.fog);

    this.sim = new SkaterSim(new World(worldDef(CONFIG.world)), CONFIG.sim);
    this.worldView = new WorldView(this.scene, CONFIG.world, v, this.renderer.capabilities.getMaxAnisotropy());
    this.skaterView = new SkaterView(v, CONFIG.sim);
    this.scene.add(this.skaterView.root, this.skaterView.sparks.mesh);
    this.chase = new ChaseCamera(CONFIG.camera, CONFIG.sim);
    this.input = new Input(CONFIG.sim.tricks, window);
    this.hud = new Hud(container, v.hud);
  }

  start(): void {
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.onResize();
    this.resetSkater();
    requestAnimationFrame(this.frame);
  }

  resetSkater(): void {
    this.sim.reset();
    this.stepper.reset();
    this.skaterView.reset(this.sim);
    this.skaterView.update(this.sim, 1, 0);
    this.chase.snap(this.chaseTarget());
  }

  private readonly frame = (now: number): void => {
    const dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.input.consumeReset()) this.resetSkater();

    const { alpha } = this.stepper.advance(dt, (fixedDt) => this.sim.step(this.input.consume(), fixedDt));

    const frameDt = Math.min(dt, CONFIG.loop.maxFrameDt);
    this.skaterView.update(this.sim, alpha, frameDt);
    this.hud.update(this.sim.score, frameDt);
    this.chase.update(frameDt, this.chaseTarget());
    this.worldView.update(this.skaterView.renderPosition, this.chase.camera);
    this.renderer.render(this.scene, this.chase.camera);

    requestAnimationFrame(this.frame);
  };

  private chaseTarget(): ChaseTarget {
    return {
      position: this.skaterView.renderPosition,
      // a câmera fica atrás de quem anda: de fakie, atrás do nose (o tail vai na frente)
      yaw: this.skaterView.renderYaw + (this.sim.fakie ? Math.PI : 0),
      velocity: this.sim.velocity,
      state: this.sim.state,
    };
  }

  private readonly onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.chase.setAspect(w / h);
  };

  private readonly onVisibilityChange = (): void => {
    // ao voltar de aba inativa, recomeça a contagem de tempo do zero
    this.lastTime = null;
  };
}
