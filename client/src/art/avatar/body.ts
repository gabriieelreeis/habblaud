// Corpo e roupas: pescoço, tronco com a peça de cima, braços, quadril, saia, pernas e sapatos.
import { luminance, mix, shade } from '../core/color';
import { AX, AY, Layer, composite, rnd } from './paint';
import { proj, type Ctx } from './rig';

export const put = (c: Ctx, L: Layer): void => composite(c.buf, L, c.mirror);

/** Fator de largura de uma forma com `ratio` = profundidade/largura, vista no ângulo atual. */
export const widthK = (c: Ctx, ratio = 0.7): number => Math.sqrt(c.v.c ** 2 + (ratio * c.v.s) ** 2);

/** Faixa [esquerda, direita] simétrica em torno de AX para uma largura. */
function span(w: number): [number, number] {
  const l = AX + rnd(-w / 2);
  return [l, l + w - 1];
}

// larguras por linha do tronco, de cima (ombro) para baixo
const TORSO_A = [8, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 9];
const TORSO_B = [8, 10, 10, 9, 8, 7, 7, 7, 8, 9, 10, 10, 10];
const HIPS_A = 9;
const HIPS_B = 10;

const WHITE = '#f3efe6';

export function drawNeck(c: Ctx): void {
  const L = new Layer();
  const y = Math.round(AY - c.rig.torsoTop) - 1;
  const [l, r] = span(Math.max(2, rnd(4 * widthK(c, 0.9))));
  L.row(y, l, r, shade(c.look.skin, -0.12));
  put(c, L);
}

/** Capuz do moletom: um colarinho volumoso atrás do pescoço. */
export function drawHood(c: Ctx): void {
  const L = new Layer();
  const p = proj(c.v, 0, -2.6, c.rig.torsoTop + 0.6);
  L.blob(p.x, p.y, 5.4 * widthK(c, 0.7) + 0.5, 2.3, c.look.topColor, 2);
  L.vw = 0.5;
  put(c, L);
}

export function hoodDepth(c: Ctx): number {
  return proj(c.v, 0, -3.6, 0).d;
}

