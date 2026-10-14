import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';
import { box } from './helpers';

describe('World.groundHeightAt', () => {
  const world = new World({
    size: 120,
    boxes: [box(0, 0, 2, 2, 0.3), box(0.5, 0, 1, 1, 0.5)],
  });

  it('retorna o topo da caixa sob o ponto', () => {
    expect(world.groundHeightAt(-0.8, 0, 10)).toBe(0.3);
  });

  it('retorna 0 fora das caixas', () => {
    expect(world.groundHeightAt(5, 5, 10)).toBe(0);
  });

  it('ignora caixas cujo topo está acima de maxTop', () => {
    expect(world.groundHeightAt(-0.8, 0, 0.05)).toBe(0);
  });

  it('com sobreposição, pega o maior topo válido', () => {
    expect(world.groundHeightAt(0.5, 0, 10)).toBe(0.5);
    expect(world.groundHeightAt(0.5, 0, 0.35)).toBe(0.3);
  });
});

describe('World.resolveCircleCollisions', () => {
  const world = new World({ size: 120, boxes: [box(0, 0, 2, 2, 0.5)] });
  const normal = new Vector3();

  it('empurra o círculo para fora da lateral', () => {
    const pos = new Vector3(0, 0, -1.1); // raio 0.3, face em z = -1
    expect(world.resolveCircleCollisions(pos, 0.3, 0.05, normal)).toBe(true);
    expect(pos.z).toBeCloseTo(-1.3, 9);
    expect(normal.z).toBeCloseTo(-1, 9);
  });

  it('ignora caixas que não são mais altas que o pé', () => {
    const pos = new Vector3(0, 0.5, -1.1);
    expect(world.resolveCircleCollisions(pos, 0.3, 0.55, normal)).toBe(false);
    expect(pos.z).toBe(-1.1);
  });

  it('centro dentro da caixa sai pelo eixo de menor penetração', () => {
    const pos = new Vector3(0.9, 0, 0.2);
    expect(world.resolveCircleCollisions(pos, 0.3, 0.05, normal)).toBe(true);
    expect(pos.x).toBeCloseTo(1.3, 9);
    expect(normal.x).toBeCloseTo(1, 9);
  });

  it('sem contato não mexe na posição', () => {
    const pos = new Vector3(0, 0, -2);
    expect(world.resolveCircleCollisions(pos, 0.3, 0.05, normal)).toBe(false);
    expect(pos.z).toBe(-2);
  });
});

describe('World.clampToBounds', () => {
  it('mantém dentro do mapa e zera só o eixo que bateu', () => {
    const world = new World({ size: 120, boxes: [] });
    const pos = new Vector3(61, 0, 10);
    const vel = new Vector3(5, 0, 3);
    world.clampToBounds(pos, vel, 0.3);
    expect(pos.x).toBeCloseTo(59.7, 9);
    expect(vel.x).toBe(0);
    expect(vel.z).toBe(3);
  });
});
