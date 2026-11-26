// Penteados do personagem isométrico (puro). Cada estilo monta máscaras com formas simples em coordenadas da
// cabeça (vista de frente: rosto à esquerda e orelha à direita; de costas: nuca à esquerda, orelha e bochecha à
// direita) e um sombreador comum pinta as mechas: luz de cima/esquerda, fios a partir da coroa, um brilho e as
// bordas de baixo mais escuras. A camada `back` vai atrás do corpo (cabelo comprido na vista de frente).
import type { HairStyle } from '../api';
import { mix, ramp, shade, type Ramp } from '../core/color';
import type { Ctx } from './body';
import { headCenter } from './head';
import type { Mask, Shader, V2 } from './paint';

interface H {
  c: Ctx;
  hx: number;
  hy: number;
  back: boolean;
  m: Ramp;
  head: Mask;
}

type Pts = readonly (readonly [number, number])[];

function E(h: H, mk: Mask, x: number, y: number, rx: number, ry: number, on = true): Mask {
  return h.c.P.ellipse(mk, h.hx + x, h.hy + y, rx, ry, on);
}

function G(h: H, mk: Mask, pts: Pts, on = true): Mask {
  return h.c.P.poly(mk, pts.map(([x, y]) => [h.hx + x, h.hy + y] as V2), on);
}

function C(h: H, mk: Mask, a: readonly [number, number], b: readonly [number, number], ra: number, rb = ra): Mask {
  return h.c.P.capsule(mk, [h.hx + a[0], h.hy + a[1]], [h.hx + b[0], h.hy + b[1]], ra, rb);
}

/** Vista de frente: tira o rosto abaixo da linha do cabelo `ft`, com costeleta na frente da orelha. */
function cutFace(h: H, mk: Mask, ft = -2.2, side = 2.6): Mask {
  return G(h, mk, [[-8, ft + 0.4], [-3, ft], [1, ft], [side - 0.2, ft + 0.6], [side, 0.6], [side + 0.6, 2.2], [side + 0.6, 9], [-8, 9]], false);
}

/** Vista de costas: orelha e a faixa da bochecha à direita ficam de fora. */
function cutCheek(h: H, mk: Mask, top = -1.8): Mask {
  return G(h, mk, [[1.8, top + 0.4], [3.4, top - 0.2], [8, top - 0.8], [8, 9], [1.4, 9], [1.6, 3]], false);
}

/** Calota (crânio + volume). */
function cap(h: H, vol = 0.6, lift = 0): Mask {
  return E(h, h.c.P.mask(), h.back ? -0.4 : 0.4, -1.1 - lift, 4.5 + vol, 4.4 + vol + lift * 0.4);
}

/** Nuca (vista de costas). */
function nape(h: H, mk: Mask, y = 3.8, w = 3.6): void {
  E(h, mk, -0.6, y - 1.6, w, 1.8);
}

/** Franja: mechas pontudas do topo `y0` até cada ponta. */
function fringe(h: H, mk: Mask, y0: number, tips: Pts, w = 1.2): void {
  for (const [x, y] of tips) G(h, mk, [[x - w, y0], [x + w, y0], [x + 0.5, y], [x - 0.3, y]]);
}

// ------------------------------------------------------------ sombreado

interface ShadeOpts {
  crown?: readonly [number, number];
  hang?: number;
  texture?: 'curly' | 'buzz' | 'none';
  matte?: boolean;
  bias?: number;
}

