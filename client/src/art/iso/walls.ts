// Paredes isométricas (puras): face com o padrão do estilo, rodapé, tampa (espessura) e vãos de porta.
// A folha usa o kit (./kit.ts): footprint = comprimento x espessura; a face visível fica no lado de dentro.
import { TILE, type WallPattern, type WallStyle } from '../api';
import { mix, shade } from '../core/color';
import { capColor } from '../surfaces/walls';
import type { BufSprite } from '../core/sprite';
import { Iso } from './kit';

/** Altura do vão das portas (px). */
export const DOOR_H = 58;
const BASEBOARD = 4;

export interface IsoWallOpts {
  /** 'south': corre em x, face voltada para +y. 'east': corre em y, face voltada para +x. */
  facing: 'south' | 'east';
  /** Comprimento (px de mundo) e altura (px). */
  length: number;
  height: number;
  thickness: number;
  /** Vãos [início, fim) em px a partir do começo da parede. */
  doorways?: readonly (readonly [number, number])[];
  /** Variação de detalhes. */
  seed?: number;
}

function hashUV(u: number, v: number, seed: number): number {
  let h = (Math.imul(u | 0, 374761393) + Math.imul(v | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

/** Cor da face no ponto (u ao longo, v a partir do alto), para um estilo. */
export function wallShade(style: WallStyle, u: number, v: number, h: number, seed: number, dim: number): string | undefined {
  const base = shade(style.base, dim);
  const trim = shade(style.trim ?? shade(style.base, -0.16), dim);
  const z = h - v;
  if (z < BASEBOARD) return z >= BASEBOARD - 1 ? shade(trim, 0.08) : trim;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  // sombra logo abaixo da tampa e gradiente leve (mais claro em cima)
  if (iv === 0) return shade(base, -0.06);
  const grad = shade(base, 0.025 - (v / h) * 0.04);
  const pattern: WallPattern = style.pattern ?? 'plain';
  switch (pattern) {
    case 'stripes':
      return iu % 6 < 3 ? shade(grad, -0.03) : grad;
    case 'tiles': {
      const row = Math.floor((z - BASEBOARD) / 6);
      const off = row % 2 ? 4 : 0;
      if ((z - BASEBOARD) % 6 === 5 || (iu + off) % 8 === 7) return shade(base, -0.09);
      return (z - BASEBOARD) % 6 === 4 ? shade(grad, 0.03) : grad;
    }
    case 'wood_panel': {
      const top = Math.floor((h - BASEBOARD) * 0.42) + BASEBOARD;
      if (z < top) {
        const w = mix('#b98a5e', base, 0.15);
        if (z === top - 1) return shade(w, 0.12);
        if (iu % 5 === 0) return shade(w, -0.06);
        if (iu % 5 === 1) return shade(w, 0.04);
        return w;
      }
      if (z === top) return shade(base, -0.08);
      return grad;
    }
    case 'brick': {
      const row = Math.floor((z - BASEBOARD) / 5);
      const off = row % 2 ? 5 : 0;
      const mortar = mix(base, '#e9e4dc', 0.5);
      if ((z - BASEBOARD) % 5 === 4 || (iu + off) % 10 === 9) return mortar;
      const t = hashUV(Math.floor((iu + off) / 10), row, seed);
      return t < 0.25 ? shade(base, 0.035) : t > 0.8 ? shade(base, -0.04) : base;
    }
    case 'glass': {
      if (iu % 16 === 0 || iu % 16 === 15) return 'rgba(195,202,212,0.95)';
      const d = (iu + iv) % 23;
      if (d === 0) return 'rgba(255,255,255,0.4)';
      if (d === 1) return 'rgba(255,255,255,0.2)';
      return 'rgba(175,215,238,0.32)';
    }
    case 'marble': {
      const m = mix('#c9cdd3', base, 0.25);
      const vein = Math.abs(((iu * 0.7 + iv * 0.35 + hashUV(Math.floor(iu / 16), 0, seed) * 16) % 16) - 8);
      if (vein < 0.5) return 'rgba(120,126,138,0.55)';
      if (iu % 16 === 15) return shade(m, -0.06);
      return m;
    }
    default:
      if (style.exterior && hashUV(iu, iv, seed) < 0.05) return shade(grad, -0.03);
      return grad;
  }
}

function inDoor(doorways: IsoWallOpts['doorways'], u: number): readonly [number, number] | null {
  for (const d of doorways ?? []) if (u >= d[0] && u < d[1]) return d;
  return null;
}

/**
 * Parede do fundo (alta) ou da frente (baixa). Âncora no canto de trás do footprint: para 'south', (início, plano − espessura);
 * para 'east', (plano − espessura, início).
 */
export function renderIsoWall(style: WallStyle, o: IsoWallOpts): BufSprite {
  const L = o.length;
  const H = o.height;
  const T = o.thickness;
  const seed = o.seed ?? 0;
  const south = o.facing === 'south';
  const s = south ? new Iso(L / TILE, T / TILE, H + 4, 2) : new Iso(T / TILE, L / TILE, H + 4, 2);
  const dim = south ? 0 : -0.07;
  const cap = capColor(style);
  const doorTop = Math.min(DOOR_H, H);
  const face = (u: number, v: number, _w: number, h: number): string | undefined => {
    const d = inDoor(o.doorways, u);
    if (d && h - v < doorTop) return undefined;
    if (d && h - v < doorTop + 2) return shade(cap, -0.1);
    // batentes nas bordas do vão
    for (const dd of o.doorways ?? []) {
      if (h - v >= doorTop + 2) break;
      if (Math.floor(u) === dd[0] - 1 || Math.floor(u) === dd[1]) return shade(style.base, -0.14 + dim);
    }
    return wallShade(style, u, v, h, seed, dim);
  };
  const top = (u: number, v: number, w: number, h: number): string => {
    const along = south ? u : v;
    const across = south ? v : u;
    const len = south ? w : h;
    if (across < 1) return shade(cap, 0.1);
    if (along < 1 || along >= len - 1) return shade(cap, 0.04);
    return cap;
  };
  if (south) {
    // vão: o lado de dentro do batente oeste aparece pela porta
    for (const d of o.doorways ?? []) s.east(0, T, d[0], 0, doorTop, shade(style.base, -0.1));
    s.south(0, L, T, 0, H, face);
    s.top(0, 0, L, T, H, top);
  } else {
    for (const d of o.doorways ?? []) s.south(0, T, d[0], 0, doorTop, shade(style.base, -0.02));
    s.east(0, L, T, 0, H, face);
    s.top(0, 0, T, L, H, top);
  }
  return s.finish({ outline: false });
}

/** Mureta da frente (parede cortada): caixa baixa com tampa, sem padrão. */
export function renderLowWall(style: WallStyle, o: Omit<IsoWallOpts, 'facing'> & { along: 'x' | 'y' }): BufSprite {
  const L = o.length;
  const H = o.height;
  const T = o.thickness;
  const alongX = o.along === 'x';
  const s = alongX ? new Iso(L / TILE, T / TILE, H + 4, 2) : new Iso(T / TILE, L / TILE, H + 4, 2);
  const cap = capColor(style);
  const faceC = shade(style.base, -0.04);
  const trim = style.trim ?? shade(style.base, -0.16);
  const side = (_u: number, v: number, _w: number, h: number) => (h - v < 2 ? trim : v < 1 ? shade(faceC, 0.05) : faceC);
  const sideDk = (_u: number, v: number, _w: number, h: number) => (h - v < 2 ? shade(trim, -0.08) : shade(faceC, -0.08));
  const solid: [number, number][] = [];
  let a = 0;
  for (const d of [...(o.doorways ?? [])].sort((p, q) => p[0] - q[0])) {
    if (d[0] > a) solid.push([a, d[0]]);
    a = Math.max(a, d[1]);
  }
  if (a < L) solid.push([a, L]);
  for (const [p, q] of solid) {
    if (alongX) s.box(p, 0, 0, q, T, H, { top: shade(cap, 0.12), south: side, east: sideDk });
    else s.box(0, p, 0, T, q, H, { top: shade(cap, 0.12), south: side, east: sideDk });
  }
  return s.finish({ outline: false });
}
