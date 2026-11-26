// Cabeça: elipsoide de ~16x17 px. Cada pixel da tela tem uma normal (u, v, w) que o ângulo de giro leva para o espaço
// do personagem (l, f, v): é isso que diz, em qualquer direção, onde ficam rosto, orelhas e linha do cabelo.
import { mix, shade } from '../core/color';
import { AX, AY, Layer, rnd } from './paint';
import { put } from './body';
import type { Ctx } from './rig';

export const HEAD_RX = 8;
export const HEAD_RZ = 8.5;
const P = 2.4;

export const headCy = (c: Ctx): number => AY - c.rig.headZ;

export interface Surf {
  /** Dentro da superelipse. */
  inside: boolean;
  /** Normal no espaço do personagem: lateral, frente, altura (todas em -1..1). */
  l: number;
  f: number;
  v: number;
}

export function surf(c: Ctx, x: number, y: number, rx = HEAD_RX, rz = HEAD_RZ, cy = headCy(c)): Surf {
  const u = (x + 0.5 - AX) / rx;
  const v = (cy - (y + 0.5)) / rz;
  const inside = Math.abs(u) ** P + Math.abs(v) ** P <= 1;
  const w = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u + v * v)));
  return { inside, l: u * c.v.c + w * c.v.s, f: -u * c.v.s + w * c.v.c, v };
}

/** Ponto do rosto (lateral l, altura v em -1..1) projetado na tela; d > 0 quando está virado para o observador. */
export function facePt(c: Ctx, l: number, vv: number): { x: number; y: number; d: number } {
  const f = Math.sqrt(Math.max(0, 1 - l * l - vv * vv));
  const u = l * c.v.c - f * c.v.s;
  return { x: AX + HEAD_RX * u, y: headCy(c) - HEAD_RZ * vv, d: f * c.v.c + l * c.v.s };
}

export const EYE = '#2a2440';

/** Olhos como [coluna esquerda, linha de cima, largura] (já na ordem de desenho), só os visíveis. */
export function eyeBoxes(c: Ctx): { x: number; y: number; w: number; d: number }[] {
  const out: { x: number; y: number; w: number; d: number }[] = [];
  for (const l of [0.44, -0.44]) {
    const p = facePt(c, l, -0.26);
    const w = p.d > 0.62 ? 2 : p.d > 0.1 ? 1 : 0;
    if (!w) continue;
    out.push({ x: AX + rnd(p.x - AX - w / 2), y: Math.round(p.y - 1), w, d: p.d });
  }
  return out;
}

export function drawHead(c: Ctx): void {
  const { look, v } = c;
  const L = new Layer();
  L.hiT = 0.34;
  L.shT = -0.3;
  L.vw = 0.5;
  const cy = headCy(c);
  const sk = look.skin;
  for (let y = Math.floor(cy - HEAD_RZ); y <= Math.ceil(cy + HEAD_RZ); y++) {
    for (let x = AX - HEAD_RX - 1; x <= AX + HEAD_RX; x++) {
      const s = surf(c, x, y);
      if (!s.inside) continue;
      L.fill(x, y, sk);
      // orelha: faixa no meio da lateral da cabeça
      if (Math.abs(s.f) < 0.3 && Math.abs(s.l) > 0.8 && s.v < 0.02 && s.v > -0.34) L.fix(x, y, shade(sk, -0.1));
    }
  }
  // nariz: pixel saliente de perfil, ponto mais escuro de três quartos
  if (v.s > 0.9) {
    const p = facePt(c, 0, -0.32);
    L.fill(AX + rnd(p.x - AX) - 1, Math.round(p.y), sk);
  } else if (v.s > 0.4 && v.c > 0.3) {
    const p = facePt(c, 0, -0.32);
    L.fix(AX + rnd(p.x - AX), Math.round(p.y), shade(sk, -0.14));
  }
  // olhos
  const eyes = eyeBoxes(c);
  for (const e of eyes) {
    for (let i = 0; i < e.w; i++) {
      L.fix(e.x + i, e.y, EYE);
      L.fix(e.x + i, e.y + 1, EYE);
    }
    if (e.w === 2) L.fix(e.x, e.y, '#fdfdff');
  }
  // bochechas e boca
  const blush = mix(sk, '#ff6b80', 0.4);
  for (const l of [0.66, -0.66]) {
    const p = facePt(c, l, -0.5);
    if (p.d < 0.3) continue;
    const w = p.d > 0.62 ? 2 : 1;
    const x0 = AX + rnd(p.x - AX - w / 2);
    for (let i = 0; i < w; i++) L.fix(x0 + i, Math.round(p.y - 0.5), blush);
  }
  const m = facePt(c, 0, -0.62);
  if (m.d > 0.3) {
    const w = m.d > 0.72 ? 2 : 1;
    const x0 = AX + rnd(m.x - AX - w / 2);
    const mc = mix(sk, '#8a2f3c', 0.7);
    for (let i = 0; i < w; i++) L.fix(x0 + i, Math.round(m.y - 0.5), mc);
  }
  put(c, L);
}