function hairShader(h: H, mk: Mask, o: ShadeOpts = {}): Shader {
  const { P } = h.c;
  const m = h.m;
  const cx = P.X(h.hx) + 0.5;
  const cy = P.Y(h.hy - 1.4) + 0.5;
  const crown = o.crown ?? [h.back ? -1 : 1, -4.6];
  const kx = P.X(h.hx + crown[0]) + 0.5;
  const ky = P.Y(h.hy + crown[1]) + 0.5;
  const hang = P.Y(h.hy + (o.hang ?? 2));
  const tex = o.texture ?? 'none';
  const bias = o.bias ?? 0;
  const tones = [m.dd, m.dk, m.base, m.lt, m.hi];
  return (x, y) => {
    const u = (x + 0.5 - cx) / 5.4;
    const v = (y + 0.5 - cy) / 5;
    let lit = -(u * 0.55 + v * 0.7) + bias;
    if (!mk.has(x, y + 1) || !mk.has(x + 1, y)) lit -= 0.6;
    else if (!mk.has(x, y - 1) || !mk.has(x - 1, y)) lit += 0.35;
    let t = lit > 0.5 ? 3 : lit > -0.1 ? 2 : lit > -0.75 ? 1 : 0;
    let strand = false;
    if (tex === 'none') {
      if (y < hang) {
        const a = Math.atan2(x + 0.5 - kx, y + 0.5 - ky);
        const s = (a / Math.PI) * 4 + 10;
        strand = s - Math.floor(s) < 0.2 && Math.hypot(x + 0.5 - kx, y + 0.5 - ky) > 2.5;
      } else strand = (x + (y >> 2)) % 3 === 0;
    } else if (tex === 'curly') {
      const k = (x * 5 + y * 3) % 7;
      strand = k === 0;
      if (k === 3 && t < 3) t++;
    } else strand = (x + y * 2) % 5 === 0;
    if (strand) t = Math.max(0, t - 1);
    // brilho no alto, do lado da luz
    if (!o.matte && tex === 'none' && !strand) {
      const d = Math.hypot((x + 0.5 - cx) / 4.6, (y + 0.5 - cy) / 4.2);
      if (v < 0 && u < 0.3 && d > 0.55 && d < 0.85) t = Math.min(4, t + 1);
    }
    return tones[Math.max(0, Math.min(4, t))];
  };
}

function paintHair(h: H, mk: Mask, o: ShadeOpts = {}, contour = true): void {
  const ink = mix(shade(h.m.dd, -0.1), h.c.p.skin.dk, 0.3);
  h.c.P.paint(mk, hairShader(h, mk, o), contour ? { contour: ink, soft: 0.25 } : { contour: false });
}

/** Elástico/presilha (cor do laço ou da roupa). */
function tie(h: H, x: number, y: number): void {
  const c = h.c;
  const col = c.a.accessory === 'bow' ? c.p.item.base : shade(c.a.top, 0.05);
  c.P.dot(h.hx + x, h.hy + y, col);
  c.P.dot(h.hx + x, h.hy + y + 1, shade(col, -0.12));
}

// ------------------------------------------------------------ estilos

interface Style {
  back?: (h: H) => void;
  front: (h: H) => void;
  /** O cabelo cobre a orelha. */
  ears?: boolean;
}

/** Corte curto comum: calota, nuca e franja. */
function shortCut(h: H, tips: Pts, ft = -2.2, vol = 0.6): Mask {
  const mk = cap(h, vol);
  if (h.back) {
    nape(h, mk);
    cutCheek(h, mk);
  } else {
    cutFace(h, mk, ft);
    fringe(h, mk, ft - 1.6, tips);
  }
  return mk;
}

