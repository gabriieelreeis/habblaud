// Corpo do personagem isométrico (puro): tronco com a roupa, quadril/saia, pernas, sapatos, braços e mãos.
// Tudo é projetado a partir do rig; o tronco é uma caixa afunilada (face principal, lateral de perto e topo).
import type { Appearance, CharacterFrameRequest } from '../api';
import { ramp, shade, type Ramp } from '../core/color';
import { rimShade, sphereShade, tubeShade, type Mask, type Painter, type Shader, type V2 } from './paint';
import type { Pal } from './pal';
import { J3, proj, type ArmRig, type J, type LegRig, type Rig, type View } from './rig';

export interface Ctx {
  P: Painter;
  v: View;
  r: Rig;
  a: Appearance;
  p: Pal;
  costume?: CharacterFrameRequest['costume'];
}

export const pt = (c: Ctx, f: number, n: number, z: number): V2 => proj(c.v, J3(f, n, z));
export const pj = (c: Ctx, q: J): V2 => proj(c.v, q);

/** Tela local -> tela da folha (para sombreadores). */
export function scr(c: Ctx, q: V2): V2 {
  return [c.P.X(q[0]), c.P.Y(q[1])];
}

const mid = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ------------------------------------------------------------ caixas (tronco, quadril, saia)

export interface Box {
  /** Centros (f) e alturas da base e do topo, meias larguras (n) e meias profundidades (f). */
  fb: number;
  ft: number;
  zb: number;
  zt: number;
  wb: number;
  wt: number;
  db: number;
  dt: number;
}

interface BoxFaces {
  main: Mask;
  side: Mask;
  top: Mask;
  all: Mask;
}

/** Caixa afunilada projetada: face principal (frente ou costas), lateral de perto e topo. */
function boxFaces(c: Ctx, b: Box, round = 0): BoxFaces {
  const { P, v } = c;
  const s = v.back ? -1 : 1;
  const A = pt(c, b.fb + s * b.db, -b.wb, b.zb);
  const B = pt(c, b.fb + s * b.db, b.wb, b.zb);
  const C = pt(c, b.ft + s * b.dt, b.wt, b.zt - round);
  const D = pt(c, b.ft + s * b.dt, -b.wt, b.zt - round);
  const E = pt(c, b.fb - s * b.db, b.wb, b.zb);
  const F = pt(c, b.ft - s * b.dt, b.wt, b.zt - round);
  const G = pt(c, b.ft - s * b.dt, -b.wt, b.zt - round);
  // ombros arredondados: o topo sobe `round` px no meio
  const Cm = pt(c, b.ft + s * b.dt, b.wt - round * 1.4, b.zt);
  const Dm = pt(c, b.ft + s * b.dt, -b.wt + round * 1.4, b.zt);
  const Fm = pt(c, b.ft - s * b.dt, b.wt - round * 1.4, b.zt);
  const Gm = pt(c, b.ft - s * b.dt, -b.wt + round * 1.4, b.zt);
  const main = P.poly(P.mask(), round ? [A, B, C, Cm, Dm, D] : [A, B, C, D]);
  const side = P.poly(P.mask(), round ? [B, E, F, Fm, Cm, C] : [B, E, F, C]);
  side.cut(main);
  const top = P.poly(P.mask(), round ? [Dm, Cm, Fm, Gm] : [D, C, F, G]);
  top.cut(main);
  top.cut(side);
  const all = main.clone();
  all.add(side);
  all.add(top);
  return { main, side, top, all };
}

/** Ponto na face principal: u em [-1, 1] na largura, h em [0, 1] da base ao topo, `out` px para fora. */
export function onMain(c: Ctx, b: Box, u: number, h: number, out = 0): V2 {
  const s = c.v.back ? -1 : 1;
  const f = b.fb + (b.ft - b.fb) * h + s * (b.db + (b.dt - b.db) * h + out);
  const w = b.wb + (b.wt - b.wb) * h;
  return pt(c, f, u * w, b.zb + (b.zt - b.zb) * h);
}

