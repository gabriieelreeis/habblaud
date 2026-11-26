// Móveis isométricos (puro). Convenções em ./kit.ts; a âncora é o canto de trás do footprint.
import type { FurnitureKind } from '../api';
import { ramp, type Ramp } from '../core/color';
import type { BufFurniture } from '../core/sprite';
import { ACCENTS, M, rngOf, SCREEN_BG } from '../furniture/kit';
import { Iso, tone, type BoxMat } from './kit';
import { DESK_Z, SEAT_Z } from './office';

const DARK = '#2b2f3a';

/** Tampo com a aresta da frente brilhante. */
function slab(m: Ramp): BoxMat {
  return {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : (Math.floor(u / 6) + Math.floor(v / 4)) % 7 === 0 ? m.base : m.lt),
    south: m.dk,
    east: m.dd,
  };
}

function filingCabinet(): BufFurniture {
  const s = new Iso(1, 1, 34);
  s.shadow(2, 2, 14, 14, 0.2, 1);
  const m = M.steel;
  const H = 22;
  const dh = H / 3;
  s.box(3, 3, 0, 13, 13, H, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : m.lt),
    east: (u, v, w, h) => (v < 1 ? m.base : v >= h - 1 ? m.dd : m.dk),
    south: (u, v, w, h) => {
      const z = h - v;
      const k = Math.min(2, Math.floor(z / dh));
      const dz = z - k * dh;
      if (u < 1 || u >= w - 1 || dz < 1 || v < 1) return m.dk;
      if (dz >= dh - 1.5) return m.hi;
      // puxador
      if (Math.abs(u - w / 2) < 2.5 && dz >= dh * 0.55 && dz < dh * 0.55 + 1.2) return DARK;
      // etiqueta
      if (Math.abs(u - w / 2) < 2 && dz >= dh * 0.75 && dz < dh * 0.75 + 1.2) return '#f4f2ea';
      return m.base;
    },
  });
  return { base: s.finish() };
}

function printer(): BufFurniture {
  const s = new Iso(1, 1, 36);
  s.shadow(1, 2, 15, 15, 0.2, 1);
  // móvel baixo
  s.box(2, 3, 0, 14, 13, 10, {
    top: M.white.lt,
    east: M.white.dk,
    south: (u, v, w, h) => (u < 1 || u >= w - 1 || v >= h - 1 ? M.white.dk : v < 1 ? M.white.hi : u > w - 5 && v > 3 && v < 6 ? M.walnut.base : M.white.base),
  });
  // corpo da impressora
  const pm = ramp('#d5d8de', 0.05);
  s.box(2, 4, 10, 14, 12, 17, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? pm.hi : pm.lt),
    east: pm.dk,
    south: (u, v, w, h) => {
      if (v < 1) return pm.hi;
      if (u >= 2 && u < 7 && v >= 2.5 && v < 4.5) return '#3f7fd8';
      if (u >= 9 && u < w - 2 && v >= h - 3 && v < h - 1.5) return DARK;
      return v >= h - 1 ? pm.dk : pm.base;
    },
  });
  // tampa e papel de entrada (atrás)
  s.box(4, 4, 17, 12, 6, 22, { top: '#ffffff', south: '#e4e4de', east: '#cfcfc9' });
  s.box(3, 6, 17, 13, 11, 18, { top: pm.hi, south: pm.base, east: pm.dk });
  // bandeja de saída com papel
  s.box(4, 12, 12, 12, 15, 13, { top: '#f6f6f1', south: '#cfcfc9', east: '#bdbdb7' });
  s.box(5, 12, 13, 11, 14, 13.6, { top: '#ffffff', south: '#dededa', east: '#cacac4' });
  return { base: s.finish() };
}

function trashBin(): BufFurniture {
  const s = new Iso(1, 1, 18);
  s.shadow(4, 4, 12, 12, 0.2, 0);
  const m = tone('#5f6978', 0.08);
  s.cyl(8, 8, 3.4, 0, 9, m, (u, v) => (u * u + v * v < 0.5 ? '#232730' : m.hi));
  s.px(7, 9, 9, '#f4f2ee');
  s.px(9, 8, 9, '#e8e6e0');
  s.px(8, 8, 8.5, '#d5d8de');
  return { base: s.finish() };
}

