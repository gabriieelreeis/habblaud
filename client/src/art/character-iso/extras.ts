// Itens na mão, acessórios de cabeça e fantasias sazonais do personagem isométrico (puro).
import type { HeldItem } from '../api';
import { mix, ramp, shade } from '../core/color';
import { drawBox, pj, pt, type Ctx } from './body';
import { headCenter } from './head';
import { EAR_HAIR, TALL } from './hair';
import { rimShade, type Mask, type V2 } from './paint';
import { depth, lerp, type J } from './rig';

// ------------------------------------------------------------ itens

export interface HeldDraw {
  kind: HeldItem;
  hand: 'near' | 'far' | 'both';
  fixed: boolean;
  drawn: boolean;
}

const NOT_DRAWN: ReadonlySet<HeldItem> = new Set<HeldItem>(['none', 'rock', 'paper', 'scissors']);

export function itemOf(c: Ctx): HeldDraw | null {
  const k = c.r.held;
  if (NOT_DRAWN.has(k)) return null;
  return { kind: k, hand: c.r.itemAt ? 'near' : c.r.itemHand, fixed: !!c.r.itemAt, drawn: false };
}

/** Ponto 3D do item (centro de pega). */
function itemPoint(c: Ctx, it: HeldDraw): J {
  const r = c.r;
  if (r.itemAt) return r.itemAt;
  if (it.hand === 'both') return lerp(r.far.arm.c, r.near.arm.c, 0.5);
  return it.hand === 'near' ? r.near.arm.c : r.far.arm.c;
}

export function itemDepth(c: Ctx, it: HeldDraw): number {
  return depth(c.v, itemPoint(c, it));
}

const MUG: readonly string[] = ['wcw', 'rrrh', 'www.'];
const CUP: readonly string[] = ['bb', 'ww', 'ww'];
const PHONE: readonly string[] = ['dd', 'bB', 'bb', 'dd'];
const CONTROLLER: readonly string[] = ['.hLLLh.', 'hLdLrLL', 'cc...cc'];
const POPCORN: readonly string[] = ['.pkp.', 'kpypk', 'AAAAA', 'lwrwW', 'lwrwW', '.wrw.'];
const POP_PAL = { p: '#fff9e6', k: '#f3e3b8', y: '#ffd75e', A: '#fbf8f1', l: '#ef6457', r: '#d8413f', w: '#f6f1e6', W: '#cfc6b6' };

/** Carimbo com a luz certa no espelho: o template é desenhado na tela sem inverter (objetos quase simétricos). */
function stampScreen(c: Ctx, rows: readonly string[], cx: number, cy: number, pal: Readonly<Record<string, string>>): void {
  const w = rows[0].length;
  // colunas locais [k0, k0 + w) e o mesmo vão espelhado; o desenho não inverte (luz sempre à esquerda)
  const k0 = Math.round(cx - w / 2);
  const ax = Math.floor(c.P.ax);
  const sx = c.P.m === 1 ? ax + k0 : ax - k0 - w;
  const sy = Math.round(c.P.Y(cy));
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch !== '.') c.P.buf.set(sx + i, sy + j, pal[ch]);
    }
  });
}