/** Sombreador das três faces: principal na base, lateral escura (ou clara, se o espelho a vira para a luz). */
function faceShader(c: Ctx, fc: BoxFaces, m: Ramp): Shader {
  const sideLit = c.P.m === -1;
  return (x, y) => {
    if (fc.top.has(x, y)) return m.lt;
    if (fc.side.has(x, y)) {
      if (!fc.all.has(x, y + 1)) return m.dd;
      return sideLit ? m.lt : m.dk;
    }
    if (!fc.all.has(x, y + 1)) return m.dk;
    // borda da face principal do lado da luz
    if (!sideLit && !fc.all.has(x - 1, y)) return m.lt;
    if (sideLit && !fc.all.has(x + 1, y)) return m.dk;
    return m.base;
  };
}

/** Caixa sólida (item na mão): faces sombreadas e detalhe opcional na face principal. */
export function drawBox(c: Ctx, b: Box, m: Ramp, detail?: (P: Painter, b: Box, on: (u: number, h: number) => V2) => void): void {
  const fc = boxFaces(c, b);
  c.P.paint(fc.all, faceShader(c, fc, m), { soft: 0.3 });
  detail?.(c.P, b, (u, h) => onMain(c, b, u, h, 0.1));
}

export function torsoBox(c: Ctx): Box {
  const { r, a } = c;
  const flare = a.topStyle === 'blouse' ? 0.6 : a.topStyle === 'jacket' || a.topStyle === 'hoodie' ? 0.25 : 0;
  return {
    fb: r.hip.f,
    ft: r.chest.f,
    zb: r.hip.z + 0.8,
    zt: r.chest.z + 0.9 - r.slump,
    wb: 3.8 + flare,
    wt: 5 - r.slump * 0.25,
    db: 1.6 + flare * 0.3,
    dt: 1.8,
  };
}

export function drawTorso(c: Ctx): void {
  const { P, p, a, v } = c;
  const b = torsoBox(c);
  const fc = boxFaces(c, b, 0.9);
  const t = p.top;
  P.paint(fc.all, faceShader(c, fc, t));
  const line = (u0: number, h0: number, u1: number, h1: number, col: string) => P.line(onMain(c, b, u0, h0), onMain(c, b, u1, h1), col);
  const dot = (u: number, h: number, col: string) => {
    const q = onMain(c, b, u, h);
    P.dot(q[0], q[1], col);
  };
  const front = !v.back;
  const ac = p.acc;
  switch (a.topStyle) {
    case 'tshirt':
      if (front) {
        line(-0.25, 0.92, 0.25, 0.92, t.dd);
        line(-0.3, 0.55, 0.05, 0.55, ac.base);
        line(-0.3, 0.45, 0.05, 0.45, ac.dk);
      } else line(-0.3, 0.92, 0.3, 0.92, t.dk);
      break;
    case 'hoodie':
      if (front) {
        line(-0.45, 0.95, 0.45, 0.95, t.dd);
        dot(-0.2, 0.78, ac.lt);
        dot(-0.2, 0.68, ac.base);
        dot(0.25, 0.78, ac.base);
        dot(0.25, 0.68, ac.dk);
        line(-0.45, 0.3, 0.4, 0.3, t.dk);
      } else {
        const hood = P.poly(P.mask(), [onMain(c, b, -0.65, 1.04, 0.4), onMain(c, b, 0.65, 1.04, 0.4), onMain(c, b, 0.4, 0.62, 0.4), onMain(c, b, -0.4, 0.62, 0.4)]);
        P.paint(hood, rimShade(hood, ramp(t.dk, 0.07)), { soft: 0.4 });
      }
      line(-1, 0.1, 1, 0.1, t.dd);
      break;
    case 'shirt_tie':
      if (front) {
        dot(-0.35, 0.95, t.hi);
        dot(-0.15, 0.88, t.hi);
        dot(0.3, 0.95, t.lt);
        dot(0.15, 0.88, t.lt);
        line(0, 0.86, 0, 0.18, ac.base);
        dot(0, 0.92, ac.dk);
        dot(0.12, 0.25, ac.dk);
      } else line(-0.35, 0.95, 0.35, 0.95, t.hi);
      break;
    case 'sweater':
      if (front) line(-0.3, 0.94, 0.3, 0.94, t.dd);
      line(-1, 0.58, 1, 0.58, ac.base);
      line(-1, 0.1, 1, 0.1, t.dd);
      break;
    case 'jacket':
      if (front) {
        const shirt = P.poly(P.mask(), [onMain(c, b, -0.3, 1, 0.1), onMain(c, b, 0.3, 1, 0.1), onMain(c, b, 0.12, 0.02, 0.1), onMain(c, b, -0.12, 0.02, 0.1)]);
        P.paint(shirt, (x, y) => (!shirt.has(x, y - 1) ? ac.lt : ac.base), { contour: t.dd, soft: 0.5 });
        line(-0.32, 0.95, -0.16, 0.55, t.hi);
        dot(-0.3, 0.32, t.dd);
      } else line(0, 0.92, 0, 0.12, t.dk);
      break;
    case 'blouse':
      if (front) {
        line(-0.4, 0.95, 0.4, 0.95, ac.lt);
        dot(0, 0.86, ac.dk);
        dot(0, 0.55, t.dk);
      } else line(-0.4, 0.95, 0.4, 0.95, ac.base);
      break;
    case 'polo':
      if (front) {
        dot(-0.35, 0.95, ac.lt);
        dot(-0.15, 0.9, ac.lt);
        dot(0.3, 0.95, ac.base);
        dot(0.12, 0.9, ac.base);
        line(0, 0.84, 0, 0.66, t.dk);
      } else line(-0.35, 0.95, 0.35, 0.95, ac.base);
      break;
  }
  drawLanyard(c, b);
}

