// Corpo e roupas: pescoço, tronco com a peça de cima, braços, quadril, saia, pernas e sapatos.
import { luminance, mix, shade } from '../core/color';
import { AX, AY, Layer, composite, rnd } from './paint';
import { proj, type Ctx, type Limb } from './rig';

export const put = (c: Ctx, L: Layer): void => composite(c.buf, L, c.mirror, c.dx, c.dy);

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

/** Capuz do moletom: um colarinho volumoso atrás do pescoço, com forro na cor de destaque. */
export function drawHood(c: Ctx): void {
  const L = new Layer();
  const p = proj(c.v, 0, -2.6, c.rig.torsoTop + 0.6);
  L.blob(p.x, p.y, 5.4 * widthK(c, 0.7) + 0.5, 2.3, c.look.topColor, 2);
  if (c.v.c > 0.2) {
    const q = proj(c.v, 0, -1.6, c.rig.torsoTop + 0.9);
    L.blob(q.x, q.y, 3.6 * widthK(c, 0.7) + 0.4, 1.4, c.look.accent, 2);
  }
  L.vw = 0.5;
  put(c, L);
}

export function hoodDepth(c: Ctx): number {
  return proj(c.v, 0, -3.6, 0).d;
}

const SLEEVELESS = new Set(['tank', 'dress']);

export function drawTorso(c: Ctx): void {
  const { look, v, rig } = c;
  const L = new Layer();
  L.vw = 0.4;
  const y0 = Math.round(AY - rig.torsoTop);
  const y1 = Math.round(AY - rig.torsoBot);
  const n = y1 - y0;
  const top = look.top;
  const tab = look.body === 'b' ? TORSO_B : TORSO_A;
  const bulk = top === 'sweater' || top === 'hoodie' ? 1 : 0;
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
    const w = tab[Math.round((i * (tab.length - 1)) / Math.max(1, n - 1))] + (i > 0 ? bulk : 0);
    const [l, r] = span(Math.max(2, rnd(w * k)));
    rows.push([l, r]);
    L.row(y0 + i, l, r, tc);
  }
  const hem = shade(tc, -0.1);

  if (front && wN > 0) {
    const gap = (i: number, w: number, c2: string) => {
      if (w <= 0) return;
      const [gl, gr] = place(w);
      for (let x = gl; x <= gr; x++) if (L.has(x, y0 + i)) L.fill(x, y0 + i, c2);
    };
    if (top === 'tee' || top === 'hoodie' || top === 'polo' || top === 'jacket' || top === 'dress') {
      gap(0, wN, sk);
      gap(1, wN - 2, sk);
    } else if (top === 'tank') {
      gap(0, wN + 1, sk);
      gap(1, wN + 1, sk);
      gap(2, wN - 1, sk);
      for (let i = 1; i <= 4; i++) {
        L.fill(rows[i][0], y0 + i, sk);
        L.fill(rows[i][1], y0 + i, sk);
      }
    } else if (top === 'suit') {
      gap(0, wN, WHITE);
      gap(1, wN - 1, WHITE);
      gap(2, wN - 2, WHITE);
      gap(3, Math.max(0, wN - 3), WHITE);
    } else if (top === 'shirt_tie') {
      gap(0, wN, WHITE);
      gap(1, wN - 1, WHITE);
    } else if (top === 'sweater') {
      gap(0, wN - 1, sk);
    } else if (top === 'blouse') {
      gap(0, wN, sk);
      gap(1, wN - 1, sk);
      gap(2, Math.max(0, wN - 3), sk);
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
      for (const [x, y] of [[gl - 1, 1], [gl - 1, 0], [gr + 1, 1], [gr + 1, 0]] as const) L.fix(x, y0 + y, look.accent);
      for (const x of [gl, gr]) L.fix(x, y0 + 2, look.accent);
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
    if (top === 'suit' || top === 'shirt_tie') {
      const [tl] = place(1);
      const len = top === 'suit' ? 6 : 8;
      for (let i = 1; i <= len; i++) L.fix(tl, y0 + i, look.accent);
      L.fix(tl, y0 + len + 1, shade(look.accent, -0.2));
      if (wN >= 3) L.fix(tl + 1, y0 + 2, shade(look.accent, -0.1));
      if (top === 'suit') {
        const [gl, gr] = place(wN);
        for (let i = 0; i < 4; i++) {
          L.fix(gl - 1 + (i > 2 ? 1 : 0), y0 + i, shade(tc, -0.22));
          L.fix(gr + 1 - (i > 2 ? 1 : 0), y0 + i, shade(tc, -0.22));
        }
        L.fix(tl, y0 + 9, shade(tc, -0.3));
      } else {
        // colarinho e botões
        const [gl, gr] = place(wN);
        L.fix(gl - 1, y0, WHITE);
        L.fix(gr + 1, y0, WHITE);
        L.fix(gl - 1, y0 + 1, WHITE);
        L.fix(gr + 1, y0 + 1, WHITE);
        for (let i = 3; i < n; i += 3) L.fix(tl + 1, y0 + i, shade(tc, 0.2));
      }
    }
    if (top === 'blouse') {
      // babado no decote e laço pequeno
      const [gl, gr] = place(wN);
      for (const x of [gl - 1, gr + 1]) {
        L.fix(x, y0, mix(tc, '#ffffff', 0.5));
        L.fix(x, y0 + 1, mix(tc, '#ffffff', 0.35));
      }
      const [bl] = place(2);
      L.fix(bl, y0 + 3, look.accent);
      L.fix(bl + 1, y0 + 3, look.accent);
    }
  }
  // gola e barra de tricô do suéter: valem em qualquer direção
  if (top === 'sweater') {
    const rib = shade(tc, -0.14);
    const [l0, r0] = rows[0];
    for (let x = l0; x <= r0; x++) if (!L.has(x, y0) || L.get(x, y0) === tc) L.fix(x, y0, rib);
    for (const i of [n - 2, n - 1]) {
      const [l, r] = rows[i];
      for (let x = l; x <= r; x++) L.fix(x, y0 + i, (x + i) % 2 ? rib : shade(tc, -0.05));
    }
    for (let i = 3; i < n - 2; i += 3) {
      const [l, r] = rows[i];
      for (let x = l + 1 + (i % 2); x < r; x += 3) L.fix(x, y0 + i, shade(tc, 0.07));
    }
  }
  if (top === 'hoodie' || top === 'jacket') {
    const [l, r] = rows[n - 1];
    for (let x = l; x <= r; x++) L.fix(x, y0 + n - 1, hem);
  }
  if (top === 'suit') {
    const [l, r] = rows[n - 1];
    for (let x = l; x <= r; x++) L.fix(x, y0 + n - 1, shade(tc, -0.08));
  }
  put(c, L);
}

