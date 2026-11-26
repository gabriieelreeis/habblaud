// Cabeça do personagem isométrico (puro): crânio + mandíbula virados 3/4, orelha do lado de perto, rosto
// (olhos de 1 px, sobrancelhas, boca) e barba/bigode. Coordenadas locais da cabeça: (0, 0) é o centro projetado
// (arredondado), x para a direita da tela (antes do espelho), y para baixo.
import { mix, shade } from '../core/color';
import { pj, type Ctx } from './body';
import { sphereShade, type Mask, type V2 } from './paint';
import { J3 } from './rig';

export const HEAD_RX = 4.5;
export const HEAD_RY = 4.5;

export function headCenter(c: Ctx): V2 {
  const q = pj(c, c.r.head);
  return [Math.round(q[0]), Math.round(q[1])];
}

/** Máscara da cabeça (crânio + mandíbula), sem orelha. O queixo puxa para o lado do rosto. */
export function headMask(c: Ctx): Mask {
  const { P } = c;
  const [hx, hy] = headCenter(c);
  const s = c.v.back ? 1 : -1;
  const mk = P.ellipse(P.mask(), hx - s * 0.2, hy - 0.5, HEAD_RX, HEAD_RY);
  P.ellipse(mk, hx + s * 0.7, hy + 1.6, 3.7, 3.1);
  return mk;
}

export function drawNeck(c: Ctx): void {
  const { P, r, p } = c;
  const a = pj(c, J3(r.chest.f, 0, r.chest.z - 0.5));
  const b = pj(c, J3((r.chest.f + r.head.f) / 2, 0, r.head.z - 3.4));
  const mk = P.capsule(P.mask(), a, b, 1.5, 1.4);
  P.paint(mk, (x, y) => (!mk.has(x - 1, y) ? p.skin.base : p.skin.dk), { soft: 0.4 });
}

export function drawHeadSkin(c: Ctx): Mask {
  const { P, p } = c;
  const [hx, hy] = headCenter(c);
  const mk = headMask(c);
  P.paint(mk, sphereShade(p.skin, P.X(hx) + 0.5, P.Y(hy - 0.5) + 0.5, HEAD_RX + 1.2, HEAD_RY + 1.4, 0.3), { soft: 0.35 });
  return mk;
}

/** Orelha do lado de perto (as duas vistas a mostram à direita, antes do espelho). */
export function drawEar(c: Ctx): void {
  const { P, p, r } = c;
  const [hx, hy] = headCenter(c);
  const ex = hx + (c.v.back ? 2.6 : 3.4);
  const ey = hy + 0.6 + (r.nod > 1 ? 1 : 0);
  P.dot(ex, ey, p.skin.base);
  P.dot(ex, ey + 1, p.skin.dk);
  P.dot(ex + 1, ey, p.skin.dk);
  P.dot(ex + 1, ey + 1, shade(p.skin.dk, -0.05));
}

/** Um olho de 1 px de largura (2 de altura) na coluna local x. */
function eye(c: Ctx, x: number, y: number, outer: -1 | 1): void {
  const { P, p, r } = c;
  switch (r.eyes) {
    case 'closed':
      P.dot(x, y + 1, p.lash);
      P.dot(x + outer, y + 1, mix(p.lash, p.skin.base, 0.5));
      return;
    case 'happy':
      P.dot(x, y, p.lash);
      P.dot(x - 1, y + 1, mix(p.lash, p.skin.base, 0.3));
      P.dot(x + 1, y + 1, mix(p.lash, p.skin.base, 0.3));
      return;
    case 'half':
      P.dot(x, y, shade(p.skin.dk, -0.08));
      P.dot(x, y + 1, p.lash);
      return;
    default:
      P.dot(x, y, p.lash);
      P.dot(x, y + 1, p.darkSkin ? p.irisLt : p.iris);
      if (c.a.look === 'f') P.dot(x + outer, y, mix(p.lash, p.skin.base, 0.35));
  }
}