export function drawItem(c: Ctx, it: HeldDraw): void {
  const q = itemPoint(c, it);
  const h = pj(c, q);
  switch (it.kind) {
    case 'coffee':
      stampScreen(c, MUG, h[0] + 0.5, h[1] - 2.6, { w: '#f4f2ee', c: '#6b4226', r: '#e2604f', h: '#cfcac0' });
      break;
    case 'water':
      stampScreen(c, CUP, h[0], h[1] - 2.6, { b: '#9ad4f5', w: '#e3f2fb' });
      break;
    case 'phone':
      stampScreen(c, PHONE, h[0], h[1] - 3.2, { d: '#2b2f3a', b: '#6fbdf0', B: '#c8eaff' });
      break;
    case 'controller':
      stampScreen(c, CONTROLLER, h[0], h[1] - 2, { L: '#4c5263', h: '#7d869b', d: '#1d2029', r: '#f0606a', c: '#363b48' });
      break;
    case 'popcorn':
      stampScreen(c, POPCORN, h[0], h[1] - (it.fixed ? 4 : 5), POP_PAL);
      break;
    case 'lipstick':
      if (!c.v.back) stampScreen(c, ['r', 'g', 'g'], h[0], h[1] - 2.6, { r: '#e0365e', g: '#f0c75a' });
      break;
    case 'comb':
      stampScreen(c, ['cccc', 'c.c.'], h[0], h[1] - 2.6, { c: '#3d4252' });
      break;
    case 'paddle': {
      const m = ramp('#d64545', 0.08);
      const head: V2 = [h[0] + 0.5, h[1] - 3.6];
      const mk = c.P.ellipse(c.P.mask(), head[0], head[1], 1.9, 2.1);
      c.P.line([h[0], h[1]], [h[0] + 0.3, h[1] - 1.4], '#6b4a32');
      c.P.paint(mk, rimShade(mk, m), { soft: 0.3 });
      break;
    }
    case 'box':
      drawBox(c, { fb: q.f + 0.4, ft: q.f + 0.4, zb: q.z - 2.2, zt: q.z + 2.8, wb: 2.9, wt: 2.9, db: 2, dt: 2 }, ramp('#c99a5e', 0.11), (P, _b, on) => {
        P.line(on(-0.15, 1), on(-0.15, 0.1), '#ead7ad');
      });
      break;
    case 'laptop':
      drawBox(c, { fb: q.f + 0.8, ft: q.f + 0.8, zb: q.z - 1.6, zt: q.z + 2.6, wb: 3, wt: 3, db: 0.6, dt: 0.6 }, ramp('#b9c0cb', 0.09), (P, _b, on) => {
        const k = on(-0.1, 0.5);
        P.dot(k[0], k[1], '#eef1f5');
      });
      break;
    case 'book':
      drawBox(c, { fb: q.f + 0.8, ft: q.f + 0.8, zb: q.z - 1.6, zt: q.z + 2.8, wb: 2.4, wt: 2.4, db: 0.7, dt: 0.7 }, ramp('#3f63a8', 0.1), (P, _b, on) => {
        P.line(on(-0.5, 0.75), on(0.3, 0.75), '#f2c14e');
      });
      break;
    case 'papers':
      drawBox(c, { fb: q.f + 0.8, ft: q.f + 0.8, zb: q.z - 2, zt: q.z + 2.6, wb: 2.4, wt: 2.4, db: 0.4, dt: 0.4 }, ramp('#f4f2ec', 0.06), (P, _b, on) => {
        for (const hh of [0.75, 0.5, 0.25]) P.line(on(-0.6, hh), on(0.2, hh), '#a6b0c0');
      });
      break;
    default:
      break;
  }
}

/** Pipoca entre os dedos (pose wait). */
export function drawKernel(c: Ctx): void {
  const k = c.r.kernel;
  if (!k || c.v.back) return;
  const q = pj(c, k);
  c.P.dot(q[0], q[1], POP_PAL.p);
}

// ------------------------------------------------------------ acessórios de cabeça

function local(c: Ctx): { hx: number; hy: number; d: (x: number, y: number, col: string) => void } {
  const [hx, hy] = headCenter(c);
  return { hx, hy, d: (x, y, col) => c.P.dot(hx + x, hy + y, col) };
}