function drawLanyard(c: Ctx, b: Box): void {
  const col = c.a.lanyard;
  if (!col) return;
  const { P, v } = c;
  const dk = shade(col, -0.12);
  if (v.back) {
    P.line(onMain(c, b, -0.3, 0.97, 0.3), onMain(c, b, 0.3, 0.97, 0.3), col);
    return;
  }
  P.line(onMain(c, b, -0.35, 0.98, 0.3), onMain(c, b, -0.1, 0.62, 0.3), col);
  P.line(onMain(c, b, 0.35, 0.98, 0.3), onMain(c, b, 0.1, 0.62, 0.3), dk);
  // crachá 3x3: faixa colorida em cima
  const q = onMain(c, b, -0.12, 0.6, 0.4);
  P.stamp(['ccc', 'www', 'wgw'], Math.round(q[0]) - 1, Math.round(q[1]), { c: dk, w: '#f6f4ee', g: '#8d9bb5' });
}

// ------------------------------------------------------------ quadril e pernas

export function drawPelvis(c: Ctx): void {
  const { P, r, a, p } = c;
  const style = a.bottomStyle ?? 'pants';
  if (style === 'skirt') {
    drawSkirt(c);
    return;
  }
  const b: Box = { fb: r.hip.f, ft: r.hip.f, zb: r.hip.z - 2, zt: r.hip.z + 1.4, wb: 3.5, wt: 3.7, db: 1.5, dt: 1.5 };
  const fc = boxFaces(c, b);
  P.paint(fc.all, faceShader(c, fc, p.bottom));
}

function drawSkirt(c: Ctx): void {
  const { P, r, p } = c;
  const m = p.bottom;
  const zt = r.hip.z + 1.4;
  if (r.seated) {
    // saia cobrindo as coxas sobre o assento
    const pts: V2[] = [pt(c, r.hip.f - 1.8, -4, zt), pt(c, r.hip.f - 1.8, 4.2, zt), pt(c, r.hip.f + 5.4, 4.6, r.hip.z + 0.6), pt(c, r.hip.f + 5.6, 4.6, r.hip.z - 1.6), pt(c, r.hip.f + 5.6, -4.6, r.hip.z - 1.6), pt(c, r.hip.f + 5.4, -4.6, r.hip.z + 0.6)];
    const mk = P.poly(P.mask(), hull(pts));
    P.paint(mk, rimShade(mk, m));
    return;
  }
  const b: Box = { fb: r.hip.f, ft: r.hip.f, zb: r.hip.z - 6.4, zt, wb: 5.4, wt: 4.1, db: 2.6, dt: 1.7 };
  const fc = boxFaces(c, b);
  P.paint(fc.all, faceShader(c, fc, m));
  for (const u of [-0.45, 0.2]) P.line(onMain(c, b, u * 0.8, 0.8), onMain(c, b, u, 0.08), m.dk);
}