function plantSmall(variant: string | undefined, seed: number): BufFurniture {
  const s = new Iso(1, 1, 30);
  s.shadow(4, 4, 12, 12, 0.2, 0);
  const r = rngOf(seed, 9);
  const potM = variant === 'succulent' ? M.ceramic : M.terracotta;
  s.cyl(8, 8, 3.8, 0, 6, potM, (u, v) => (u * u + v * v < 0.6 ? '#5b4030' : potM.lt));
  if (variant === 'succulent') {
    const g = ramp('#5fae7e', 0.08);
    s.blob(8, 8, 7, 3.5, 2, g);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + seed;
      s.blob(8 + Math.cos(a) * 3, 8 + Math.sin(a) * 3, 8 + (i % 2), 2.6, 1.8, i % 2 ? g : M.leaf);
    }
    s.blob(8, 8, 10, 2.6, 2, g);
    if (seed % 2 === 1) s.px(8, 8, 12, '#e47aa8');
  } else if (variant === 'flower') {
    const colors = ['#e05a5a', '#f2c14e', '#e47aa8'];
    const c = colors[seed % colors.length];
    s.blob(8, 8, 8, 5, 2.5, M.leafDark);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      const fx = 8 + Math.cos(a) * 3;
      const fy = 8 + Math.sin(a) * 3;
      const fz = 12 + (i % 3) * 2;
      s.line([8, 8, 6], [fx, fy, fz], M.leaf.base);
      s.blob(fx, fy, fz + 1, 2.2, 1.8, tone(c, 0.08));
      s.px(fx, fy, fz + 1, '#f9e27a');
    }
  } else {
    // samambaia: frondes arqueadas
    s.blob(8, 8, 8, 4, 2.5, M.leafDark);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r();
      const d = 4 + (i % 2);
      s.blob(8 + Math.cos(a) * d, 8 + Math.sin(a) * d, 9 + (i % 3) * 2, 4, 1.8, i % 2 ? M.leaf : M.leafDark);
    }
    s.blob(8, 8, 14, 3.5, 3, M.leaf);
  }
  return { base: s.finish() };
}

const GLASS = 'rgba(150,205,235,0.34)';
const GLASS_EDGE = 'rgba(205,240,255,0.7)';
const GLASS_SHINE = 'rgba(255,255,255,0.42)';
const HALF = 10;
const GLASS_TOP = 34;

function glassPartition(variant: string | undefined): BufFurniture {
  const s = new Iso(1, 1, 44);
  s.shadow(variant === 'v' ? 6 : 0, variant === 'v' ? 0 : 6, variant === 'v' ? 10 : 16, variant === 'v' ? 16 : 10, 0.16, 0);
  const wm = M.white;
  const shine = (u: number, v: number, h: number): boolean => (u * 1 + (h - v) * 0.9 + 100) % 11 < 2 && (h - v) > 3 && v > 2;
  if (variant === 'end') {
    s.box(5, 5, 0, 11, 11, HALF, wm);
    s.box(6, 6, HALF, 10, 10, GLASS_TOP, { top: M.steel.hi, south: (u, v) => (u < 1 ? M.steel.hi : M.steel.base), east: M.steel.dk });
    return { base: s.finish() };
  }
  if (variant === 'v') {
    s.box(7, 0, 0, 9, 16, HALF, wm);
    // vidro no plano x = 9 (face leste), com a ponta sul visível
    s.east(0, 16, 9, HALF, GLASS_TOP, (u, v, w, h) => (u < 0.7 || u >= w - 0.7 || v < 1 ? GLASS_EDGE : shine(u, v, h) ? GLASS_SHINE : GLASS));
    s.east(0, 16, 7, HALF, GLASS_TOP, GLASS);
    s.south(7, 9, 16, HALF, GLASS_TOP, GLASS_EDGE);
    s.top(7, 0, 9, 16, GLASS_TOP, M.steel.hi);
    s.box(7, 0, GLASS_TOP, 9, 16, GLASS_TOP + 1.5, M.steel);
    return { base: s.finish() };
  }
  s.box(0, 7, 0, 16, 9, HALF, wm);
  s.south(0, 16, 9, HALF, GLASS_TOP, (u, v, w, h) => (u < 0.7 || u >= w - 0.7 || v < 1 ? GLASS_EDGE : shine(u, v, h) ? GLASS_SHINE : GLASS));
  s.east(7, 9, 16, HALF, GLASS_TOP, GLASS_EDGE);
  s.box(0, 7, GLASS_TOP, 16, 9, GLASS_TOP + 1.5, M.steel);
  return { base: s.finish() };
}

