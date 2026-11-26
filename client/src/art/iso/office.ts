// Móveis isométricos do escritório (puro). Convenções em ./kit.ts; a âncora é o canto de trás do footprint.
import { ramp, type Ramp } from '../core/color';
import type { BufFurniture } from '../core/sprite';
import { ACCENTS, M, rngOf, SCREEN_BG } from '../furniture/kit';
import { Iso, tone, type BoxMat } from './kit';

/** Alturas comuns (px). */
export const DESK_Z = 18;
export const SEAT_Z = 10;

interface DeskMats {
  top: Ramp;
  legs: Ramp;
  panel: Ramp;
}

function deskMats(variant: string | undefined): DeskMats {
  switch (variant) {
    case 'white':
      return { top: M.white, legs: M.steel, panel: ramp('#dcdbd6', 0.05) };
    case 'dark':
      return { top: M.walnut, legs: M.graphite, panel: ramp('#5a4334', 0.06) };
    default:
      return { top: M.oak, legs: ramp('#e9e8e4', 0.05), panel: ramp('#e6e4de', 0.05) };
  }
}

/** Tampo com a borda da frente mais escura (espessura) e veio leve. */
function topMat(m: Ramp): BoxMat {
  return {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : (Math.floor(u / 5) + Math.floor(v / 3)) % 7 === 0 ? m.base : m.lt),
    south: m.dk,
    east: m.dd,
  };
}

/** Corpo da mesa 2x1: tampo e painéis laterais. */
function deskBody(s: Iso, m: DeskMats): void {
  s.shadow(1, 1, 31, 15, 0.2);
  s.box(2, 2, 0, 4, 14, DESK_Z - 2, m.panel);
  s.box(28, 2, 0, 30, 14, DESK_Z - 2, m.panel);
  // painel de fundo (privacidade), recuado
  s.box(4, 3, 5, 28, 4, DESK_Z - 2, tone(m.panel.dk, 0.05));
  s.box(1, 1, DESK_Z - 2, 31, 15, DESK_Z, topMat(m.top));
}

/** Monitor com a tela voltada para o sul (para quem senta ao sul). */
function monitorSouth(s: Iso, x0: number, x1: number, y: number, name: 'screen' | 'screen2'): void {
  const z0 = DESK_Z;
  const cx = (x0 + x1) / 2;
  s.box(cx - 3, y - 3, z0, cx + 3, y + 1, z0 + 1, M.graphite);
  s.box(cx - 1, y - 2, z0, cx + 1, y - 1, z0 + 6, M.graphite);
  s.box(x0, y - 2, z0 + 5, x1, y, z0 + 17, { top: M.graphite.base, south: (u, v, w, h) => (u < 1 || u >= w - 1 || v < 1 || v >= h - 1 ? M.graphite.dk : SCREEN_BG), east: M.graphite.dd });
  s.southRect(name, x0 + 1, x1 - 1, y, z0 + 6, z0 + 16);
}

/** Monitor visto por trás (para a ilha face a face). */
function monitorBack(s: Iso, x0: number, x1: number, y: number): void {
  const z0 = DESK_Z;
  const cx = (x0 + x1) / 2;
  s.box(cx - 3, y - 1, z0, cx + 3, y + 3, z0 + 1, M.graphite);
  s.box(cx - 1, y + 1, z0, cx + 1, y + 2, z0 + 6, M.graphite);
  s.box(x0, y, z0 + 5, x1, y + 2, z0 + 17, { top: M.graphite.base, south: (u, v, w, h) => (Math.abs(u - w / 2) < 3 && Math.abs(v - h / 2) < 2 ? M.graphite.lt : M.graphite.base), east: M.graphite.dk });
}

function keyboard(s: Iso, x0: number, y0: number): void {
  s.box(x0, y0, DESK_Z, x0 + 11, y0 + 4, DESK_Z + 1, { top: (u, v) => ((u + v) % 2 === 0 ? '#d9dce2' : '#c3c8d0'), south: '#9aa0ab', east: '#8a909b' });
}