/** Casco convexo simples (para polígonos montados de pontos soltos). */
export function hull(pts: V2[]): V2[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [];
  for (const q of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const hi: V2[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const q = s[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Uma perna: coxa e canela (calça, short ou pele) e o sapato. */
export function drawLeg(c: Ctx, leg: LegRig): void {
  const { P, a, p } = c;
  const style = a.bottomStyle ?? 'pants';
  const A = pj(c, leg.a);
  const B = pj(c, leg.b);
  const C = pj(c, leg.c);
  drawShoe(c, leg);
  const [ax, ay] = scr(c, A);
  const [bx, by] = scr(c, B);
  const [cx, cy] = scr(c, C);
  const thigh = P.capsule(P.mask(), A, B, 1.75, 1.6);
  const shin = P.capsule(P.mask(), B, C, 1.55, 1.35);
  const thighSh = (m: Ramp) => tubeShade(m, ax, ay, bx, by, 1.7);
  const shinSh = (m: Ramp) => tubeShade(m, bx, by, cx, cy, 1.5);
  if (style === 'shorts') {
    const cuff = P.capsule(P.mask(), A, mid(A, B, 0.7), 1.95, 1.9);
    const legSkin = shin.clone();
    legSkin.add(thigh);
    legSkin.cut(cuff);
    const ts = thighSh(p.skin);
    const ss = shinSh(p.skin);
    P.paint(legSkin, (x, y) => (thigh.has(x, y) ? ts(x, y) : ss(x, y)));
    P.paint(cuff, thighSh(p.bottom));
    return;
  }
  const ts = thighSh(style === 'pants' ? p.bottom : p.skin);
  const ss = shinSh(style === 'pants' ? p.bottom : p.skin);
  const all = shin.clone();
  all.add(thigh);
  P.paint(all, (x, y) => (thigh.has(x, y) ? ts(x, y) : ss(x, y)));
}

function drawShoe(c: Ctx, leg: LegRig): void {
  const { P, p } = c;
  const k = leg.c;
  const pitch = leg.pitch;
  const lift = k.z - 1.5;
  // calcanhar e ponta (pitch > 0: ponta para cima; < 0: na ponta dos pés)
  const heelZ = 1 + Math.max(0, -pitch) * 2.4 + lift;
  const toeZ = 1 + Math.max(0, pitch) * 1.8 + lift;
  const heel = pt(c, k.f - 1, k.n, heelZ);
  const toe = pt(c, k.f + 2.3, k.n + 0.1, toeZ);
  const mk = P.capsule(P.mask(), heel, toe, 1.25, 1.3);
  const s = p.shoes;
  const sole = shade(s.dd, -0.05);
  P.paint(mk, (x, y) => {
    if (!mk.has(x, y + 1)) return sole;
    if (!mk.has(x, y - 1)) return !mk.has(x - 1, y) ? s.hi : s.lt;
    if (!mk.has(x + 1, y)) return s.dk;
    return s.base;
  });
}

// ------------------------------------------------------------ braços e mãos

/** Comprimento da manga: fração do braço (0..1 = ombro..cotovelo, 1..2 = cotovelo..punho). */
export function sleeveOf(a: Appearance): number {
  switch (a.topStyle) {
    case 'tshirt':
    case 'polo':
      return 0.65;
    case 'blouse':
      return 1.3;
    default:
      return 1.88;
  }
}

/** Braço (sem a mão): parte de cima e antebraço, com manga. */
export function drawArm(c: Ctx, arm: ArmRig, opts: { dim?: number } = {}): void {
  const { P, p, a } = c;
  const S = pj(c, arm.a);
  const E = pj(c, arm.b);
  const W = pj(c, arm.c);
  const sl = sleeveOf(a);
  const dim = opts.dim ?? 0;
  const sleeveM = dim ? ramp(shade(p.top.base, -dim), 0.075) : p.top;
  const skinM = dim ? ramp(shade(p.skin.base, -dim), 0.06) : p.skin;
  const [sx, sy] = scr(c, S);
  const [ex, ey] = scr(c, E);
  const [wx, wy] = scr(c, W);
  const upper = P.capsule(P.mask(), S, E, 1.45, 1.35);
  const fore = P.capsule(P.mask(), E, W, 1.3, 1.15);
  const cut = sl <= 1 ? mid(S, E, sl) : mid(E, W, sl - 1);
  const sleeve = sl <= 1 ? P.capsule(P.mask(), S, cut, 1.6, 1.55) : P.capsule(P.capsule(P.mask(), S, E, 1.6, 1.5), E, cut, 1.5, 1.4);
  const all = upper.clone();
  all.add(fore);
  all.add(sleeve);
  const [cx, cy] = scr(c, cut);
  const slFore = tubeShade(sleeveM, ex, ey, wx, wy, 1.4);
  const slUp = tubeShade(sleeveM, sx, sy, ex, ey, 1.5);
  const skFore = tubeShade(skinM, ex, ey, wx, wy, 1.2);
  const skUp = tubeShade(skinM, sx, sy, ex, ey, 1.3);
  P.paint(all, (x, y) => {
    const onFore = fore.has(x, y) && !upper.has(x, y);
    if (sleeve.has(x, y)) {
      // barra da manga mais escura
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 1.3) return sleeveM.dk;
      return onFore ? slFore(x, y) : slUp(x, y);
    }
    return onFore ? skFore(x, y) : skUp(x, y);
  });
}

/** Mão no punho do braço, conforme o formato. */
export function drawHand(c: Ctx, arm: ArmRig, dim = 0): void {
  const { P, p } = c;
  const W = pj(c, arm.c);
  const E = pj(c, arm.b);
  const skin = dim ? ramp(shade(p.skin.base, -dim), 0.06) : p.skin;
  const shape = arm.hand;
  if (shape === 'paper' || shape === 'scissors' || shape === 'rock') {
    drawGesture(c, shape, W, skin);
    return;
  }
  const dx = W[0] - E[0];
  const dy = W[1] - E[1];
  const l = Math.hypot(dx, dy) || 1;
  const hc: V2 = [W[0] + (dx / l) * 0.8, W[1] + (dy / l) * 0.8];
  const r = shape === 'fist' ? 1.45 : 1.3;
  const mk = P.ellipse(P.mask(), hc[0], hc[1], r, r);
  const [hx, hy] = scr(c, hc);
  P.paint(mk, sphereShade(skin, hx, hy, r + 0.4, r + 0.4, 0.25), { soft: 0.35 });
}

/** Gestos do jokenpô (pele), maiores que a mão parada para ler de longe. */
const GESTURE_T: Readonly<Record<'rock' | 'paper' | 'scissors', { rows: readonly string[]; x: number; y: number }>> = {
  rock: { rows: ['.ss.', 'ssss', 'sSsS', '.SS.'], x: -1, y: -2 },
  paper: { rows: ['s.s.s', 'sssss', 'sssss', '.SSS.'], x: -2, y: -3 },
  scissors: { rows: ['s..s', '.ss.', '.sS.', '.SS.'], x: -1, y: -3 },
};

function drawGesture(c: Ctx, kind: 'rock' | 'paper' | 'scissors', W: V2, skin: Ramp): void {
  const { P } = c;
  const g = GESTURE_T[kind];
  const mk = P.mask();
  const x0 = Math.round(W[0]) + g.x;
  const y0 = Math.round(W[1]) + g.y;
  const dark = new Set<number>();
  g.rows.forEach((row, ry) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      const sx = P.m === 1 ? Math.floor(P.ax + x0 + i) : Math.floor(P.ax - (x0 + i) - 1);
      const sy = Math.floor(P.ay + y0 + ry);
      mk.put(sx, sy, true);
      if (ch === 'S') dark.add(sy * 1000 + sx);
    }
  });
  // luz sempre de cima/esquerda, também no espelho
  P.paint(mk, (x, y) => (dark.has(y * 1000 + x) || !mk.has(x + 1, y) ? skin.dk : !mk.has(x - 1, y) || !mk.has(x, y - 1) ? skin.lt : skin.base), { soft: 0.2 });
}