function binderShelf(seed: number): BufFurniture {
  const s = new Iso(1, 1, 62);
  s.shadow(2, 3, 14, 14, 0.2, 1);
  const w = M.white;
  const H = 52;
  const shelves = [3, 15, 27, 39];
  const r = rngOf(seed, 21);
  const pal = ['#3f7fd8', '#ec8a3c', '#4cae6a'];
  // por prateleira: 'b' = pastas, 'x' = caixas, 'm' = misto
  const kinds = shelves.map((_, i) => ((seed + i) % 3 === 1 ? 'x' : (seed + i) % 3 === 2 ? 'm' : 'b'));
  const cols: string[][] = shelves.map((_, i) => {
    const row: string[] = [];
    let c = pal[(seed + i) % pal.length];
    for (let k = 0; k < 12; k++) {
      if (r() < 0.35) c = pal[Math.floor(r() * pal.length)];
      row.push(c);
    }
    return row;
  });
  s.box(3, 4, 0, 13, 12, H, {
    top: (u, v, wd, h) => (v >= h - 1 || u >= wd - 1 ? w.hi : w.lt),
    east: (u, v) => (u < 1 || v < 1 ? w.base : w.dk),
    south: (u, v, wd, h) => {
      if (u < 1 || u >= wd - 1 || v < 1) return w.base;
      const z = h - v;
      for (let k = 0; k < shelves.length; k++) {
        const z0 = shelves[k];
        if (z >= z0 - 1.5 && z < z0) return w.dk;
        if (z >= z0 && z < z0 + 11) {
          const hz = z - z0;
          const kind = kinds[k];
          const x = Math.floor(u) - 1;
          if (kind === 'x' || (kind === 'm' && x >= 4)) {
            // caixas de papelão com etiqueta
            const bx = (x - (kind === 'm' ? 4 : 0)) % 4;
            if (hz >= 9) return w.dd;
            if (bx === 3) return M.cardboard.dk;
            if (hz >= 4 && hz < 6.5 && bx > 0 && bx < 3) return '#f4f2ea';
            return hz >= 8 ? M.cardboard.lt : M.cardboard.base;
          }
          const col = cols[k][x % cols[k].length];
          if (hz >= 10 - (x % 3 === 0 ? 1.5 : 0)) return w.dd;
          if (hz >= 4 && hz < 6.5 && x % 2 === 0) return '#f4f2ea';
          return x % 2 === 0 ? col : tone(col, 0.09).dk;
        }
      }
      return w.dd;
    },
  });
  return { base: s.finish() };
}

function meetingTable(seed: number): BufFurniture {
  const s = new Iso(3, 2, 44);
  s.shadow(2, 2, 46, 30, 0.2, 1);
  const metal = M.steel;
  const T = DESK_Z;
  for (const [x, y] of [
    [6, 6],
    [40, 6],
    [6, 25],
    [40, 25],
  ] as const) {
    s.box(x, y, 0, x + 3, y + 3, T - 2, metal);
  }
  s.box(2, 2, T - 2, 46, 30, T, slab(M.oak));
  // objetos sobre o tampo
  const paper = (x: number, y: number, n: number): void => {
    for (let i = 0; i < n; i++) s.box(x + i * 0.7, y - i * 0.5, T + i * 0.6, x + 7 + i * 0.7, y + 5 - i * 0.5, T + i * 0.6 + 0.6, { top: i % 2 ? '#f4f4ef' : '#ffffff', south: '#d6d6d0', east: '#c9c9c3' });
  };
  const cup = (x: number, y: number, c: string): void => s.cyl(x, y, 1.6, T, T + 4, tone(c, 0.08), (u, v) => (u * u + v * v < 0.35 ? '#6b4226' : '#f4f2ee'));
  const laptop = (x: number, y: number): void => {
    s.box(x, y, T, x + 11, y + 8, T + 1, { top: '#cfd3da', south: '#9aa0ab', east: '#848a95' });
    s.box(x, y, T + 1, x + 11, y + 1.5, T + 9, { top: M.graphite.lt, south: (u, v, w, h) => (u < 1 || u >= w - 1 || v < 1 || v >= h - 1 ? M.graphite.dk : SCREEN_BG), east: M.graphite.dd });
  };
  if (seed % 2 === 0) {
    laptop(10, 8);
    paper(26, 8, 3);
    paper(14, 21, 2);
    cup(34, 20, ACCENTS[0]);
    cup(22, 14, ACCENTS[1]);
  } else {
    paper(8, 10, 2);
    laptop(28, 18);
    paper(30, 7, 3);
    cup(20, 21, ACCENTS[3]);
    cup(39, 11, ACCENTS[5]);
    cup(18, 12, ACCENTS[2]);
  }
  return { base: s.finish() };
}

