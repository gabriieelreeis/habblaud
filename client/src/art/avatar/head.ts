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
const MOUTH_IN = '#5a1f2c';

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
  const { look, v, rig } = c;
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
  // barba (a cor é a do cabelo); a boca vem por cima
  drawBeard(c, L);
  // olhos
  const eyes = eyeBoxes(c);
  const center = facePt(c, 0, -0.26).x;
  const browC = look.hair === 'bald' ? shade(sk, -0.4) : mix(look.hairColor, '#1c1a24', 0.35);
  for (const e of eyes) {
    const last = e.x + e.w - 1;
    // lado do nariz: o pixel da ponta mais perto do centro do rosto
    const innerRight = Math.abs(e.x + e.w - center) < Math.abs(e.x - center);
    switch (rig.eyes) {
      case 'closed':
        for (let i = 0; i < e.w; i++) L.fix(e.x + i, e.y + 1, EYE);
        break;
      case 'half':
        for (let i = 0; i < e.w; i++) {
          L.fix(e.x + i, e.y, shade(sk, -0.28));
          L.fix(e.x + i, e.y + 1, EYE);
        }
        break;
      case 'arc':
        for (let i = 0; i < e.w; i++) L.fix(e.x + i, e.y, EYE);
        L.fix(innerRight ? e.x : last, e.y + 1, EYE);
        break;
      default:
        for (let i = 0; i < e.w; i++) {
          L.fix(e.x + i, e.y, EYE);
          L.fix(e.x + i, e.y + 1, EYE);
        }
        if (e.w === 2) L.fix(e.x, e.y, '#fdfdff');
    }
    // sobrancelha: sobe, desce ou cai para o lado do nariz conforme a expressão
    const by = e.y - 2 - (rig.brow === 'up' ? 1 : 0);
    for (let i = 0; i < e.w; i++) {
      const isInner = innerRight ? i === e.w - 1 : i === 0;
      let dy = 0;
      if (rig.brow === 'down' && isInner && e.w > 1) dy = 1;
      if (rig.brow === 'sad' && !isInner && e.w > 1) dy = 1;
      L.fix(e.x + i, by + dy, browC);
    }
    if (e.w === 2 && (rig.brow === 'up' || rig.brow === 'down' || rig.brow === 'sad')) L.fix(innerRight ? e.x + 2 : e.x - 1, by + (rig.brow === 'up' ? 0 : rig.brow === 'down' ? 1 : -1), browC);
  }
  // bochechas
  const blush = mix(sk, '#ff6b80', 0.4);
  for (const l of [0.66, -0.66]) {
    const p = facePt(c, l, -0.5);
    if (p.d < 0.3) continue;
    const w = p.d > 0.62 ? 2 : 1;
    const x0 = AX + rnd(p.x - AX - w / 2);
    for (let i = 0; i < w; i++) L.fix(x0 + i, Math.round(p.y - 0.5), blush);
  }
  // boca
  const m = facePt(c, 0, -0.62);
  if (m.d > 0.3) {
    const wide = m.d > 0.72;
    const w = wide ? 2 : 1;
    const x0 = AX + rnd(m.x - AX - w / 2);
    const y = Math.round(m.y - 0.5);
    const mc = mix(sk, '#8a2f3c', 0.75);
    const px = (x: number, yy: number, col: string) => L.fix(x, yy, col);
    switch (rig.mouth) {
      case 'open':
        for (let i = 0; i < w; i++) {
          px(x0 + i, y, MOUTH_IN);
          px(x0 + i, y + 1, i === 0 && wide ? '#d05a6a' : MOUTH_IN);
        }
        if (wide) px(x0 - 1, y, mc), px(x0 + 2, y, mc);
        break;
      case 'small':
        for (let i = 0; i < w; i++) px(x0 + i, y, MOUTH_IN);
        break;
      case 'frown':
        for (let i = 0; i < w; i++) px(x0 + i, y, mc);
        if (wide) px(x0 - 1, y + 1, mc), px(x0 + 2, y + 1, mc);
        break;
      case 'flat':
        for (let i = 0; i < w; i++) px(x0 + i, y, mc);
        break;
      default:
        for (let i = 0; i < w; i++) px(x0 + i, y, mc);
        if (wide) px(x0 - 1, y - 1, mc), px(x0 + 2, y - 1, mc);
    }
  }
  put(c, L);
}

/** Barba e bigode: regiões da superfície do rosto; stubble só escurece a pele. */
function drawBeard(c: Ctx, L: Layer): void {
  const { look } = c;
  if (look.beard === 'none') return;
  const hc = look.hairColor;
  const cy = headCy(c);
  for (let y = Math.floor(cy - HEAD_RZ); y <= Math.ceil(cy + HEAD_RZ); y++) {
    for (let x = AX - HEAD_RX - 1; x <= AX + HEAD_RX; x++) {
      const s = surf(c, x, y);
      if (!s.inside) continue;
      switch (look.beard) {
        case 'stubble':
          if (s.v < -0.34 && s.f > -0.2) L.fix(x, y, (x + y) % 3 === 0 ? shade(mix(look.skin, hc, 0.5), 0.04) : mix(look.skin, hc, 0.34));
          break;
        case 'beard':
          if (s.v < -0.36 && s.f > -0.45 && !(s.v > -0.5 && Math.abs(s.l) < 0.3 && s.f > 0.5)) L.fill(x, y, hc);
          else if (s.v < -0.12 && Math.abs(s.l) > 0.82 && s.f > -0.2) L.fill(x, y, hc);
          break;
        case 'mustache':
          if (s.v < -0.44 && s.v > -0.56 && Math.abs(s.l) < 0.44 && s.f > 0.3) L.fill(x, y, hc);
          break;
        case 'goatee':
          if ((s.v < -0.7 && Math.abs(s.l) < 0.4 && s.f > 0.25) || (s.v < -0.46 && s.v > -0.56 && Math.abs(s.l) < 0.3 && s.f > 0.4)) L.fill(x, y, hc);
          break;
      }
    }
  }
}
