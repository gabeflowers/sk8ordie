import {
  BufferAttribute,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Camera,
  type Scene,
  type Texture,
  Vector3,
} from 'three';
import type { VisualConfig, WorldConfig } from '../config';
import { createFence, createOuterGround, createSkyDome, createSkyline } from './backdrop';
import { allPoles, buildKit, lampPosition } from './kit';
import { createAsphaltTexture, createGridTexture, createLightPoolTexture, seededRandom } from './textures';

/**
 * Cenário "Estacionamento neon": asfalto com poças de luz de sódio (lightMap), kit de pista,
 * postes, alambrado, skyline e céu. Luz: lua com sombra seguindo o skater + contraluz magenta.
 */
export class WorldView {
  private readonly fog: Fog;
  private readonly hemi: HemisphereLight;
  private readonly moon: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly sky: Mesh;
  private readonly groundMaterial: MeshStandardMaterial;
  private readonly asphalt: Texture;
  private readonly grid: Texture;
  private readonly flatForward = new Vector3();

  constructor(
    scene: Scene,
    world: WorldConfig,
    private readonly visual: VisualConfig,
    maxAnisotropy: number,
  ) {
    const pal = visual.palette;
    const l = visual.lights;

    this.fog = new Fog(pal.fog, visual.fog.near, visual.fog.far);
    scene.fog = this.fog;

    this.sky = createSkyDome(visual);
    scene.add(this.sky);

    // chão: asfalto repetido + lightMap das poças cobrindo o mapa inteiro
    const g = visual.ground;
    this.asphalt = createAsphaltTexture(visual, maxAnisotropy);
    this.asphalt.repeat.set(world.size / g.tileMeters, world.size / g.tileMeters);
    // o centro do plano (u = 0,5) cai numa borda de tile; desloca até a faixa do corredor
    this.asphalt.offset.x = g.offsetMeters / g.tileMeters;
    this.grid = createGridTexture(visual, maxAnisotropy);
    this.grid.repeat.set(world.size / visual.gridDebug.tileMeters, world.size / visual.gridDebug.tileMeters);

    const pools = allPoles(world, visual).map((p) => lampPosition(p, visual));
    const geometry = new PlaneGeometry(world.size, world.size, g.segments, g.segments).rotateX(-Math.PI / 2);
    this.tintVertices(geometry);
    this.groundMaterial = new MeshStandardMaterial({
      map: this.asphalt,
      lightMap: createLightPoolTexture(visual, world.size, pools),
      lightMapIntensity: l.lightMapIntensity,
      vertexColors: true,
      roughness: g.roughness,
    });
    const ground = new Mesh(geometry, this.groundMaterial);
    ground.receiveShadow = true;

    scene.add(
      ground,
      createOuterGround(world, visual),
      buildKit(world, visual),
      createFence(visual, maxAnisotropy),
      createSkyline(visual),
    );

    this.hemi = new HemisphereLight(l.hemiSky, l.hemiGround, l.hemiIntensity);

    this.moon = new DirectionalLight(l.moonColor, l.moonIntensity);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(l.shadowMapSize, l.shadowMapSize);
    this.moon.shadow.bias = l.shadowBias;
    this.moon.shadow.normalBias = l.shadowNormalBias;
    const cam = this.moon.shadow.camera;
    cam.left = -l.shadowExtent;
    cam.right = l.shadowExtent;
    cam.top = l.shadowExtent;
    cam.bottom = -l.shadowExtent;
    cam.near = l.shadowNear;
    cam.far = l.shadowFar;
    cam.updateProjectionMatrix();

    this.rim = new DirectionalLight(l.rimColor, l.rimIntensity);

    scene.add(this.hemi, this.moon, this.moon.target, this.rim, this.rim.target);
  }

  /** Acompanha o skater (sombra nítida, contraluz atrás dele) e aplica tuning ao vivo da lil-gui. */
  update(focus: Vector3, camera: Camera): void {
    const l = this.visual.lights;

    this.moon.target.position.copy(focus);
    this.moon.position.set(focus.x + l.moonOffsetX, focus.y + l.moonOffsetY, focus.z + l.moonOffsetZ);

    // contraluz do lado oposto à câmera, para contornar o moletom
    camera.getWorldDirection(this.flatForward).setY(0).normalize();
    this.rim.target.position.copy(focus);
    this.rim.position.copy(focus).addScaledVector(this.flatForward, l.rimDistance).setY(focus.y + l.rimHeight);

    this.sky.position.copy(camera.position);

    this.hemi.intensity = l.hemiIntensity;
    this.moon.intensity = l.moonIntensity;
    this.rim.intensity = l.rimIntensity;
    this.groundMaterial.lightMapIntensity = l.lightMapIntensity;
    this.fog.near = this.visual.fog.near;
    this.fog.far = this.visual.fog.far;

    const map = this.visual.debugGrid ? this.grid : this.asphalt;
    if (this.groundMaterial.map !== map) {
      this.groundMaterial.map = map;
      this.groundMaterial.needsUpdate = true;
    }
  }

  /** Brilho aleatório por vértice (seed fixa) para quebrar a repetição do tile de asfalto. */
  private tintVertices(geometry: PlaneGeometry): void {
    const g = this.visual.ground;
    const rand = seededRandom(g.seed);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = g.tintMin + rand() * (1 - g.tintMin);
      colors.fill(v, i * 3, i * 3 + 3);
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
  }
}
