import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { VisualConfig } from '../config';

type Ctx = CanvasRenderingContext2D;

function css(hex: number): string {
  return `#${new Color(hex).getHexString()}`;
}

/** PRNG determinístico (mulberry32): a mesma seed gera sempre a mesma textura. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, maxAnisotropy: number, repeat: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  if (repeat) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
  }
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Asfalto de estacionamento, um tile de `tileMeters`: metade esquerda são vagas (linhas ao longo
 * de X, linha de fundo na borda do tile), metade direita é corredor com faixa amarela tracejada
 * ao longo de Z. Desenhado para repetir sem emenda.
 */
export function createAsphaltTexture(visual: VisualConfig, maxAnisotropy: number): CanvasTexture {
  const g = visual.ground;
  const pal = visual.palette;
  const n = g.textureSize;
  const ppm = n / g.tileMeters;
  const rand = seededRandom(g.seed);
  const { canvas, ctx } = makeCanvas(n);

  ctx.fillStyle = css(pal.asphalt);
  ctx.fillRect(0, 0, n, n);

  const dark = css(pal.asphaltDark);
  const light = css(pal.asphaltLight);
  for (let i = 0; i < g.noiseDots; i++) {
    ctx.fillStyle = rand() < 0.5 ? dark : light;
    ctx.fillRect(Math.floor(rand() * n), Math.floor(rand() * n), 1, 1);
  }
  ctx.fillStyle = css(pal.asphaltGrain);
  for (let i = 0; i < g.grains; i++) {
    ctx.fillRect(Math.floor(rand() * n), Math.floor(rand() * n), g.grainPx, g.grainPx);
  }

  // manchas de óleo dentro das vagas, longe das bordas do tile
  const half = n / 2;
  const rx = g.oilRadiusX * ppm;
  const rz = g.oilRadiusZ * ppm;
  ctx.fillStyle = css(pal.oil);
  ctx.globalAlpha = g.oilAlpha;
  for (let i = 0; i < g.oilStains; i++) {
    const x = rx + rand() * (half - 2 * rx);
    const y = rz + rand() * (n - 2 * rz);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rz, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // linhas: retângulos [x, y, w, h] em px, guardados para o desgaste depois
  const lines: { rect: [number, number, number, number]; color: string }[] = [];
  const lw = g.lineWidth * ppm;
  const stall = css(pal.stallLine);
  // linha de fundo das vagas na borda do tile (metade de cada lado, para emendar)
  lines.push({ rect: [0, 0, lw / 2, n], color: stall });
  lines.push({ rect: [n - lw / 2, 0, lw / 2, n], color: stall });
  const stallsPerTile = Math.round(g.tileMeters / g.stallSpacing);
  for (let k = 0; k < stallsPerTile; k++) {
    const y = k * g.stallSpacing * ppm;
    if (k === 0) {
      lines.push({ rect: [0, 0, g.stallLength * ppm, lw / 2], color: stall });
      lines.push({ rect: [0, n - lw / 2, g.stallLength * ppm, lw / 2], color: stall });
    } else {
      lines.push({ rect: [0, y - lw / 2, g.stallLength * ppm, lw], color: stall });
    }
  }
  // faixa amarela tracejada no meio do corredor
  const lane = css(pal.laneLine);
  const laneX = (half + n) / 2 - (g.laneWidth * ppm) / 2;
  const period = (g.dashLength + g.dashGap) * ppm;
  for (let y = 0; y < n; y += period) {
    lines.push({ rect: [laneX, y, g.laneWidth * ppm, g.dashLength * ppm], color: lane });
  }

  for (const l of lines) {
    ctx.fillStyle = l.color;
    ctx.fillRect(...l.rect);
  }

  // desgaste: pontos da cor do asfalto sobre ~wearFraction do comprimento das linhas
  ctx.fillStyle = css(pal.asphalt);
  ctx.globalAlpha = g.wearAlpha;
  const dot = g.wearDotPx;
  for (const { rect } of lines) {
    const [x, y, w, h] = rect;
    const length = Math.max(w, h);
    const count = Math.round((length * g.wearFraction) / dot) * 2;
    for (let i = 0; i < count; i++) {
      ctx.fillRect(x + rand() * w - dot / 2, y + rand() * h - dot / 2, dot, dot);
    }
  }
  ctx.globalAlpha = 1;

  return toTexture(canvas, maxAnisotropy, true);
}

export interface LightPool {
  x: number;
  z: number;
}

/**
 * LightMap das poças de luz de sódio cobrindo o chão inteiro (uv 0..1 = mapa todo).
 * u = 0 em x = −size/2; v = 0 em z = +size/2 (o plano é girado −90° em X).
 */
export function createLightPoolTexture(visual: VisualConfig, mapSize: number, pools: readonly LightPool[]): CanvasTexture {
  const l = visual.lights;
  const n = l.lightMapSize;
  const { canvas, ctx } = makeCanvas(n);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, n, n);

  const ppm = n / mapSize;
  const r = l.poolRadius * ppm;

  // queda suave em espaço linear (a textura é decodificada de sRGB no shader)
  const lamp = new Color(visual.palette.lampLight);
  const stop = new Color();
  const stops: [number, string][] = [];
  for (let i = 0; i <= l.poolStops; i++) {
    const t = i / l.poolStops;
    stops.push([t, `#${stop.copy(lamp).multiplyScalar((1 - t) ** l.poolFalloff).getHexString()}`]);
  }

  // poças vizinhas somam luz
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pools) {
    const cx = (p.x + mapSize / 2) * ppm;
    const cy = (p.z + mapSize / 2) * ppm;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [t, color] of stops) grad.addColorStop(t, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  return toTexture(canvas, 1, false);
}