export function drawTorso(c: Ctx): void {
  const { look, v, rig } = c;
  const L = new Layer();
  L.vw = 0.4;
  const y0 = Math.round(AY - rig.torsoTop);
  const y1 = Math.round(AY - rig.torsoBot);
  const n = y1 - y0;
  const tab = look.body === 'b' ? TORSO_B : TORSO_A;
  const k = widthK(c);
  const tc = look.topColor;
  const sk = look.skin;
  const front = v.c > 0.25;
  const xn = AX - 3.3 * v.s; // centro do desenho da frente do tronco
  const wN = Math.max(0, rnd(5 * Math.abs(v.c)));
  const place = (w: number): [number, number] => {
    const l = AX + rnd(xn - AX - w / 2);
    return [l, l + w - 1];
  };
  const rows: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const w = tab[Math.round((i * (tab.length - 1)) / Math.max(1, n - 1))];
    const [l, r] = span(Math.max(2, rnd(w * k)));
    rows.push([l, r]);
    L.row(y0 + i, l, r, tc);
  }
  const top = look.top;
  const hem = shade(tc, -0.1);

  if (front && wN > 0) {
    const gap = (i: number, w: number, c2: string) => {
      if (w <= 0) return;
      const [gl, gr] = place(w);
      for (let x = gl; x <= gr; x++) if (L.has(x, y0 + i)) L.fill(x, y0 + i, c2);
    };
    if (top === 'tee' || top === 'hoodie' || top === 'polo' || top === 'jacket') {
      gap(0, wN, sk);
      gap(1, wN - 2, sk);
    } else if (top === 'tank') {
      gap(0, wN + 1, sk);
      gap(1, wN + 1, sk);
      gap(2, wN - 1, sk);
      const [l, r] = rows[1];
      for (let i = 1; i <= 4; i++) {
        L.fill(rows[i][0], y0 + i, sk);
        L.fill(rows[i][1], y0 + i, sk);
      }
      void l;
      void r;
    } else if (top === 'dress') {
      gap(0, wN, sk);
      gap(1, wN - 2, sk);
    } else if (top === 'suit') {
      gap(0, wN, WHITE);
      gap(1, wN - 1, WHITE);
      gap(2, wN - 2, WHITE);
      gap(3, Math.max(0, wN - 3), WHITE);
    }
    if (top === 'jacket') {
      // zíper e gola
      const [zl] = place(1);
      for (let i = 2; i < n; i++) L.fix(zl, y0 + i, shade(tc, -0.2));
      const [gl, gr] = place(wN);
      L.fix(gl - 1, y0, shade(tc, 0.1));
      L.fix(gr + 1, y0, shade(tc, 0.1));
    }
    if (top === 'polo') {
      const [pl] = place(1);
      for (let i = 2; i <= 5; i++) L.fix(pl, y0 + i, shade(tc, -0.2));
      const [gl, gr] = place(wN);
      L.fix(gl - 1, y0 + 1, shade(tc, 0.14));
      L.fix(gl - 1, y0, shade(tc, 0.14));
      L.fix(gr + 1, y0 + 1, shade(tc, 0.14));
      L.fix(gr + 1, y0, shade(tc, 0.14));
    }
    if (top === 'hoodie') {
      // cordões e bolso canguru
      const [gl, gr] = place(Math.max(2, wN - 2));
      for (let i = 2; i <= 4; i++) {
        L.fix(gl, y0 + i, '#e9e6dd');
        L.fix(gr, y0 + i, '#e9e6dd');
      }
      const [pl, pr] = place(Math.max(3, rnd(6 * Math.abs(v.c))));
      L.row(y0 + n - 5, pl, pr, shade(tc, -0.14));
    }
    if (top === 'suit') {
      const [tl] = place(1);
      for (let i = 1; i <= 6; i++) L.fix(tl, y0 + i, '#9c2f45');
      const [gl, gr] = place(wN);
      for (let i = 0; i < 4; i++) {
        L.fix(gl - 1 + (i > 2 ? 1 : 0), y0 + i, shade(tc, -0.22));
        L.fix(gr + 1 - (i > 2 ? 1 : 0), y0 + i, shade(tc, -0.22));
      }
      L.fix(tl, y0 + 9, shade(tc, -0.3));
    }
  }
  if (top === 'hoodie' || top === 'jacket') {
    const [l, r] = rows[n - 1];
    L.row(y0 + n - 1, l, r, hem);
    for (let x = l; x <= r; x++) L.fix(x, y0 + n - 1, hem);
  }
  if (top === 'suit') {
    const [l, r] = rows[n - 1];
    for (let x = l; x <= r; x++) L.fix(x, y0 + n - 1, shade(tc, -0.08));
  }
  put(c, L);
}

/** Cor de cada trecho do braço (t: 0 ombro, 1 mão). */
function sleeveEnd(top: string): number {
  switch (top) {
    case 'tee':
    case 'polo':
      return 0.4;
    case 'hoodie':
    case 'jacket':
    case 'suit':
      return 0.86;
    case 'dress':
      return 0.18;
    default:
      return 0;
  }
}

export function drawArm(c: Ctx, i: 0 | 1, inner: boolean): void {
  const { look, v, rig } = c;
  const a = rig.arms[i];
  const r = proj(v, a.root.l, a.root.f, a.root.z);
  const e = proj(v, a.end.l, a.end.f, a.end.z);
  const L = new Layer();
  L.inner = inner;
  const sl = sleeveEnd(look.top);
  const sleeve = look.topColor;
  L.seg(r.x, r.y, e.x, e.y, 3, (t) => (t < sl ? sleeve : look.skin));
  if (look.top === 'suit' || look.top === 'jacket') {
    // punho: uma linha mais escura onde a manga termina
    const ys = Math.round(r.y + (e.y - r.y) * sl) - 1;
    for (let x = 0; x < 40; x++) if (L.has(x, ys) && L.get(x, ys) === sleeve && !L.has(x, ys + 1)) L.fix(x, ys, shade(sleeve, -0.12));
  }
  put(c, L);
}

