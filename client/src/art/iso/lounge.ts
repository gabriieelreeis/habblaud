// Móveis isométricos de convivência (puro). Convenções em ./kit.ts; a âncora é o canto de trás do footprint.
import type { FurnitureKind } from '../api';
import { ramp, type Ramp } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufFurniture } from '../core/sprite';
import { ACCENTS, M, rngOf, SCREEN_BG } from '../furniture/kit';
import { Iso, tone, type BoxMat } from './kit';
import { SEAT_Z } from './office';

const FABRIC = ramp('#5f7fa6', 0.06);
const FABRIC_DK = ramp('#4f6f96', 0.065);
const CUSHION = ramp('#ec8a3c', 0.07);
const LEG = ramp('#4a3a30', 0.06);

/** Tecido: topo claro com a aresta da frente brilhante, sul e leste em tons mais escuros. */
function fabric(m: Ramp): BoxMat {
  return {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : m.lt),
    south: (_u, v, _w, h) => (v < 1 ? m.lt : v >= h - 1 ? m.dk : m.base),
    east: (_u, v) => (v < 1 ? m.base : m.dk),
  };
}

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Sofá 3x1; cada tile é um lugar. Vai no front tudo o que fica ao sul ou ao leste de quem senta: o braço leste e, olhando
 * para o norte, o encosto.
 */
export function sofa(variant: string | undefined): BufFurniture {
  const front = variant === 'up';
  const s = new Iso(3, 1, 40);
  const f = new Iso(3, 1, 40);
  s.shadow(0, 1, 48, 15, 0.22);
  for (const x of [2, 43]) {
    s.box(x, 2, 0, x + 3, 4, 3, LEG);
    s.box(x, 12, 0, x + 3, 14, 3, LEG);
  }
  const arm = (t: Iso, x0: number, x1: number): void => {
    t.box(x0, 1, 3, x1, 15, 17, fabric(FABRIC_DK));
    t.box(x0, 1, 17, x1, 15, 18, { top: FABRIC.hi, south: FABRIC.lt, east: FABRIC.base });
  };
  if (!front) {
    s.box(5, 1, 3, 43, 5, 22, fabric(FABRIC));
    s.box(5, 5, 3, 43, 15, SEAT_Z - 1, fabric(FABRIC_DK));
    for (let i = 0; i < 3; i++) s.box(5 + i * 12.67, 5, SEAT_Z - 1, 5 + (i + 1) * 12.67 - 0.5, 15, SEAT_Z, fabric(FABRIC));
    s.box(8, 5, SEAT_Z, 15, 9, SEAT_Z + 8, fabric(CUSHION));
    s.box(34, 5, SEAT_Z, 41, 9, SEAT_Z + 8, fabric(CUSHION));
    arm(s, 0, 5);
    arm(f, 43, 48);
    return { base: s.finish(), front: f.finish() };
  }
  s.box(5, 1, 3, 43, 11, SEAT_Z - 1, fabric(FABRIC_DK));
  for (let i = 0; i < 3; i++) s.box(5 + i * 12.67, 1, SEAT_Z - 1, 5 + (i + 1) * 12.67 - 0.5, 11, SEAT_Z, fabric(FABRIC));
  arm(s, 0, 5);
  f.box(5, 11, 3, 43, 15, 22, fabric(FABRIC));
  arm(f, 43, 48);
  return { base: s.finish(), front: f.finish() };
}

/**
 * Poltrona; a variante é para onde quem senta olha. Vai no front o que fica ao sul ou ao leste do quadril: o encosto ao
 * sul ('up') ou ao leste ('left') e o braço leste ('up', 'down') ou sul ('left', 'right').
 */