function mug(s: Iso, x: number, y: number, color: string): void {
  s.cyl(x, y, 1.6, DESK_Z, DESK_Z + 4, tone(color, 0.08), (u, v) => (u * u + v * v < 0.35 ? '#6b4226' : '#f4f2ee'));
}

function papers(s: Iso, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) s.box(x + i, y - i, DESK_Z + i * 0.5, x + 6 + i, y + 5 - i, DESK_Z + i * 0.5 + 0.5, { top: i % 2 ? '#f4f4ef' : '#ffffff', south: '#d6d6d0', east: '#c9c9c3' });
}

export function desk(variant: string | undefined, seed: number): BufFurniture {
  const m = deskMats(variant);
  const s = new Iso(2, 1, 44);
  deskBody(s, m);
  const r = rngOf(seed, 3);
  const dual = seed % 3 === 1;
  if (dual) {
    monitorSouth(s, 5, 15, 6, 'screen2');
    monitorSouth(s, 16, 27, 6, 'screen');
  } else monitorSouth(s, 9, 23, 6, 'screen');
  keyboard(s, 11, 9);
  mug(s, 26, 11, ACCENTS[Math.floor(r() * ACCENTS.length) % ACCENTS.length]);
  if (seed % 2 === 0) papers(s, 3, 9, 2);
  return { base: s.finish() };
}

export function deskBack(variant: string | undefined, seed: number): BufFurniture {
  const m = deskMats(variant);
  const s = new Iso(2, 1, 44);
  deskBody(s, m);
  monitorBack(s, 9, 23, 9);
  keyboard(s, 11, 4);
  if (seed % 2 === 0) papers(s, 24, 5, 2);
  else mug(s, 6, 6, ACCENTS[seed % ACCENTS.length]);
  return { base: s.finish() };
}

const CHAIR_COLORS: Readonly<Record<string, string>> = {
  black: '#41465a',
  blue: '#3f62a3',
  red: '#b44a4a',
  green: '#3f8a62',
  gray: '#8b929e',
};

function chairRamp(variant: string | undefined): Ramp {
  return ramp(CHAIR_COLORS[variant ?? 'black'] ?? CHAIR_COLORS.black, 0.07);
}

/** Base estrela, pistão e assento (comum às duas cadeiras de escritório). */
function chairSeat(s: Iso, c: Ramp): void {
  s.shadow(3, 3, 13, 13, 0.2, 0);
  const metal = tone('#5d6472', 0.08);
  for (const [dx, dy] of [
    [-5, 0],
    [5, 0],
    [0, -5],
    [0, 5],
  ] as const) {
    s.line([8, 8, 2], [8 + dx, 8 + dy, 1], metal.base);
    s.px(8 + dx, 8 + dy, 0, '#23262e');
  }
  s.cyl(8, 8, 1, 1, SEAT_Z - 2, tone('#a3aab6', 0.08));
  s.box(3, 3, SEAT_Z - 2, 13, 13, SEAT_Z, { top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? c.lt : c.base), south: c.dk, east: c.dd });
}

/** Encosto ao sul: quem senta olha para o norte (de costas para a câmera). O encosto é o `front`. */
export function officeChair(variant: string | undefined): BufFurniture {
  const c = chairRamp(variant);
  const s = new Iso(1, 1, 36);
  chairSeat(s, c);
  const f = new Iso(1, 1, 36);
  f.box(7, 11, SEAT_Z, 9, 13, SEAT_Z + 4, M.graphite);
  f.box(3, 12, SEAT_Z + 3, 13, 14, SEAT_Z + 16, { top: c.lt, south: (u, v, w, h) => (u < 1 || v >= h - 1 ? c.dk : v < 2 ? c.base : c.dk), east: c.dd });
  return { base: s.finish(), front: f.finish() };
}