/** Boné, gorro, fone, óculos, brincos e laço. */
export function drawHeadwear(c: Ctx): void {
  if (c.a.accessory === 'none') return;
  const { P, p, a, v } = c;
  const { hx, hy, d } = local(c);
  const it = p.item;
  const ny = hy + Math.min(1, c.r.nod);
  switch (a.accessory) {
    case 'glasses': {
      if (v.back) {
        d(3, -0.4, it.dk);
        d(1.6, -0.4, it.dk);
        break;
      }
      const fr = shade(it.dk, -0.08);
      for (const x of [-4, -3, -2, -1, 0, 1]) d(x, ny - hy - 0.6, fr);
      d(-4, ny - hy + 0.4, fr);
      d(-2, ny - hy + 0.4, mix(fr, p.skin.base, 0.4));
      d(1, ny - hy + 0.4, fr);
      d(2, ny - hy - 0.6, it.base);
      d(3, ny - hy - 0.6, it.base);
      break;
    }
    case 'sunglasses': {
      if (v.back) {
        d(1.6, -0.4, '#15161c');
        d(3, -0.4, '#15161c');
        break;
      }
      for (const x of [-4, -3, -2, -1, 0, 1]) d(x, ny - hy, '#15161c');
      d(-3, ny - hy + 1, '#15161c');
      d(0, ny - hy + 1, '#15161c');
      d(-1, ny - hy + 1, '#15161c');
      d(0, ny - hy, '#5a6b8a');
      d(-3, ny - hy, '#5a6b8a');
      d(2, ny - hy - 0.6, '#15161c');
      d(3, ny - hy - 0.6, '#15161c');
      break;
    }
    case 'headphones': {
      // arco por cima e concha sobre a orelha de perto
      const band = P.mask();
      P.ellipse(band, hx + 0.6, hy - 1, 5.6, 5.4);
      P.ellipse(band, hx + 0.6, hy - 0.6, 4.6, 5, false);
      P.poly(band, [[hx - 8, hy - 2.4], [hx + 9, hy - 2.4], [hx + 9, hy + 8], [hx - 8, hy + 8]], false);
      if (!v.back) P.poly(band, [[hx - 8, hy - 9], [hx - 1, hy - 9], [hx - 1, hy + 8], [hx - 8, hy + 8]], false);
      P.paint(band, (x, y) => (!band.has(x, y - 1) ? it.lt : it.base), { soft: 0.3 });
      const cup = P.ellipse(P.mask(), hx + (v.back ? 3.4 : 4), hy + 0.8, 1.6, 2);
      P.paint(cup, rimShade(cup, it), { soft: 0.2 });
      break;
    }
    case 'cap': {
      const mk = P.mask();
      P.ellipse(mk, hx + (v.back ? -0.3 : 0.3), hy - 2.4, 5.2, 3.8);
      P.poly(mk, [[hx - 8, hy - 2], [hx + 8, hy - 2], [hx + 8, hy + 4], [hx - 8, hy + 4]], false);
      if (!v.back) P.poly(mk, [[hx - 7, hy - 3], [hx - 1, hy - 3], [hx - 1, hy - 1.6], [hx - 7.4, hy - 1.6]]);
      const m = it;
      P.paint(mk, (x, y) => {
        if (!v.back && y >= P.Y(hy - 3) && !mk.has(x, y + 1)) return m.dd;
        return !mk.has(x, y - 1) ? m.lt : !mk.has(x + 1, y) || !mk.has(x, y + 1) ? m.dk : m.base;
      });
      if (!v.back) d(-0.6, -4.6, '#f4f2ee');
      break;
    }
    case 'beanie': {
      if (TALL.has(a.hairStyle)) break;
      const mk = P.mask();
      P.ellipse(mk, hx + (v.back ? -0.3 : 0.3), hy - 2, 5.2, 4.2);
      P.poly(mk, [[hx - 8, hy - 1.6], [hx + 8, hy - 1.6], [hx + 8, hy + 4], [hx - 8, hy + 4]], false);
      const rib = P.Y(hy - 3);
      P.paint(mk, (x, y) => (y >= rib ? ((x & 1) === 0 ? it.dk : it.base) : !mk.has(x, y - 1) ? it.lt : !mk.has(x + 1, y) ? it.dk : it.base));
      d(v.back ? -0.6 : 0.6, -6.6, '#f4f2ee');
      break;
    }
    case 'earrings':
      // de costas, cabelo que cobre a orelha esconde o brinco; de frente ele aparece por cima da mecha
      if (!v.back || !EAR_HAIR.has(a.hairStyle)) d(v.back ? 2.6 : 3.4, 2.6, it.lt);
      break;
    case 'bow': {
      const bx = v.back ? -2 : 1.6;
      const by = -4.6;
      const mk = P.mask();
      P.poly(mk, [[hx + bx - 2.4, hy + by - 1.4], [hx + bx, hy + by], [hx + bx - 2.4, hy + by + 1.4]]);
      P.poly(mk, [[hx + bx + 2.4, hy + by - 1.4], [hx + bx, hy + by], [hx + bx + 2.4, hy + by + 1.4]]);
      P.paint(mk, rimShade(mk, it), { soft: 0.2 });
      d(bx - 0.5, by - 0.5, it.dd);
      break;
    }
  }
}

// ------------------------------------------------------------ fantasias

/** Capa de vampiro atrás do corpo (vista de frente). */
export function drawCostumeBack(c: Ctx): void {
  if (c.costume !== 'vampire' || c.v.back) return;
  cape(c);
}

/** Capa por cima das costas (vista de costas). */
export function drawCostumeMid(c: Ctx): void {
  if (c.costume !== 'vampire' || !c.v.back) return;
  cape(c);
}

function cape(c: Ctx): void {
  const { P, r } = c;
  const ch = r.chest;
  const lo = Math.max(4, r.hip.z - 9);
  const s = c.v.back ? -1 : 1;
  const pts: V2[] = [pt(c, ch.f - s * 1.6, -5.6, ch.z + 0.6), pt(c, ch.f - s * 1.6, 5.6, ch.z + 0.6), pt(c, r.hip.f - s * 2.6, 7.4, lo), pt(c, r.hip.f - s * 2.6, -7.4, lo)];
  const mk = P.poly(P.mask(), pts);
  const out = ramp('#2c2233', 0.06);
  const inner = '#7a2238';
  P.paint(mk, (x, y) => {
    if (!c.v.back && (!mk.has(x - 2, y) || !mk.has(x + 2, y))) return inner;
    return rimShade(mk, out)(x, y);
  });
}

