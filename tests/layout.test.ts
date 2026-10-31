import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { collisionSolids, poleSolid, railSolid, railSolids } from '../src/sim/layout';

const world = CONFIG.world;
const rail = CONFIG.visual.rail;

describe('layout de colisão', () => {
  it('tudo que é visual e sólido vira AABB', () => {
    const railPieces = world.rails.reduce((n, r) => n + railSolids(r, world).length, 0);
    expect(collisionSolids(world)).toHaveLength(world.boxes.length + railPieces + world.poles.length);
  });

  it('o corrimão inteiro (tubo, curvas e postes) cabe dentro da AABB fina', () => {
    for (const r of world.rails.filter((rail) => rail.topEnd === undefined)) {
      const s = railSolid(r, world);
      const along = r.axis === 'x' ? s.sizeX : s.sizeZ;
      const across = r.axis === 'x' ? s.sizeZ : s.sizeX;
      expect(along / 2).toBeGreaterThanOrEqual(r.length / 2 + rail.tubeRadius);
      expect(across / 2).toBeGreaterThanOrEqual(Math.max(rail.tubeRadius, rail.postRadius));
      expect(s.height).toBe(r.top);
    }
  });

  it('a haste do poste cabe na AABB do poste', () => {
    for (const p of world.poles) {
      const s = poleSolid(p, world);
      expect(s.sizeX / 2).toBeGreaterThanOrEqual(CONFIG.visual.pole.shaftRadius);
      expect(s.height).toBe(world.poleHeight);
    }
  });

  it('nenhum sólido ocupa o spawn', () => {
    const solids = collisionSolids(world);
    for (const s of solids) {
      const dx = Math.abs(s.x - CONFIG.sim.spawnX) - s.sizeX / 2;
      const dz = Math.abs(s.z - CONFIG.sim.spawnZ) - s.sizeZ / 2;
      expect(Math.max(dx, dz)).toBeGreaterThan(CONFIG.sim.skaterRadius);
    }
  });
});