/** Encosto ao norte: quem senta olha para o sul (de frente para a câmera). Tudo na base. */
export function officeChairFront(variant: string | undefined): BufFurniture {
  const c = chairRamp(variant);
  const s = new Iso(1, 1, 36);
  s.box(3, 2, SEAT_Z + 3, 13, 4, SEAT_Z + 17, { top: c.lt, south: (u, v, w, h) => (v < 1 || u < 1 ? c.lt : v >= h - 2 ? c.dk : c.base), east: c.dk });
  s.box(7, 3, SEAT_Z, 9, 5, SEAT_Z + 4, M.graphite);
  chairSeat(s, c);
  return { base: s.finish() };
}

/** Estante 2x1 encostada na parede norte, com livros coloridos na face sul. */
export function bookshelf(seed: number): BufFurniture {
  const w = M.oak;
  const s = new Iso(2, 1, 60);
  s.shadow(0, 2, 32, 14, 0.2);
  const H = 52;
  const shelves = [4, 17, 30, 43];
  const r = rngOf(seed, 11);
  const books: string[][] = shelves.map(() => {
    const row: string[] = [];
    for (let i = 0; i < 30; i++) row.push(r() < 0.12 ? '' : ACCENTS[Math.floor(r() * ACCENTS.length) % ACCENTS.length]);
    return row;
  });
  s.box(0, 2, 0, 32, 12, H, {
    top: w.lt,
    east: w.dk,
    south: (u, v, wd, h) => {
      if (u < 2 || u >= wd - 2 || v < 2 || v >= h - 1) return w.base;
      const z = h - v;
      for (let k = 0; k < shelves.length; k++) {
        const z0 = shelves[k];
        if (z >= z0 - 2 && z < z0) return w.dk;
        if (z >= z0 && z < z0 + 10) {
          const col = books[k][Math.floor(u / 2) % books[k].length];
          if (!col) return w.dd;
          if (z >= z0 + 8 + (Math.floor(u / 2) % 3 === 0 ? -2 : 0)) return w.dd;
          return u % 2 === 0 ? col : tone(col).dk;
        }
      }
      return w.dd;
    },
  });
  return { base: s.finish() };
}

/** Planta alta (palmeira, fícus, costela-de-adão, bonsai) num vaso. */
export function plantTall(variant: string | undefined, seed: number): BufFurniture {
  const s = new Iso(1, 1, 64);
  s.shadow(3, 3, 13, 13, 0.22, 0);
  const potM = variant === 'monstera' || variant === 'bonsai' ? M.ceramic : M.terracotta;
  s.cyl(8, 8, 4.5, 0, 11, potM, (u, v) => (u * u + v * v < 0.55 ? '#5b4030' : potM.lt));
  const leaf = M.leaf;
  const dark = M.leafDark;
  const r = rngOf(seed, 5);
  if (variant === 'bonsai') {
    s.line([8, 8, 11], [8, 8, 22], M.walnut.base, 2);
    s.blob(6, 9, 24, 7, 4, dark);
    s.blob(10, 7, 28, 6, 4, leaf);
    s.blob(7, 8, 31, 5, 3, leaf);
  } else if (variant === 'palm') {
    s.line([8, 8, 11], [8, 8, 34], M.oakDark.dk, 2);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r();
      s.blob(8 + Math.cos(a) * 6, 8 + Math.sin(a) * 6, 34 - (i % 3) * 3, 5, 2.5, i % 2 ? leaf : dark);
    }
    s.blob(8, 8, 37, 4, 3, leaf);
  } else {
    const g = variant === 'monstera' ? ramp('#3f8f4f', 0.09) : leaf;
    s.line([8, 8, 11], [8, 8, 30], M.walnut.dk, 1);
    s.blob(8, 9, 20, 8, 6, dark);
    s.blob(6, 7, 30, 8, 6, g);
    s.blob(10, 8, 26, 7, 5, g);
    s.blob(8, 8, 37, 6, 5, g);
  }
  return { base: s.finish() };
}