function stool(): BufFurniture {
  const s = new Iso(1, 1, 24);
  s.shadow(3, 3, 13, 13, 0.2, 0);
  const metal = tone('#5d6472', 0.08);
  for (const [x, y, fx, fy] of [
    [5.5, 5.5, 4, 4],
    [10.5, 5.5, 12, 4],
    [5.5, 10.5, 4, 12],
    [10.5, 10.5, 12, 12],
  ] as const) {
    s.line([x, y, SEAT_Z], [fx, fy, 0.5], metal.base);
    s.px(fx, fy, 0, DARK);
  }
  s.line([4.6, 4.6, 4], [11.4, 4.6, 4], metal.dk);
  s.line([4.6, 11.4, 4], [11.4, 11.4, 4], metal.base);
  const c = tone('#3f62a3', 0.07);
  s.cyl(8, 8, 5, SEAT_Z, SEAT_Z + 2, c, (u, v) => (u * u + v * v < 0.6 ? c.hi : c.lt));
  return { base: s.finish() };
}

function floorLamp(): BufFurniture {
  const s = new Iso(1, 1, 58);
  s.shadow(4, 4, 12, 12, 0.2, 0);
  const metal = tone('#6d7583', 0.08);
  s.cyl(8, 8, 3.4, 0, 1.5, tone('#3a3f4c', 0.07));
  s.line([8, 8, 1.5], [8, 8, 38], metal.base);
  s.line([9, 8, 3], [9, 8, 36], metal.dk);
  const sh = ramp('#f2e3b6', 0.06);
  s.cyl(8, 8, 4.6, 37, 46, sh, (u, v) => (u * u + v * v < 0.5 ? '#fff6d0' : sh.hi));
  s.px(8, 8, 36.5, '#fff6d0');
  const gx = Math.floor(s.sx(8, 8)) - 4;
  const gy = Math.floor(s.sy(8, 8, 46)) - 1;
  s.rects.glow = { x: gx, y: gy, w: 8, h: 8 };
  return { base: s.finish() };
}

function waterCooler(): BufFurniture {
  const s = new Iso(1, 1, 46);
  s.shadow(2, 2, 14, 14, 0.2, 1);
  const w = ramp('#e1e4ea', 0.05);
  s.box(3, 3, 0, 13, 13, 22, {
    top: (u, v, wd, h) => (v >= h - 1 || u >= wd - 1 ? w.hi : w.lt),
    east: (u, v) => (v < 1 ? w.base : w.dk),
    south: (u, v, wd, h) => {
      const z = h - v;
      if (v < 1) return w.hi;
      if (u < 1 || u >= wd - 1) return w.dk;
      // torneiras azul e vermelha, bandeja
      if (z >= 12 && z < 14.5 && u >= 2.5 && u < 4.5) return '#3f7fd8';
      if (z >= 12 && z < 14.5 && u >= 5.5 && u < 7.5) return '#d84a4a';
      if (z >= 9 && z < 11 && u >= 2 && u < wd - 2) return '#7b8494';
      if (z < 3) return w.dk;
      return w.base;
    },
  });
  // bandeja de gotejamento
  s.box(4, 13, 9, 12, 14.5, 10, { top: '#a0a8b6', south: '#6d7583', east: '#565d6b' });
  s.box(3, 3, 22, 13, 13, 24, { top: w.hi, south: w.dk, east: w.dd });
  // galão translúcido
  const wt = {
    hi: 'rgba(215,238,255,0.8)',
    lt: 'rgba(130,190,240,0.72)',
    base: 'rgba(85,155,230,0.72)',
    dk: 'rgba(60,120,205,0.74)',
    dd: 'rgba(45,95,175,0.76)',
  };
  s.cyl(8, 8, 4.4, 24, 33, wt, (u, v) => (u * u + v * v < 0.7 ? 'rgba(150,205,250,0.8)' : wt.hi));
  s.cyl(8, 8, 1.8, 33, 35, tone('#d6e6f5', 0.06));
  s.px(6, 8, 30, 'rgba(255,255,255,0.8)');
  s.px(6, 8, 28, 'rgba(255,255,255,0.7)');
  return { base: s.finish() };
}

/** Desenho isométrico de um kind deste grupo, ou null se o kind não é daqui. */
export function officeMore(kind: FurnitureKind, variant: string | undefined, state: number, seed: number): BufFurniture | null {
  void state;
  switch (kind) {
    case 'filing_cabinet':
      return filingCabinet();
    case 'printer':
      return printer();
    case 'trash_bin':
      return trashBin();
    case 'plant_small':
      return plantSmall(variant, seed);
    case 'glass_partition':
      return glassPartition(variant);
    case 'binder_shelf':
      return binderShelf(seed);
    case 'meeting_table':
      return meetingTable(seed);
    case 'stool':
      return stool();
    case 'floor_lamp':
      return floorLamp();
    case 'water_cooler':
      return waterCooler();
    default:
      return null;
  }
}