/** Fração do braço (0 ombro, 1 mão) coberta pela manga. */
function sleeveEnd(top: string): number {
  switch (top) {
    case 'tee':
    case 'polo':
      return 0.4;
    case 'blouse':
      return 0.62;
    case 'hoodie':
    case 'jacket':
    case 'suit':
    case 'shirt_tie':
      return 0.86;
    case 'sweater':
      return 0.9;
    case 'dress':
      return 0.18;
    default:
      return SLEEVELESS.has(top) ? 0 : 0.4;
  }
}

/** Segmento duplo (raiz -> articulação -> ponta) com a cor dependendo da posição ao longo do membro. */
function limbSeg(c: Ctx, L: Layer, lb: Limb, w: number, colorAt: (t: number) => string | undefined): void {
  const r = proj(c.v, lb.root.l, lb.root.f, lb.root.z);
  const m = proj(c.v, lb.mid.l, lb.mid.f, lb.mid.z);
  const e = proj(c.v, lb.end.l, lb.end.f, lb.end.z);
  L.seg(r.x, r.y, m.x, m.y, w, colorAt, 0, 0.5);
  L.seg(m.x, m.y, e.x, e.y, w, colorAt, 0.5, 1);
}

export function drawArm(c: Ctx, i: 0 | 1, inner: boolean): void {
  const { look, rig } = c;
  const a = rig.arms[i];
  const L = new Layer();
  L.inner = inner;
  const sl = sleeveEnd(look.top);
  const sleeve = look.topColor;
  limbSeg(c, L, a, 3, (t) => (t < sl ? sleeve : look.skin));
  if (look.top === 'suit' || look.top === 'jacket' || look.top === 'sweater' || look.top === 'shirt_tie') {
    // punho: uma linha mais escura onde a manga termina
    const e = proj(c.v, a.end.l, a.end.f, a.end.z);
    const m = proj(c.v, a.mid.l, a.mid.f, a.mid.z);
    const r = proj(c.v, a.root.l, a.root.f, a.root.z);
    const p = sl <= 0.5 ? [r, m, sl / 0.5] : [m, e, (sl - 0.5) / 0.5];
    const q0 = p[0] as { x: number; y: number };
    const q1 = p[1] as { x: number; y: number };
    const tt = p[2] as number;
    const ys = Math.round(q0.y + (q1.y - q0.y) * tt) - 1;
    for (let x = 0; x < 40; x++) if (L.has(x, ys) && L.get(x, ys) === sleeve && !L.has(x, ys + 1)) L.fix(x, ys, shade(sleeve, -0.12));
  }
  put(c, L);
}