const STYLES: Readonly<Record<HairStyle, Style>> = {
  short: {
    front: (h) => paintHair(h, shortCut(h, [[-3.4, -1.4], [-1.2, -1.2], [0.8, -1.7]])),
  },
  buzz: {
    front: (h) => {
      const mk = cap(h, 0.1);
      if (h.back) {
        nape(h, mk, 3.4, 3.2);
        cutCheek(h, mk, -1.2);
      } else cutFace(h, mk, -2.8, 2.8);
      const m = ramp(mix(h.m.base, h.c.p.skin.base, 0.3), 0.06);
      paintHair({ ...h, m }, mk, { texture: 'buzz', matte: true }, false);
    },
  },
  spiky: {
    front: (h) => {
      const mk = shortCut(h, [[-3.6, -1.2], [-1.6, -0.8], [0.6, -1.4]], -2.2, 0.4);
      const d = h.back ? -1 : 1;
      for (const [x, y] of [[-3.4, -5.4], [-1, -6.4], [1.6, -6.2], [3.8, -4.8]] as const) {
        const xx = x * d;
        G(h, mk, [[xx - 1.6, y + 2], [xx + 1.6, y + 2], [xx + d * 0.8, y - 1.2]]);
      }
      paintHair(h, mk);
    },
  },
  side_part: {
    front: (h) => {
      const mk = cap(h, 0.7);
      if (h.back) {
        nape(h, mk);
        cutCheek(h, mk);
        paintHair(h, mk);
        h.c.P.line([h.hx + 1.6, h.hy - 5.2], [h.hx + 2.6, h.hy - 3.2], h.m.dd);
        return;
      }
      cutFace(h, mk, -2.2);
      // franja varrida para o lado do rosto, saindo da risca
      G(h, mk, [[1.6, -5.6], [2.6, -3.2], [0, -2.2], [-3, -1.2], [-5, -1.2], [-4.6, -3.6], [-1.6, -5.2]]);
      paintHair(h, mk, { crown: [2, -5] });
      h.c.P.line([h.hx + 1.6, h.hy - 5.4], [h.hx + 2.4, h.hy - 3.4], h.m.dd);
    },
  },
  curly: {
    front: (h) => {
      const mk = cap(h, 1, 0.3);
      const ring: Pts = [[-4.6, -3.6], [-2.6, -5.6], [0.2, -6.2], [2.8, -5.6], [4.8, -3.6], [5.4, -1], h.back ? [-5.2, -0.6] : [-5, -1.6]];
      for (const [x, y] of ring) E(h, mk, h.back ? -x : x, y, 1.5, 1.4);
      if (h.back) {
        nape(h, mk, 4, 4);
        E(h, mk, -3.6, 2.6, 1.5, 1.4);
        E(h, mk, -0.6, 3.6, 1.5, 1.4);
        cutCheek(h, mk, -1.6);
      } else {
        cutFace(h, mk, -2.2, 2.8);
        for (const x of [-3.6, -1.4, 0.8]) E(h, mk, x, -2, 1.2, 1);
      }
      paintHair(h, mk, { texture: 'curly' });
    },
  },
  afro: {
    front: (h) => {
      const mk = E(h, h.c.P.mask(), h.back ? -0.3 : 0.3, -2.2, 6.4, 5.6);
      for (const [x, y] of [[-5.6, -4.6], [-3, -7], [0.4, -7.8], [3.6, -7], [5.8, -4.6], [6.6, -1.4], [-6.4, -1.6]] as const) E(h, mk, x, y, 1.6, 1.6);
      if (h.back) {
        E(h, mk, -0.6, 2.4, 5, 2.4);
        cutCheek(h, mk, 0);
      } else cutFace(h, mk, -2, 3);
      paintHair(h, mk, { texture: 'curly', bias: 0.15 });
    },
  },
  bob: {
    ears: true,
    front: (h) => {
      const mk = cap(h, 0.8);
      if (h.back) {
        G(h, mk, [[-5.4, -2], [5.6, -2], [5.6, 2.8], [4.6, 4.2], [-0.4, 4.6], [-5, 3.8]]);
        paintHair(h, mk, { hang: 0.5 });
        return;
      }
      cutFace(h, mk, -2.2, 9);
      G(h, mk, [[-5.4, -2], [-3.8, -2], [-3.8, 3.6], [-5.2, 3.6]]);
      G(h, mk, [[2, -3], [5.6, -3], [5.8, 2.8], [4.8, 4.2], [2.4, 4], [2.2, 1]]);
      G(h, mk, [[-4.8, -4], [2.2, -4.4], [2.2, -1.4], [-4.6, -1.2]]);
      paintHair(h, mk, { hang: 0.5 });
      h.c.P.dot(h.hx - 2, h.hy - 1.6, h.m.dk);
    },
  },
  long: {
    ears: true,
    back: (h) => {
      if (h.back) return;
      const mk = h.c.P.mask();
      G(h, mk, [[-5, -1], [5.6, -1], [6, 9], [4.6, 11], [-3.6, 11], [-5.2, 8]]);
      paintHair(h, mk, { hang: -2, bias: -0.35 });
    },
    front: (h) => {
      const mk = cap(h, 0.7);
      if (h.back) {
        G(h, mk, [[-5.4, -2], [5.6, -2], [6, 8.6], [4.6, 10.8], [-3.8, 11], [-5.6, 8]]);
        paintHair(h, mk, { hang: 0 });
        return;
      }
      cutFace(h, mk, -2.2, 9);
      G(h, mk, [[-5.4, -2], [-3.8, -2.2], [-3.8, 4.4], [-4.8, 6.4], [-5.6, 4]]);
      G(h, mk, [[2, -3], [5.6, -3], [5.8, 4], [5.2, 9.6], [4, 10.8], [2.8, 9.4], [2.6, 4.4], [2.2, 1]]);
      fringe(h, mk, -3.8, [[-3.4, -1.4], [-1.2, -1.2], [0.8, -1.8]]);
      paintHair(h, mk, { hang: 0.5 });
    },
  },
  ponytail: {
    back: (h) => {
      if (h.back) return;
      const mk = h.c.P.mask();
      C(h, mk, [5, -1.6], [6.2, 2], 1.6, 1.5);
      C(h, mk, [6.2, 2], [5.6, 6.4], 1.5, 0.9);
      paintHair(h, mk, { hang: -4 });
    },
    front: (h) => {
      const mk = cap(h, 0.4);
      if (h.back) {
        nape(h, mk, 3.4, 3.4);
        cutCheek(h, mk);
        paintHair(h, mk, { crown: [-2.6, -2] });
        const t = h.c.P.mask();
        C(h, t, [-2.6, -0.6], [-3.2, 3.6], 1.6, 1.5);
        C(h, t, [-3.2, 3.6], [-2.4, 7.4], 1.5, 0.9);
        paintHair(h, t, { hang: -4 });
        tie(h, -3, -1.4);
        return;
      }
      cutFace(h, mk, -2.4);
      G(h, mk, [[-4.8, -2], [-3, -4], [0.6, -4.6], [1.2, -3], [-1, -2.2], [-3.4, -1.4]]);
      paintHair(h, mk, { crown: [4.6, -1.6] });
      tie(h, 4.8, -2);
    },
  },
  bun: {
    front: (h) => {
      const mk = cap(h, 0.4);
      const bx = h.back ? -1.6 : 1.6;
      if (h.back) {
        nape(h, mk, 3.4, 3.4);
        cutCheek(h, mk);
      } else {
        cutFace(h, mk, -2.4);
        G(h, mk, [[-4.8, -2], [-3, -4], [0.6, -4.6], [1.2, -3], [-1, -2.2], [-3.4, -1.4]]);
      }
      paintHair(h, mk, { crown: [bx, -5] });
      const b = E(h, h.c.P.mask(), bx, -6.2, 2.4, 2);
      paintHair(h, b, { crown: [bx, -6.2] });
    },
  },
  pigtails: {
    back: (h) => {
      if (h.back) return;
      const mk = h.c.P.mask();
      C(h, mk, [-4.6, 0], [-5.8, 2.6], 1.5, 1.4);
      C(h, mk, [-5.8, 2.6], [-5.2, 5.6], 1.4, 0.8);
      paintHair(h, mk, { hang: -3, bias: -0.3 });
    },
    front: (h) => {
      const mk = cap(h, 0.5);
      if (h.back) {
        nape(h, mk, 3.4, 3.6);
        cutCheek(h, mk);
        paintHair(h, mk);
        h.c.P.line([h.hx - 0.6, h.hy - 5.6], [h.hx - 0.8, h.hy - 2], h.m.dd);
      } else {
        cutFace(h, mk, -2.2);
        fringe(h, mk, -3.8, [[-3.4, -1.2], [-1.2, -1], [0.6, -1.6]]);
        paintHair(h, mk);
      }
      const t = h.c.P.mask();
      const sides = h.back ? [-1, 1] : [1];
      for (const s of sides) {
        const x0 = s > 0 ? (h.back ? 3.6 : 4.6) : -4.6;
        C(h, t, [x0, 0], [x0 + s * 1.4, 2.6], 1.5, 1.4);
        C(h, t, [x0 + s * 1.4, 2.6], [x0 + s * 0.8, 5.6], 1.4, 0.8);
      }
      paintHair(h, t, { hang: -3 });
      for (const s of sides) tie(h, s > 0 ? (h.back ? 3.6 : 4.4) : -4.6, -0.6);
    },
  },
  mohawk: {
    front: (h) => {
      const c = h.c;
      const sh = cap(h, 0.1);
      if (h.back) {
        nape(h, sh, 3.4, 3.2);
        cutCheek(h, sh, -1.2);
      } else cutFace(h, sh, -2.8, 2.8);
      const z = ramp(c.p.shaved, 0.05);
      c.P.paint(sh, (x, y) => ((x + y) % 3 === 0 ? z.dk : !sh.has(x - 1, y) || !sh.has(x, y - 1) ? z.lt : z.base), { contour: false });
      const mk = c.P.mask();
      const d = h.back ? -1 : 1;
      G(h, mk, [[-3.2 * d, -4], [-1.4 * d, -6.6], [1 * d, -7.4], [3.4 * d, -6.6], [4.8 * d, -4.4], [4.8 * d, -2.6], [3 * d, -4.4], [0.6 * d, -5], [-2 * d, -4.4]]);
      paintHair(h, mk, { crown: [2 * d, -8] });
    },
  },
  bald: {
    front: (h) => {
      const c = h.c;
      const sh = c.P.mask();
      if (h.back) {
        E(h, sh, -0.6, 2, 4.6, 2.2);
        sh.keep(h.head);
        cutCheek(h, sh, 0);
      } else {
        E(h, sh, 4, 0.4, 1.4, 2.4);
        sh.keep(h.head);
      }
      const z = ramp(c.p.shaved, 0.05);
      c.P.paint(sh, (x, y) => ((x + y) % 3 === 0 ? z.dk : z.base), { contour: false });
      const k = c.p.skin.hi;
      const bx = h.back ? 0 : -1.6;
      c.P.dot(h.hx + bx, h.hy - 4, k);
      c.P.dot(h.hx + bx + 1, h.hy - 4, mix(k, c.p.skin.lt, 0.5));
    },
  },
  wavy: {
    ears: true,
    back: (h) => {
      if (h.back) return;
      const mk = h.c.P.mask();
      G(h, mk, [[-5, -1], [5.6, -1], [6, 5], [-5.2, 5]]);
      for (const x of [-4, -1.4, 1.2, 3.8]) E(h, mk, x, 5.4, 1.4, 1.3);
      paintHair(h, mk, { hang: -2, bias: -0.35 });
    },
    front: (h) => {
      const mk = cap(h, 0.9, 0.2);
      if (h.back) {
        G(h, mk, [[-5.6, -2], [5.8, -2], [6, 5], [-5.6, 5]]);
        for (const x of [-4.4, -1.6, 1.2, 4]) E(h, mk, x, 5.4, 1.5, 1.3);
        paintHair(h, mk, { hang: 0 });
        return;
      }
      cutFace(h, mk, -2.2, 9);
      for (let y = -2; y <= 5; y += 1.4) E(h, mk, -4.6 + Math.sin(y * 1.3) * 0.5, y, 1, 0.9);
      for (let y = -3; y <= 6; y += 1.4) E(h, mk, 4.2 + Math.sin(y * 1.3) * 0.6, y, 1.6, 0.9);
      G(h, mk, [[-5, -2.6], [-2.6, -4.4], [-0.6, -4], [-1.4, -2], [-3.4, -1.2], [-5, -1.2]]);
      G(h, mk, [[0, -4.4], [2.4, -4.4], [2.8, -1.6], [1.2, -2.2]]);
      paintHair(h, mk, { hang: 0.5 });
    },
  },
};

function hctx(c: Ctx, head: Mask): H {
  const [hx, hy] = headCenter(c);
  return { c, hx, hy, back: c.v.back, m: c.p.hair, head };
}

/** Camada de trás (antes do corpo). */
export function drawHairBack(c: Ctx, head: Mask): void {
  (STYLES[c.a.hairStyle] ?? STYLES.short).back?.(hctx(c, head));
}

/** Camada da frente (depois da cabeça). Devolve se a orelha ficou coberta. */
export function drawHairFront(c: Ctx, head: Mask, hidden = false): boolean {
  const st = STYLES[c.a.hairStyle] ?? STYLES.short;
  if (!hidden) st.front(hctx(c, head));
  return !!st.ears;
}

/** Penteados que cobrem a orelha. */
export const EAR_HAIR: ReadonlySet<HairStyle> = new Set<HairStyle>((Object.keys(STYLES) as HairStyle[]).filter((k) => STYLES[k].ears));

/** Penteados que ficam por cima de boné/gorro (volume no alto). */
export const TALL: ReadonlySet<HairStyle> = new Set<HairStyle>(['afro', 'bun', 'mohawk']);