/** Tela de alambrado (losangos) em branco sobre transparente; a cor vem do material. */
export function createFenceTexture(visual: VisualConfig, maxAnisotropy: number): CanvasTexture {
  const f = visual.fence;
  const n = f.textureSize;
  const { canvas, ctx } = makeCanvas(n);
  const cells = Math.round(f.textureMeters / f.cellMeters);
  const step = n / cells;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = f.wirePx;
  ctx.beginPath();
  for (let k = -cells; k <= 2 * cells; k++) {
    ctx.moveTo(k * step, 0);
    ctx.lineTo(k * step + n, n);
    ctx.moveTo(k * step, 0);
    ctx.lineTo(k * step - n, n);
  }
  ctx.stroke();

  return toTexture(canvas, maxAnisotropy, true);
}

/** Grid de debug (o chão da v0.1), atrás de uma flag na lil-gui. */
export function createGridTexture(visual: VisualConfig, maxAnisotropy: number): Texture {
  const cfg = visual.gridDebug;
  const n = cfg.textureSize;
  const { canvas, ctx } = makeCanvas(n);

  const half = n / 2;
  ctx.fillStyle = css(cfg.colorA);
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = css(cfg.colorB);
  ctx.fillRect(half, 0, half, half);
  ctx.fillRect(0, half, half, half);

  const pxPerMeter = n / cfg.tileMeters;
  const line = (pos: number, width: number): void => {
    ctx.fillRect(pos - width / 2, 0, width, n);
    ctx.fillRect(0, pos - width / 2, n, width);
  };

  ctx.fillStyle = css(cfg.minorLineColor);
  for (let m = 1; m < cfg.tileMeters; m++) line(m * pxPerMeter, cfg.minorLineWidth);

  ctx.fillStyle = css(cfg.majorLineColor);
  line(0, cfg.majorLineWidth);
  line(n, cfg.majorLineWidth);
  line(half, cfg.majorLineWidth);

  return toTexture(canvas, maxAnisotropy, true);
}