export function armchair(variant: string | undefined): BufFurniture {
  const dir = (variant ?? 'down') as Dir;
  const s = new Iso(1, 1, 36);
  const f = new Iso(1, 1, 36);
  s.shadow(1, 1, 15, 15, 0.2, 1);
  for (const [x, y] of [[2, 2], [12, 2], [2, 12], [12, 12]] as const) s.box(x, y, 0, x + 2, y + 2, 3, LEG);
  if (dir === 'down') {
    s.box(2, 1, 3, 14, 5, 22, fabric(FABRIC));
    s.box(2, 5, 3, 14, 14, SEAT_Z - 1, fabric(FABRIC_DK));
    s.box(3, 5, SEAT_Z - 1, 13, 14, SEAT_Z, fabric(FABRIC));
    s.box(1, 3, 3, 4, 15, 16, fabric(FABRIC_DK));
    f.box(12, 3, 3, 15, 15, 16, fabric(FABRIC_DK));
    return { base: s.finish(), front: f.finish() };
  }
  if (dir === 'up') {
    s.box(2, 2, 3, 14, 11, SEAT_Z - 1, fabric(FABRIC_DK));
    s.box(3, 2, SEAT_Z - 1, 13, 11, SEAT_Z, fabric(FABRIC));
    s.box(1, 1, 3, 4, 13, 16, fabric(FABRIC_DK));
    f.box(12, 1, 3, 15, 13, 16, fabric(FABRIC_DK));
    f.box(2, 11, 3, 14, 15, 22, fabric(FABRIC));
    return { base: s.finish(), front: f.finish() };
  }
  if (dir === 'right') {
    s.box(1, 2, 3, 5, 14, 22, fabric(FABRIC));
    s.box(5, 2, 3, 14, 14, SEAT_Z - 1, fabric(FABRIC_DK));
    s.box(5, 3, SEAT_Z - 1, 14, 13, SEAT_Z, fabric(FABRIC));
    s.box(3, 1, 3, 15, 4, 16, fabric(FABRIC_DK));
    f.box(3, 12, 3, 15, 15, 16, fabric(FABRIC_DK));
    return { base: s.finish(), front: f.finish() };
  }
  s.box(2, 2, 3, 11, 14, SEAT_Z - 1, fabric(FABRIC_DK));
  s.box(2, 3, SEAT_Z - 1, 11, 13, SEAT_Z, fabric(FABRIC));
  s.box(1, 1, 3, 13, 4, 16, fabric(FABRIC_DK));
  f.box(1, 12, 3, 13, 15, 16, fabric(FABRIC_DK));
  f.box(11, 2, 3, 15, 14, 22, fabric(FABRIC));
  return { base: s.finish(), front: f.finish() };
}

const cup = (col: string) => (u: number, v: number) => (u * u + v * v < 0.4 ? '#6b4226' : col);

export function coffeeTable(seed: number): BufFurniture {
  const s = new Iso(2, 1, 30);
  const w = M.oak;
  s.shadow(1, 2, 31, 14, 0.2);
  for (const [x, y] of [[3, 4], [27, 4], [3, 11], [27, 11]] as const) s.box(x, y, 0, x + 2, y + 2, 8, M.walnut);
  s.box(1, 2, 8, 31, 14, 10, {
    top: (u, v, wd, h) => (v >= h - 1 || u >= wd - 1 ? w.hi : (Math.floor(u / 5) + Math.floor(v / 3)) % 7 === 0 ? w.base : w.lt),
    south: w.dk,
    east: w.dd,
  });
  const r = rngOf(seed, 2);
  const col = ACCENTS[Math.floor(r() * ACCENTS.length) % ACCENTS.length];
  const col2 = ACCENTS[(Math.floor(r() * ACCENTS.length) + 3) % ACCENTS.length];
  if (seed % 2 === 0) {
    s.box(5, 5, 10, 13, 11, 10.8, { top: col, south: '#d6d6d0', east: '#c9c9c3' });
    s.box(6, 6, 10.8, 14, 11, 11.6, { top: col2, south: '#d6d6d0', east: '#c9c9c3' });
    s.cyl(24, 8, 1.8, 10, 14, tone('#f4f2ee', 0.06), cup('#f4f2ee'));
  } else {
    s.cyl(8, 8, 2.4, 10, 15, M.ceramic);
    s.blob(8, 8, 18, 4, 3, M.leaf);
    s.blob(9, 8, 20, 3, 2.5, M.leafDark);
    s.cyl(21, 6, 1.6, 10, 13.5, tone(col, 0.07), cup('#f4f2ee'));
    s.cyl(25, 10, 1.6, 10, 13.5, tone(col2, 0.07), cup('#f4f2ee'));
  }
  return { base: s.finish() };
}

export function pingpongTable(): BufFurniture {
  const s = new Iso(3, 2, 36);
  const g = ramp('#2f8f9a', 0.06);
  s.shadow(1, 2, 47, 30, 0.22);
  const leg = tone('#3b4150', 0.07);
  for (const [x, y] of [[5, 6], [41, 6], [5, 25], [41, 25]] as const) s.box(x, y, 0, x + 2, y + 2, 15, leg);
  s.box(2, 3, 15, 46, 29, 17, {
    top: (u, v, w, h) => {
      if (u < 1 || v < 1 || u >= w - 1 || v >= h - 1) return '#e9f4f2';
      if (Math.abs(v - h / 2) < 0.6) return '#e9f4f2';
      return (Math.floor(u / 6) + Math.floor(v / 5)) % 11 === 0 ? g.base : g.lt;
    },
    south: g.dk,
    east: g.dd,
  });
  // rede no meio, correndo norte-sul (plano x = 24)
  s.box(23, 2, 17, 25, 4, 24, M.graphite);
  s.east(4, 28, 24, 17, 23, (u, v, w) => (v < 1 || u < 0.8 || u > w - 0.8 ? '#f2f2ee' : (Math.floor(u) + Math.floor(v)) % 2 === 0 ? '#c9d2dc' : '#56607a'));
  s.box(23, 28, 17, 25, 30, 24, M.graphite);
  s.px(31, 20, 17, '#fff7e0');
  return { base: s.finish() };
}