/** Rosto (só na vista de frente): sobrancelhas, olhos, boca e bochechas. */
export function drawFace(c: Ctx): void {
  if (c.v.back) return;
  const { P, p, r } = c;
  const [hx, hy] = headCenter(c);
  const ny = hy + Math.min(1, r.nod);
  const farX = hx - 3;
  const nearX = hx;
  eye(c, farX, ny, -1);
  eye(c, nearX, ny, 1);
  // sobrancelhas (1 px acima, a franja costuma cobri-las em parte)
  const by = ny - 2;
  const brow = p.brow;
  if (r.brows === 'sad') {
    P.dot(farX, by, brow);
    P.dot(farX + 0.6, by - 1, brow);
    P.dot(nearX, by - 1, brow);
    P.dot(nearX + 1, by, brow);
  } else {
    const dy = r.brows === 'up' ? -1 : 0;
    P.dot(farX, by + dy, brow);
    P.dot(nearX, by + dy, brow);
    P.dot(nearX + 1, by + dy + (r.brows === 'flat' ? 0 : 0), brow);
  }
  // bochechas
  if (r.eyes !== 'half' && c.a.look === 'f') {
    P.dot(farX - 0.6, ny + 2, p.blush);
    P.dot(nearX + 1, ny + 2, p.blush);
  }
  drawMouth(c, hx - 2, ny + 3);
}

function drawMouth(c: Ctx, mx: number, my: number): void {
  const { P, p, r } = c;
  const d = (x: number, y: number, col: string) => P.dot(mx + x, my + y, col);
  switch (r.mouth) {
    case 'smile':
      d(0, 0, p.lip);
      d(1, 0, mix(p.lip, p.skin.base, 0.45));
      break;
    case 'none':
      d(0, 0, mix(p.mouth, p.skin.base, 0.35));
      break;
    case 'frown':
      d(0, 0, p.mouth);
      d(-1, 1, mix(p.mouth, p.skin.base, 0.3));
      d(1, 1, mix(p.mouth, p.skin.base, 0.3));
      break;
    case 'o':
    case 'chew':
      d(0, 0, p.mouthOpen);
      break;
    case 'open':
      d(0, 0, p.mouthOpen);
      d(1, 0, p.mouthOpen);
      d(0, 1, p.tongue);
      break;
    case 'wide':
      d(-1, 0, p.mouthOpen);
      d(0, 0, '#fbf6f0');
      d(1, 0, p.mouthOpen);
      d(0, 1, p.tongue);
      d(-1, 1, p.mouthOpen);
      break;
  }
}

/** Barba, bigode, cavanhaque ou barba por fazer (só look 'm'). */
export function drawFacialHair(c: Ctx, head: Mask): void {
  const style = c.a.facialHair ?? 'none';
  if (style === 'none') return;
  const { P, p, r } = c;
  const [hx, hy] = headCenter(c);
  const ny = hy + Math.min(1, r.nod);
  const h = p.hair;
  const stub = style === 'stubble';
  const mk = P.mask();
  const col = (x: number, y: number) => (stub ? ((x + y) % 2 === 0 ? p.stubble : mix(p.stubble, p.skin.base, 0.5)) : !mk.has(x + 1, y) || !mk.has(x, y + 1) ? h.dk : h.base);
  if (c.v.back) {
    if (style === 'beard' || style === 'stubble') {
      P.ellipse(mk, hx + 2.6, hy + 2.6, 2.6, 2.4);
      mk.keep(head);
      P.paint(mk, col, { contour: false });
    }
    return;
  }
  const mx = hx - 2;
  const my = ny + 3;
  if (style === 'beard' || style === 'stubble') {
    P.ellipse(mk, hx - 0.4, ny + 2.8, 4.6, 2.8);
    mk.keep(head);
    P.ellipse(mk, hx - 0.8, ny - 1.6, 4.6, 3.4, false);
    if (!stub) P.rect(mk, mx - 0.6, my - 1, 3, 1);
    P.paint(mk, col, { contour: false });
    P.dot(mx, my, stub ? p.lip : p.mouth);
    return;
  }
  if (style === 'mustache') {
    P.rect(mk, mx - 1, my - 1, 3, 1);
    P.paint(mk, col, { contour: false });
    return;
  }
  // cavanhaque
  P.rect(mk, mx - 0.5, my + 1, 2, 1.6);
  P.rect(mk, mx - 1, my - 1, 3, 1);
  mk.keep(head);
  P.paint(mk, col, { contour: false });
}
