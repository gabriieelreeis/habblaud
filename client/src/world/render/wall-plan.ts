// Onde fica cada parede de uma área no plano isométrico e como pintá-la. Puro: usado pelo renderizador e pelos testes
// da camada estática.
import { TILE, type IsoWallSpec } from '../../art/api';
import { LOW_WALL_H, WALL_H, WALL_T, type WallPlane } from '../iso';
import type { AreaLayout, WallSegment } from '../layout/types';

export interface WallPlan {
  seg: WallSegment;
  plane: WallPlane;
  spec: IsoWallSpec;
  /** Espessura da caixa de cada fatia (px de mundo). */
  thick: number;
  /** Parede alta do fundo; senão, mureta baixa. */
  tall: boolean;
}

function doorsOf(seg: { x: number; w: number; doorways?: { x: number; w: number }[] }): [number, number][] {
  return (seg.doorways ?? []).map((d) => [d.x - seg.x, d.x - seg.x + d.w]);
}

/**
 * Paredes de uma área: a face do fundo e a lateral oeste ficam altas; a frente (sul), a lateral leste e as divisórias
 * viram mureta baixa, para dar para ver dentro.
 */
export function wallPlan(layout: AreaLayout): WallPlan[] {
  const r = layout.rect;
  const centerX = (r.x + r.w / 2) * TILE;
  const faceTop = Math.min(...layout.walls.filter((w) => w.kind === 'face').map((w) => w.y + 2 * TILE), Infinity);
  const out: WallPlan[] = [];
  for (const seg of layout.walls) {
    if (seg.kind === 'face') {
      const plane: WallPlane = { facing: 'south', at: seg.y + 2 * TILE, a0: seg.x, a1: seg.x + seg.w };
      out.push({ seg, plane, spec: { facing: 'south', length: seg.w, height: WALL_H, thickness: WALL_T, doorways: doorsOf(seg), seed: Math.round(seg.x) }, thick: WALL_T, tall: true });
    } else if (seg.kind === 'south') {
      const plane: WallPlane = { facing: 'south', at: seg.y + TILE / 2 + 2, a0: seg.x, a1: seg.x + seg.w };
      out.push({ seg, plane, spec: { facing: 'south', low: true, length: seg.w, height: LOW_WALL_H, thickness: 4, doorways: doorsOf(seg) }, thick: 4, tall: false });
    } else if (seg.h >= seg.w) {
      // lateral: a oeste vira parede alta voltada para leste; a leste, mureta baixa
      const west = seg.x + seg.w / 2 < centerX;
      const y0 = west && Number.isFinite(faceTop) ? Math.max(seg.y, faceTop - WALL_T) : seg.y;
      const y1 = seg.y + seg.h;
      if (y1 - y0 < 2) continue;
      if (west) {
        const plane: WallPlane = { facing: 'east', at: seg.x + seg.w, a0: y0, a1: y1 };
        out.push({ seg, plane, spec: { facing: 'east', length: y1 - y0, height: WALL_H, thickness: seg.w, seed: Math.round(seg.x) }, thick: seg.w, tall: true });
      } else {
        const plane: WallPlane = { facing: 'east', at: seg.x + seg.w / 2 + 2, a0: y0, a1: y1 };
        out.push({ seg, plane, spec: { facing: 'east', low: true, length: y1 - y0, height: LOW_WALL_H, thickness: 4 }, thick: 4, tall: false });
      }
    } else {
      const plane: WallPlane = { facing: 'south', at: seg.y + seg.h / 2 + 2, a0: seg.x, a1: seg.x + seg.w };
      out.push({ seg, plane, spec: { facing: 'south', low: true, length: seg.w, height: LOW_WALL_H, thickness: 4 }, thick: 4, tall: false });
    }
  }
  return out;
}