const BEANBAG: Readonly<Record<string, string>> = { red: '#d9534f', blue: '#4a78c8', yellow: '#e8b93c', green: '#4aa862' };

/** Altura do fundo do pufe, onde o quadril afunda (px). */
export const BEANBAG_DIP = 5.5;

/**
 * Pufe. De costas ('up'), a borda da frente vai no front: os pixels do próprio pufe abaixo da borda da cova (arco de
 * elipse na tela), que cobrem o quadril de quem afunda nele; vazio, o desenho não muda.
 */
export function beanbag(variant: string | undefined, facing: Dir = 'down'): BufFurniture {
  const m = ramp(BEANBAG[variant ?? 'red'] ?? BEANBAG.red, 0.07);
  const s = new Iso(1, 1, 24);
  s.shadow(2, 2, 14, 14, 0.2, 1);
  s.blob(8, 8, 5, 11.5, 6.2, tone(m.dk, 0.06));
  s.blob(8, 8, 6, 11, 6.5, m);
  s.blob(8, 7, 9.5, 8.5, 5.2, m);
  s.blob(8, 8, 11, 6, 3.6, m);
  for (const [x, y] of [[7, 9], [8, 9], [9, 9], [10, 8]] as const) s.px(x, y, 9, m.dk);
  s.px(5, 6, 10, m.hi);
  s.px(6, 6, 11, m.hi);
  const base = s.finish();
  if (facing !== 'up') return { base };
  // borda da cova: arco de baixo de uma elipse centrada acima do centro do pufe
  const cx = base.ax;
  const cy = base.ay + 8 - BEANBAG_DIP - 5.5;
  const rx = 9.5;
  const ry = 3.2;
  const cut = (px: number): number => {
    const t = (px + 0.5 - cx) / rx;
    return Math.abs(t) < 1 ? cy + ry * Math.sqrt(1 - t * t) : cy;
  };
  const front = new PixelBuf(base.buf.w, base.buf.h);
  const d = base.buf.data;
  for (let py = 0; py < base.buf.h; py++)
    for (let px = 0; px < base.buf.w; px++) {
      if (py + 0.5 < cut(px) || base.buf.alpha(px, py) < 255) continue;
      const i = (py * base.buf.w + px) * 4;
      // a primeira linha abaixo do arco é a costura da borda
      if (py - 0.5 < cut(px)) front.set(px, py, m.dk);
      else front.put(px, py, [d[i], d[i + 1], d[i + 2], d[i + 3]]);
    }
  return { base, front: { buf: front, ax: base.ax, ay: base.ay } };
}

export function arcade(): BufFurniture {
  const s = new Iso(1, 1, 64);
  const body = ramp('#3a3f66', 0.07);
  const trim = ramp('#e8b93c', 0.07);
  s.shadow(1, 2, 15, 15, 0.22, 1);
  // faixas diagonais coloridas na lateral
  const art = (u: number, v: number, w: number): string => {
    if (v < 1) return body.base;
    if (u < 1.2 || u >= w - 1.2) return body.dd;
    const k = Math.floor((u + v * 0.9) / 3) % 4;
    return k === 0 ? '#e05a5a' : k === 1 ? '#f2c14e' : k === 2 ? '#36b0b0' : body.dk;
  };
  s.box(2, 3, 0, 14, 13, 19, {
    top: body.lt,
    south: (u, v, w, h) => (u < 1 || u >= w - 1 ? body.dk : v >= h - 2 ? body.dd : body.base),
    east: art,
  });
  // painel de controle com botões e alavanca
  s.box(2, 12, 17, 14, 15.5, 20, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? body.hi : '#2a2e4d'),
    south: (_u, v) => (v < 1 ? body.hi : body.base),
    east: body.dk,
  });
  s.line([4.5, 13.5, 20], [4.5, 13.5, 25], '#8a909b');
  s.blob(4.5, 13.5, 26, 1.8, 1.5, ramp('#e05a5a', 0.1));
  for (const [x, c] of [[8, '#3f7fd8'], [10, '#f2c14e'], [12, '#4cae6a']] as const) {
    s.px(x, 13.2, 20.3, c);
    s.px(x, 14.4, 20.3, c);
  }
  // bloco da tela
  s.box(2, 3, 19, 14, 11, 44, {
    top: body.lt,
    south: (u, _v, w) => (u < 1 || u >= w - 1 ? body.dk : body.base),
    east: art,
  });
  s.south(3, 13, 11.2, 22, 41, (u, v, w, h) => (u < 0.8 || u >= w - 0.8 || v < 0.8 || v >= h - 0.8 ? '#1a1d33' : SCREEN_BG));
  s.southRect('screen', 4, 12, 11.2, 23, 40);
  // letreiro saliente no alto
  s.box(2, 3, 44, 14, 13, 51, {
    top: trim.lt,
    south: (u, v, _w, h) => (v < 1 ? trim.hi : v >= h - 1 ? trim.dk : (Math.floor(u / 2) + Math.floor(v / 2)) % 2 === 0 ? '#e05a5a' : trim.base),
    east: (_u, v) => (v < 1 ? trim.base : trim.dk),
  });
  return { base: s.finish() };
}

