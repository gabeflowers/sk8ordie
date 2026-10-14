import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { VisualConfig, WorldConfig } from '../config';
import { merge, placeYaw } from './geometry';
import { createFenceTexture, seededRandom } from './textures';

/**
 * Cúpula do céu: névoa abaixo do horizonte, cor do horizonte logo acima, topo escuro.
 * Sem fog e sem escrever profundidade; segue a câmera.
 */
export function createSkyDome(visual: VisualConfig): Mesh {
  const s = visual.sky;
  const pal = visual.palette;
  const geometry = new SphereGeometry(s.radius, s.widthSegments, s.heightSegments);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const fog = new Color(pal.fog);
  const horizon = new Color(pal.skyHorizon);
  const top = new Color(pal.skyTop);
  const c = new Color();

  for (let i = 0; i < pos.count; i++) {
    const e = pos.getY(i) / s.radius; // seno da elevação
    if (e <= 0) c.copy(fog);
    else {
      c.copy(fog).lerp(horizon, MathUtils.clamp(e / s.horizonBlend, 0, 1));
      c.lerp(top, MathUtils.clamp(e / s.topBand, 0, 1) ** s.exponent);
    }
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/** Moldura de chão fora do mapa (4 faixas que não se sobrepõem ao chão principal). */
export function createOuterGround(world: WorldConfig, visual: VisualConfig): Mesh {
  const half = world.size / 2;
  const far = visual.ground.outerSize;
  const strip = (w: number, d: number, x: number, z: number): BufferGeometry =>
    new PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0, z);
  const geometry = merge([
    strip(2 * far, far - half, 0, (far + half) / 2),
    strip(2 * far, far - half, 0, -(far + half) / 2),
    strip(far - half, 2 * half, (far + half) / 2, 0),
    strip(far - half, 2 * half, -(far + half) / 2, 0),
  ]);
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: visual.palette.outerGround, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** Alambrado nos 4 lados, fora do limite do mapa. */
export function createFence(visual: VisualConfig, maxAnisotropy: number): Mesh {
  const f = visual.fence;
  const length = 2 * f.offset;
  const tex = createFenceTexture(visual, maxAnisotropy);
  tex.repeat.set(length / f.textureMeters, f.height / f.textureMeters);

  const side = (yaw: number, x: number, z: number): BufferGeometry =>
    placeYaw(new PlaneGeometry(length, f.height).translate(0, f.height / 2, 0), new Vector3(x, 0, z), yaw);
  const geometry = merge([
    side(0, 0, f.offset),
    side(0, 0, -f.offset),
    side(Math.PI / 2, f.offset, 0),
    side(Math.PI / 2, -f.offset, 0),
  ]);
  return new Mesh(
    geometry,
    new MeshStandardMaterial({ color: visual.palette.fence, map: tex, alphaTest: f.alphaTest, side: DoubleSide, roughness: 1 }),
  );
}

interface Building {
  angle: number;
  radius: number;
  width: number;
  depth: number;
  height: number;
}

/** Skyline em silhueta + viaduto (1 draw) e janelas acesas instanciadas (1 draw), sem fog. */
export function createSkyline(visual: VisualConfig): Group {
  const s = visual.skyline;
  const pal = visual.palette;
  const rand = seededRandom(s.seed);
  const range = (min: number, max: number): number => min + rand() * (max - min);

  const buildings: Building[] = [];
  for (let i = 0; i < s.count; i++) {
    buildings.push({
      angle: ((i + rand()) / s.count) * Math.PI * 2,
      radius: range(s.minRadius, s.maxRadius),
      width: range(s.minWidth, s.maxWidth),
      depth: range(s.minDepth, s.maxDepth),
      height: range(s.minHeight, s.maxHeight),
    });
  }

  // cada prédio gira para a fachada (−Z local) ficar de frente para o centro do mapa
  const parts: BufferGeometry[] = buildings.map((b) =>
    placeYaw(
      new BoxGeometry(b.width, b.height, b.depth).translate(0, b.height / 2, 0),
      new Vector3(Math.sin(b.angle) * b.radius, 0, Math.cos(b.angle) * b.radius),
      b.angle,
    ),
  );

  const deckBottom = s.viaductY - s.viaductThickness / 2;
  parts.push(new BoxGeometry(s.viaductLength, s.viaductThickness, s.viaductDepth).translate(0, s.viaductY, s.viaductZ));
  for (let i = 0; i < s.viaductPillars; i++) {
    const x = ((i + 0.5) / s.viaductPillars - 0.5) * s.viaductLength;
    parts.push(new BoxGeometry(s.pillarSize, deckBottom, s.pillarSize).translate(x, deckBottom / 2, s.viaductZ));
  }

  const group = new Group();
  group.add(new Mesh(merge(parts), new MeshBasicMaterial({ color: pal.skyline, fog: false })));

  const windows = new InstancedMesh(
    new PlaneGeometry(s.windowWidth, s.windowHeight),
    new MeshBasicMaterial({ fog: false }),
    s.windowCount,
  );
  const dummy = new Object3D();
  const warm = new Color(pal.windowWarm);
  const cool = new Color(pal.windowCool);
  const radial = new Vector3();
  const tangent = new Vector3();
  const usable = buildings.filter((b) => b.width > 2 * s.windowMargin && b.height > 2 * s.windowMargin);

  for (let i = 0; i < s.windowCount; i++) {
    const b = usable[Math.floor(rand() * usable.length)];
    if (!b) break;
    radial.set(Math.sin(b.angle), 0, Math.cos(b.angle));
    tangent.set(Math.cos(b.angle), 0, -Math.sin(b.angle));
    const u = range(-b.width / 2 + s.windowMargin, b.width / 2 - s.windowMargin);
    const y = range(s.windowMargin, b.height - s.windowMargin);
    // um pouco à frente da fachada, virada para o centro
    dummy.position
      .copy(radial)
      .multiplyScalar(b.radius - b.depth / 2 - s.windowOffset)
      .addScaledVector(tangent, u)
      .setY(y);
    dummy.rotation.set(0, b.angle + Math.PI, 0);
    dummy.updateMatrix();
    windows.setMatrixAt(i, dummy.matrix);
    windows.setColorAt(i, rand() < s.windowWarmFraction ? warm : cool);
  }
  windows.instanceMatrix.needsUpdate = true;
  if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  windows.frustumCulled = false;
  group.add(windows);

  return group;
}