export function drawPelvis(c: Ctx): void {
  const { look, rig } = c;
  if (look.top === 'dress' || look.bottom === 'skirt' || look.bottom === 'long_skirt') return;
  const L = new Layer();
  const y0 = Math.round(AY - rig.torsoBot);
  const w = Math.max(2, rnd((look.body === 'b' ? HIPS_B : HIPS_A) * widthK(c)));
  const [l, r] = span(w);
  for (let y = y0; y < y0 + 3; y++) L.row(y, l, r, look.bottomColor);
  put(c, L);
}

export function drawSkirt(c: Ctx): void {
  const { look, rig } = c;
  const dress = look.top === 'dress';
  const long = look.bottom === 'long_skirt';
  if (!dress && look.bottom !== 'skirt' && !long) return;
  const col = dress ? look.topColor : look.bottomColor;
  const L = new Layer();
  L.vw = 0.5;
  const y0 = Math.round(AY - rig.torsoBot);
  const rowsN = long && !dress ? (rig.seated ? 8 : 12) : dress ? 7 : 6;
  const w0 = look.body === 'b' ? HIPS_B : HIPS_A;
  const k = widthK(c, 0.85);
  const flare = long ? 5 : 4;
  for (let i = 0; i < rowsN; i++) {
    const w = Math.max(2, rnd((w0 + (i * flare) / (rowsN - 1)) * k));
    const [l, r] = span(w);
    L.row(y0 + i, l, r, col);
    // pregas da saia longa
    if (long && i > 2 && i % 2 === 0 && w > 6) L.fix(l + 2 + (i % 4 ? 1 : 0), y0 + i, shade(col, -0.1));
  }
  // barra um tom mais escura
  const [hl, hr] = span(Math.max(2, rnd((w0 + flare) * k)));
  for (let x = hl; x <= hr; x++) L.fix(x, y0 + rowsN - 1, shade(col, -0.13));
  put(c, L);
}

export function drawLeg(c: Ctx, i: 0 | 1): void {
  const { look, v, rig } = c;
  const lg = rig.legs[i];
  const L = new Layer();
  const skirted = look.top === 'dress' || look.bottom === 'skirt' || look.bottom === 'long_skirt';
  const boot = look.shoes === 'boots';
  limbSeg(c, L, lg, 3, (t) => {
    if (boot && t > 0.52) return look.shoesColor;
    if (skirted) return look.skin;
    if (look.bottom === 'shorts') return t < 0.42 ? look.bottomColor : look.skin;
    return look.bottomColor;
  });
  if (look.bottom === 'slacks' && !skirted) {
    // vinco da calça: um traço claro no meio da perna, só de frente
    if (v.c > 0.4 && !rig.seated) {
      const r = proj(v, lg.root.l, lg.root.f, lg.root.z);
      const e = proj(v, lg.end.l, lg.end.f, lg.end.z);
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
  // contorno interno: separa um sapato do outro e da barra da calça
  L.inner = true;
  const z0 = lg.end.z - 3;
  const wb = Math.max(2, rnd(1.6 + 1.6 * Math.abs(v.c)));
  const boot = look.shoes === 'boots';
  const sandal = look.shoes === 'sandals';
  const h = boot ? 4 : sandal ? 2 : 3;
  const col = sandal ? look.skin : look.shoesColor;
  const steps = 6;
  for (let s = 0; s <= steps; s++) {
    const f = lg.end.f - 1.3 + (4.0 * s) / steps;
    const p = proj(v, lg.end.l, f, z0);
    const yb = Math.round(p.y - 0.6);
    const left = AX + rnd(p.x - AX - wb / 2);
    for (let y = yb - h; y < yb; y++) for (let x = left; x < left + wb; x++) L.fill(x, y, col);
  }
  // sola: a linha de baixo da forma
  const sole = sandal ? shade(look.shoesColor, -0.1) : look.shoes === 'dress' || boot ? shade(col, -0.3) : luminance(col) > 0.78 ? '#c4c8d4' : '#f2f2f6';
  for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && !L.has(x, y + 1)) L.fix(x, y, sole);
  if (sandal) {
    // tira sobre o pé
    for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && !L.has(x, y - 1) && L.get(x, y) === col) L.fix(x, y, look.shoesColor);
  }
  if (look.shoes === 'dress') {
    // brilho no bico
    for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && !L.has(x, y - 1) && !L.has(x - 1, y) && L.has(x + 1, y)) L.fix(x + 1, y, mix(col, '#ffffff', 0.45));
  }
  put(c, L);
}