/**
 * Fliperama visto por trás: a lateral com a arte, a ponta do painel de controle aparecendo do outro lado, a traseira
 * com a porta de serviço e a ventilação, e o letreiro no alto.
 */
export function arcadeBack(): BufFurniture {
  const s = new Iso(1, 1, 64);
  const body = ramp('#3a3f66', 0.07);
  const trim = ramp('#e8b93c', 0.07);
  s.shadow(1, 1, 15, 14, 0.22, 1);
  const art = (u: number, v: number, w: number): string => {
    if (v < 1) return body.base;
    if (u < 1.2 || u >= w - 1.2) return body.dd;
    const k = Math.floor((w - u + v * 0.9) / 3) % 4;
    return k === 0 ? '#e05a5a' : k === 1 ? '#f2c14e' : k === 2 ? '#36b0b0' : body.dk;
  };
  // painel de controle e alavanca, agora do outro lado
  s.box(2, 0.5, 17, 14, 4, 20, { top: (u, _v, w) => (u >= w - 1 ? body.hi : '#2a2e4d'), south: body.base, east: body.dk });
  s.line([11.5, 2.5, 20], [11.5, 2.5, 25], '#8a909b');
  s.blob(11.5, 2.5, 26, 1.8, 1.5, ramp('#e05a5a', 0.1));
  const vents = (u: number, v: number, w: number): string | undefined => (u >= 2 && u < w - 2 && Math.floor(v) % 2 === 0 ? '#23263f' : undefined);
  s.box(2, 3, 0, 14, 13, 19, {
    top: body.lt,
    east: art,
    south: (u, v, w, h) => {
      if (u < 1 || u >= w - 1) return body.dk;
      if (v >= h - 2) return body.dd;
      // porta de serviço com a fechadura
      if (u >= 2 && u < w - 2 && v >= 2 && v < h - 4) {
        if (u < 2.5 || u >= w - 2.5 || v < 2.5 || v >= h - 4.5) return body.dd;
        if (u >= w - 4.5 && u < w - 3.5 && v >= 6 && v < 8) return M.steel.lt;
        return body.base;
      }
      return body.base;
    },
  });
  s.box(2, 5, 19, 14, 13, 44, {
    top: body.lt,
    east: art,
    south: (u, v, w, h) => {
      if (u < 1 || u >= w - 1) return body.dk;
      if (v >= 3 && v < 9) return vents(u, v, w) ?? body.base;
      // etiqueta do fabricante
      if (u >= 3 && u < 7 && v >= h - 8 && v < h - 5) return v < h - 7 ? '#f4f2ea' : '#c9c9c3';
      return body.base;
    },
  });
  s.box(2, 3, 44, 14, 13, 51, {
    top: trim.lt,
    south: (u, v, _w, h) => (v < 1 ? trim.hi : v >= h - 1 ? trim.dk : u < 1 ? trim.lt : trim.base),
    east: (_u, v) => (v < 1 ? trim.base : trim.dk),
  });
  // cabo de força
  s.line([10.5, 13.2, 6], [10.5, 14.8, 0.5], '#23263f');
  return { base: s.finish() };
}

/** Costas (o móvel de frente para o norte) de um kind deste grupo, ou null. */
export function loungeBack(kind: FurnitureKind): BufFurniture | null {
  return kind === 'arcade' ? arcadeBack() : null;
}

/** Desenho isométrico de um kind deste grupo, ou null se o kind não é daqui. */
export function loungeKinds(kind: FurnitureKind, variant: string | undefined, state: number, seed: number, facing: Dir = 'down'): BufFurniture | null {
  void state;
  switch (kind) {
    case 'sofa':
      return sofa(variant);
    case 'armchair':
      return armchair(variant);
    case 'coffee_table':
      return coffeeTable(seed);
    case 'pingpong_table':
      return pingpongTable();
    case 'beanbag':
      return beanbag(variant, facing);
    case 'arcade':
      return arcade();
    default:
      return null;
  }
}