export function drawPelvis(c: Ctx): void {
  const { look, rig } = c;
  if (look.top === 'dress' || look.bottom === 'skirt') return;
  const L = new Layer();
  const y0 = Math.round(AY - rig.torsoBot);
  const w = Math.max(2, rnd((look.body === 'b' ? HIPS_B : HIPS_A) * widthK(c)));
  const [l, r] = span(w);
  for (let y = y0; y < y0 + 3; y++) L.row(y, l, r, look.bottom === 'shorts' || look.bottom === 'slacks' || look.bottom === 'jeans' ? look.bottomColor : look.skin);
  put(c, L);
}

export function drawSkirt(c: Ctx): void {
  const { look, rig } = c;
  const dress = look.top === 'dress';
  if (!dress && look.bottom !== 'skirt') return;
  const col = dress ? look.topColor : look.bottomColor;
  const L = new Layer();
  L.vw = 0.5;
  const y0 = Math.round(AY - rig.torsoBot);
  const rowsN = dress ? 7 : 6;
  const w0 = look.body === 'b' ? HIPS_B : HIPS_A;
  const k = widthK(c, 0.85);
  for (let i = 0; i < rowsN; i++) {
    const w = Math.max(2, rnd((w0 + (i * 4) / (rowsN - 1)) * k));
    const [l, r] = span(w);
    L.row(y0 + i, l, r, col);
  }
  // barra um tom mais escura
  const [hl, hr] = span(Math.max(2, rnd((w0 + 4) * k)));
  for (let x = hl; x <= hr; x++) L.fix(x, y0 + rowsN - 1, shade(col, -0.13));
  put(c, L);
}

export function drawLeg(c: Ctx, i: 0 | 1): void {
  const { look, v, rig } = c;
  const lg = rig.legs[i];
  const r = proj(v, lg.root.l, lg.root.f, lg.root.z);
  const e = proj(v, lg.end.l, lg.end.f, lg.end.z);
  const L = new Layer();
  const skirted = look.top === 'dress' || look.bottom === 'skirt';
  const boot = look.shoes === 'boots';
  L.seg(r.x, r.y, e.x, e.y, 3, (t) => {
    if (boot && t > 0.52) return look.shoesColor;
    if (skirted) return look.skin;
    if (look.bottom === 'shorts') return t < 0.42 ? look.bottomColor : look.skin;
    return look.bottomColor;
  });
  if (look.bottom === 'slacks' && !skirted) {
    // vinco da calça: um traço claro no meio da perna, só de frente
    if (v.c > 0.4) {
      const x = Math.round(r.x);
      for (let y = Math.round(r.y) + 3; y < Math.round(e.y) - 1; y++) if (L.has(x, y)) L.fix(x, y, shade(look.bottomColor, 0.1));
    }
  }
  put(c, L);
}

export function drawShoe(c: Ctx, i: 0 | 1): void {
  const { look, v, rig } = c;
  const lg = rig.legs[i];
  const L = new Layer();
  const z0 = lg.end.z - 3;
  const wb = Math.max(2, rnd(2 + 2 * Math.abs(v.c)));
  const boot = look.shoes === 'boots';
  const h = boot ? 4 : 3;
  const col = look.shoesColor;
  const steps = 7;
  for (let s = 0; s <= steps; s++) {
    const f = lg.end.f - 1.7 + (4.9 * s) / steps;
    const p = proj(v, lg.end.l, f, z0);
    const yb = Math.round(p.y - 0.6);
    const left = AX + rnd(p.x - AX - wb / 2);
    for (let y = yb - h; y < yb; y++) for (let x = left; x < left + wb; x++) L.fill(x, y, col);
  }
  // sola: a linha de baixo da forma
  const sole = look.shoes === 'dress' || boot ? shade(col, -0.3) : luminance(col) > 0.78 ? '#c4c8d4' : '#f2f2f6';
  for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && !L.has(x, y + 1)) L.fix(x, y, sole);
  if (look.shoes === 'dress') {
    // brilho no bico
    for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && !L.has(x, y - 1) && !L.has(x - 1, y) && L.has(x + 1, y)) L.fix(x + 1, y, mix(col, '#ffffff', 0.45));
  }
  put(c, L);
}
