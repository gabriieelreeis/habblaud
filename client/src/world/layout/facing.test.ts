import { describe, expect, it } from 'vitest';
import { FURNITURE } from '../../art/api';
import { roomTheme } from '../../art/theme';
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from './core';
import { layoutCorridor } from './corridor';
import { dirStep, furnitureFacing, opposite, touchedWalls, WALL_FACING } from './facing';
import { layoutProjectRoom } from './room';
import type { AreaLayout, FurniturePlacement } from './types';

const rooms: AreaLayout[] = [];
for (let seed = 0; seed < 48; seed++) rooms.push(layoutProjectRoom({ id: `sala${seed}`, slot: 4 + (seed % 4), seed: seed * 7919 + 13 }, roomTheme(seed)));
const areas: AreaLayout[] = [layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge(), layoutCorridor(5), ...rooms];

const center = (f: FurniturePlacement) => {
  const fp = FURNITURE[f.kind].footprint;
  return { x: f.tx + fp.w / 2 + (f.dx ?? 0) / 16, y: f.ty + fp.h / 2 + (f.dy ?? 0) / 16 };
};

/** Direção dominante de a até b. */
const toward = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
};

describe('direção dos móveis', () => {
  it('cadeira e mesa do mesmo posto ficam frente a frente (todas as salas)', () => {
    let n = 0;
    for (const a of rooms) {
      const byId = new Map(a.furniture.map((f) => [f.id, f]));
      for (const s of a.spots) {
        if (!s.deskId || !s.furnitureId) continue;
        const chair = byId.get(s.furnitureId)!;
        const desk = byId.get(s.deskId)!;
        const cf = furnitureFacing(a, chair);
        const df = furnitureFacing(a, desk);
        expect(cf, `${a.id} ${chair.kind}`).toBe(toward(center(chair), center(desk)));
        expect(df, `${a.id} ${desk.kind}`).toBe(opposite(cf));
        expect(s.dir).toBe(cf);
        n++;
      }
    }
    expect(n).toBeGreaterThan(48 * 6 - 1);
  });

  it('quem senta olha para onde o assento aponta', () => {
    for (const a of areas) {
      const byId = new Map(a.furniture.map((f) => [f.id, f]));
      for (const s of a.spots) {
        const f = s.furnitureId ? byId.get(s.furnitureId) : undefined;
        if (!s.seated || !f || f.kind === 'stool') continue;
        expect(furnitureFacing(a, f), `${a.id} ${f.kind}/${f.variant}`).toBe(s.dir);
      }
    }
  });

  it('cadeiras de café e poltronas olham para a mesa mais próxima', () => {
    for (const a of areas) {
      const tables = a.furniture.filter((f) => f.kind === 'cafe_table' || f.kind === 'meeting_table' || f.kind === 'coffee_table');
      for (const f of a.furniture) {
        if ((f.kind !== 'cafe_chair' && f.kind !== 'armchair') || !tables.length) continue;
        const c = center(f);
        const near = tables.map((t) => ({ t, d: Math.hypot(center(t).x - c.x, center(t).y - c.y) })).sort((p, q) => p.d - q.d)[0];
        if (near.d > 3) continue;
        const [sx, sy] = dirStep(furnitureFacing(a, f));
        const t = center(near.t);
        expect((t.x - c.x) * sx + (t.y - c.y) * sy, `${a.id} ${f.kind}/${f.variant}`).toBeGreaterThan(0);
      }
    }
  });

  it('móveis encostados na parede ficam de costas para ela', () => {
    let n = 0;
    for (const a of areas) {
      for (const f of a.furniture) {
        if (!WALL_FACING.has(f.kind)) continue;
        const walls = touchedWalls(a, f);
        if (!walls.length) continue;
        expect(walls, `${a.id} ${f.kind}`).toContain(opposite(furnitureFacing(a, f)));
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('estante de pastas na parede oeste vira para o leste, a da parede leste fica de costas', () => {
    const west = rooms.flatMap((a) => a.furniture.filter((f) => f.kind === 'binder_shelf' && touchedWalls(a, f)[0] === 'left').map((f) => furnitureFacing(a, f)));
    const east = rooms.flatMap((a) => a.furniture.filter((f) => f.kind === 'binder_shelf' && touchedWalls(a, f).join() === 'right').map((f) => furnitureFacing(a, f)));
    expect(west.length).toBeGreaterThan(0);
    expect(new Set(west)).toEqual(new Set(['right']));
    expect(new Set(east)).toEqual(new Set(['left']));
  });
});