/** Chapéus e golas das fantasias (por cima de tudo na cabeça). */
export function drawCostumeFront(c: Ctx, head: Mask): void {
  const costume = c.costume;
  if (!costume) return;
  const { P, v } = c;
  const { hx, hy } = local(c);
  const s = v.back ? -1 : 1;
  if (costume === 'santa') {
    // gorro vermelho com a ponta caindo para trás, faixa de pelúcia e pompom
    const red = ramp('#cf3a46', 0.08);
    const mk = P.mask();
    P.ellipse(mk, hx + 0.3 * s, hy - 3, 5.1, 3.2);
    P.poly(mk, [[hx - 3.4 * s, hy - 5], [hx - 0.4 * s, hy - 7.6], [hx + 3 * s, hy - 8.2], [hx + 5.6 * s, hy - 6.8], [hx + 7 * s, hy - 4.2], [hx + 7.2 * s, hy - 2], [hx + 5.6 * s, hy - 2.4], [hx + 4.6 * s, hy - 4.2]]);
    P.poly(mk, [[hx - 8, hy - 2.6], [hx + 5 * s, hy - 2.6], [hx + 5 * s, hy + 4], [hx - 8, hy + 4]], false);
    P.poly(mk, [[hx + 9, hy - 2.6], [hx - 6 * s, hy - 2.6], [hx - 6 * s, hy + 4], [hx + 9, hy + 4]], false);
    P.paint(mk, rimShade(mk, red));
    const band = P.mask();
    P.poly(band, [[hx - 5.4, hy - 4], [hx + 5.8, hy - 4], [hx + 5.8, hy - 1.8], [hx - 5.4, hy - 1.8]]);
    band.keep(P.ellipse(P.mask(), hx + 0.3 * s, hy - 2, 5.6, 3.6));
    P.paint(band, (x, y) => (!band.has(x, y + 1) ? '#d9d4c6' : !band.has(x, y - 1) ? '#ffffff' : '#f6efe2'), { soft: 0.3 });
    const pom = P.ellipse(P.mask(), hx + 7.2 * s, hy - 1.4, 1.5, 1.5);
    P.paint(pom, (x, y) => (!pom.has(x + 1, y) || !pom.has(x, y + 1) ? '#d9d4c6' : '#ffffff'), { soft: 0.3 });
    return;
  }
  if (costume === 'witch') {
    const hat = ramp('#50336f', 0.07);
    const brim = P.ellipse(P.mask(), hx + 0.4 * s, hy - 3.6, 7.4, 1.8);
    P.paint(brim, rimShade(brim, ramp('#3c2754', 0.07)));
    const cone = P.mask();
    P.poly(cone, [[hx - 3.6, hy - 4], [hx + 4.2, hy - 4], [hx + 2.4 * s, hy - 10], [hx + 3.6 * s, hy - 12.6], [hx + 0.6 * s, hy - 10.4]]);
    P.paint(cone, rimShade(cone, hat));
    P.line([hx - 3.4, hy - 5], [hx + 4, hy - 5], '#e9a548');
    P.dot(hx + 0.4, hy - 5, '#ffe0a3');
    return;
  }
  if (costume === 'pumpkin') {
    const o = ramp('#ed963c', 0.08);
    const mk = P.ellipse(P.mask(), hx + 0.3 * s, hy - 4.6, 5.6, 3.4);
    P.paint(mk, (x, y) => {
      const k = (x - Math.floor(P.X(hx))) % 3;
      if (k === 0) return o.dk;
      return rimShade(mk, o)(x, y);
    });
    P.line([hx + 0.2, hy - 8], [hx + 0.8 * s, hy - 9.4], '#47754b');
    P.dot(hx + 1.4 * s, hy - 9.4, '#5d9a5e');
    return;
  }
  // vampiro: gola alta dos dois lados do pescoço
  const col = ramp('#702743', 0.07);
  const mk = P.mask();
  const ch = c.r.chest;
  for (const n of [-1, 1]) {
    const a = pt(c, ch.f, n * 3.6, ch.z + 0.4);
    const b = pt(c, ch.f, n * 4.8, ch.z + 4.4);
    P.capsule(mk, a, b, 1, 1.4);
  }
  mk.cut(head);
  P.paint(mk, rimShade(mk, col), { soft: 0.3 });
}
