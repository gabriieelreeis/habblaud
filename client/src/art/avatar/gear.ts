// Acessórios: chapéus, óculos, extras (colar, brinco, fone, mochila, cachecol), crachá e fantasias de época. Cada função
// devolve camadas com o estágio em que entram na ordem de desenho (ver render.ts).
import { mix, shade } from '../core/color';
import { AX, Layer, rnd } from './paint';
import { HEAD_RZ, eyeBoxes, surf } from './head';
import { cap, type HairLayer } from './hair';
import { proj, type Ctx } from './rig';

const FRAME = '#2e2b3c';

/** Amostra um conjunto 3D com passo fino e pinta cada ponto projetado. */
function sample(c: Ctx, L: Layer, color: string | ((p: [number, number, number]) => string), pts: Iterable<[number, number, number]>, fix = false, minD = -Infinity): void {
  for (const pt of pts) {
    const p = proj(c.v, pt[0], pt[1], pt[2]);
    if (p.d < minD) continue;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const col = typeof color === 'string' ? color : color(pt);
    if (fix) L.fix(x, y, col);
    else L.fill(x, y, col);
  }
}

function* ring(r0: number, r1: number, z: (r: number) => number, from = 0, to = Math.PI * 2): Generator<[number, number, number]> {
  for (let r = r0; r <= r1; r += 0.3) {
    for (let a = from; a < to; a += 0.9 / r / 2) yield [r * Math.cos(a), r * Math.sin(a), z(r)];
  }
}

function dome(c: Ctx, o: { front: number; back: number; ring: number; side?: number }, color: string): Layer {
  const L = new Layer();
  L.vw = 0.5;
  L.hiT = 0.34;
  L.shT = -0.3;
  L.inner = true;
  return cap(c, { ...o, color }, L);
}

/** Aba em anel (balde, palha, bruxa): metade de trás fica atrás da cabeça, a da frente por cima. */
function brimLayers(c: Ctx, r0: number, r1: number, z: (r: number) => number, color: (p: [number, number, number]) => string): HairLayer[] {
  const back = new Layer();
  const front = new Layer();
  back.inner = true;
  front.inner = true;
  for (const [l, f, zz] of ring(r0, r1, z)) {
    const p = proj(c.v, l, f, zz);
    (p.d > 0 ? front : back).fill(Math.floor(p.x), Math.floor(p.y), color([l, f, zz]));
  }
  return [{ L: back, stage: 'behind' }, { L: front, stage: 'after' }];
}

export function hatLayers(c: Ctx): HairLayer[] {
  const { look, v, rig } = c;
  const col = look.hatColor;
  const hz = rig.headZ;
  const out: HairLayer[] = [];
  switch (look.hat) {
    case 'cap':
    case 'cap_back': {
      const back = look.hat === 'cap_back';
      out.push({ L: dome(c, { front: 0.2, back: -0.3, ring: 0.9 }, col), stage: 'after' });
      const L = new Layer();
      L.inner = true;
      const pts: [number, number, number][] = [];
      const sgn = back ? -1 : 1;
      for (let l = -6.2; l <= 6.2; l += 0.25) {
        const ext = (back ? 3.0 : 3.6) * Math.sqrt(Math.max(0, 1 - (l / 6.6) ** 2));
        for (let f = 6.1; f <= 6.1 + ext; f += 0.25) pts.push([l, sgn * f, hz + 4.6 - 0.25 * (f - 6)]);
      }
      sample(c, L, shade(col, -0.1), pts);
      const visible = back ? v.c < 0.3 : v.c > -0.3;
      out.push({ L, stage: visible ? 'after' : 'behind' });
      const top = proj(v, 0, 0, hz + HEAD_RZ + 0.9);
      const B = new Layer();
      B.fix(Math.floor(top.x), Math.floor(top.y), shade(col, 0.16));
      out.push({ L: B, stage: 'after' });
      break;
    }
    case 'beanie': {
      const L = new Layer();
      L.vw = 0.5;
      L.hiT = 0.34;
      L.shT = -0.3;
      L.inner = true;
      const cuff = shade(col, -0.13);
      const cells: [number, number][] = [];
      cap(c, { front: 0.26, back: -0.2, ring: 0.9, side: -0.05, color: col }, L, (x, y, lim, vv) => {
        if (vv < lim + 0.26) cells.push([x, y]);
      });
      for (const [x, y] of cells) L.fill(x, y, cuff);
      out.push({ L, stage: 'after' });
      const p = proj(v, 0, 0, hz + HEAD_RZ + 1.8);
      const P = new Layer();
      P.blob(p.x, p.y, 2.2, 2.2, mix(col, '#ffffff', 0.5), 2);
      out.push({ L: P, stage: 'after' });
      break;
    }
    case 'bucket': {
      out.push({ L: dome(c, { front: 0.22, back: -0.25, ring: 0.9 }, col), stage: 'after' });
      const brimC = shade(col, -0.07);
      out.push(...brimLayers(c, 7.3, 10.4, (r) => hz + 4.4 - 0.38 * (r - 7.3), () => brimC));
      break;
    }
    case 'straw': {
      const straw = col;
      const weave = (p: [number, number, number]): string => ((Math.round(p[0] * 1.6) + Math.round(p[1] * 1.6)) % 2 ? shade(straw, -0.09) : straw);
      const base = hz + 4.6;
      const backB = brimLayers(c, 5.4, 11.6, (r) => base - 0.28 * (r - 5.4), weave);
      const crown = new Layer();
      crown.inner = true;
      crown.vw = 0.35;
      const side: [number, number, number][] = [];
      for (let z = base; z <= base + 4.4; z += 0.4) for (let a = 0; a < Math.PI * 2; a += 0.12) side.push([6.1 * Math.cos(a), 6.1 * Math.sin(a), z]);
      sample(c, crown, weave, side);
      sample(c, crown, shade(straw, 0.08), ring(0, 6.1, () => base + 4.4));
      const bs: [number, number, number][] = [];
      for (let z = base + 0.2; z <= base + 1.8; z += 0.4) for (let a = 0; a < Math.PI * 2; a += 0.1) bs.push([6.2 * Math.cos(a), 6.2 * Math.sin(a), z]);
      sample(c, crown, look.accent, bs, true);
      out.push(backB[0], { L: crown, stage: 'after' }, backB[1]);
      break;
    }
    case 'top': {
      const base = hz + 5.4;
      const backB = new Layer();
      const frontB = new Layer();
      const crown = new Layer();
      for (const L of [backB, frontB, crown]) {
        L.inner = true;
        L.vw = 0.3;
      }
      const brimC = shade(col, -0.05);
      for (const [l, f, z] of ring(5.2, 9.6, () => base)) {
        const p = proj(v, l, f, z);
        (p.d > 0 ? frontB : backB).fill(Math.floor(p.x), Math.floor(p.y), brimC);
      }
      const R = 5.8;
      const H = 9.6;
      const side: [number, number, number][] = [];
      for (let z = base; z <= base + H; z += 0.4) for (let a = 0; a < Math.PI * 2; a += 0.12) side.push([R * Math.cos(a), R * Math.sin(a), z]);
      sample(c, crown, col, side);
      sample(c, crown, shade(col, 0.1), ring(0, R, () => base + H));
      // faixa
      const bs: [number, number, number][] = [];
      for (let z = base + 0.3; z <= base + 2.6; z += 0.4) for (let a = 0; a < Math.PI * 2; a += 0.12) bs.push([(R + 0.05) * Math.cos(a), (R + 0.05) * Math.sin(a), z]);
      sample(c, crown, look.accent, bs, true);
      out.push({ L: backB, stage: 'behind' }, { L: crown, stage: 'after' }, { L: frontB, stage: 'after' });
      break;
    }
    case 'bow': {
      // laço de cabelo no alto, do lado esquerdo do personagem
      const L = new Layer();
      L.inner = true;
      const k = proj(v, 4.8, 1.6, hz + HEAD_RZ - 0.6);
      const w = proj(v, 4.8 + 3.2, 1.6, hz + HEAD_RZ - 0.2);
      const w2 = proj(v, 4.8 - 3.2, 1.6, hz + HEAD_RZ - 0.2);
      L.blob(w.x, w.y - 0.6, 2.4, 1.8, col, 2);
      L.blob(w2.x, w2.y - 0.6, 2.4, 1.8, col, 2);
      L.fix(Math.floor(k.x), Math.floor(k.y) - 1, shade(col, -0.25));
      L.fix(Math.floor(k.x), Math.floor(k.y), shade(col, -0.25));
      out.push({ L, stage: 'after' });
      break;
    }
    default:
      break;
  }
  return out;
}

/** Fantasias de época, por cima do visual. */
export function costumeLayers(c: Ctx): HairLayer[] {
  const { v, rig } = c;
  const hz = rig.headZ;
  const out: HairLayer[] = [];
  switch (c.costume) {
    case 'santa': {
      const col = '#cf2f3a';
      const L = new Layer();
      L.vw = 0.5;
      L.hiT = 0.34;
      L.shT = -0.3;
      L.inner = true;
      const fur = '#f4f1ec';
      const cells: [number, number][] = [];
      cap(c, { front: 0.3, back: -0.12, ring: 1.0, side: 0, color: col }, L, (x, y, lim, vv) => {
        if (vv < lim + 0.26) cells.push([x, y]);
      });
      for (const [x, y] of cells) L.fill(x, y, fur);
      out.push({ L, stage: 'after' });
      // ponta caída para trás, com pompom
      const p0 = proj(v, 0, -1, hz + HEAD_RZ + 0.6);
      const p1 = proj(v, 0, -3.6, hz + HEAD_RZ + 3.8);
      const p2 = proj(v, 0, -8, hz + HEAD_RZ + 1.4);
      const T = new Layer();
      T.inner = true;
      T.seg(p0.x, p0.y, p1.x, p1.y, 5, () => col);
      T.seg(p1.x, p1.y, p2.x, p2.y, 3, () => col);
      T.blob(p2.x, p2.y, 2.3, 2.3, fur, 2);
      out.push({ L: T, stage: p2.d < -0.5 ? 'behind' : 'after' });
      break;
    }
    case 'witch': {
      const col = '#2c2540';
      const base = hz + 5;
      const backB = new Layer();
      const frontB = new Layer();
      const crown = new Layer();
      for (const L of [backB, frontB, crown]) {
        L.inner = true;
        L.vw = 0.3;
      }
      for (const [l, f, z] of ring(5, 11.2, (r) => base - 0.18 * (r - 5))) {
        const p = proj(v, l, f, z);
        (p.d > 0 ? frontB : backB).fill(Math.floor(p.x), Math.floor(p.y), shade(col, -0.05));
      }
      // cone: raio diminui com a altura e a ponta cai para trás
      const H = 14;
      const pts: [number, number, number][] = [];
      for (let t = 0; t <= H; t += 0.35) {
        const r = Math.max(0.5, 5.6 * (1 - t / H) ** 0.85);
        const bend = -((t / H) ** 2) * 5;
        for (let a = 0; a < Math.PI * 2; a += 0.1 / Math.max(0.6, r / 4)) pts.push([r * Math.cos(a), bend + r * Math.sin(a), base + t]);
      }
      sample(c, crown, col, pts);
      const bs: [number, number, number][] = [];
      for (let t = 0.2; t <= 2.2; t += 0.4) for (let a = 0; a < Math.PI * 2; a += 0.1) bs.push([5.55 * Math.cos(a), 5.55 * Math.sin(a), base + t]);
      sample(c, crown, '#8a4fb0', bs, true);
      const fb = proj(v, 0, 5.6, base + 1.2);
      if (fb.d > 0) crown.fix(Math.floor(fb.x), Math.floor(fb.y), '#f1c64a');
      out.push({ L: backB, stage: 'behind' }, { L: crown, stage: 'after' }, { L: frontB, stage: 'after' });
      break;
    }
    case 'pumpkin': {
      const base = hz + 5.4;
      const L = new Layer();
      L.inner = true;
      L.vw = 0.4;
      const orange = '#e8832a';
      const R = 6.6;
      const H = 5.4;
      const pts: [number, number, number][] = [];
      for (let l = -R; l <= R; l += 0.25) {
        for (let f = -R; f <= R; f += 0.25) {
          const q = (l / R) ** 2 + (f / R) ** 2;
          if (q > 1) continue;
          const zt = base + H * Math.sqrt(1 - q);
          for (let z = base - 0.6; z <= zt; z += 0.35) pts.push([l, f, z]);
        }
      }
      // gomos: faixas escuras radiais
      sample(c, L, (p) => (Math.abs(Math.sin(Math.atan2(p[1], p[0]) * 3)) < 0.22 ? shade(orange, -0.2) : orange), pts);
      out.push({ L, stage: 'after' });
      const S = new Layer();
      S.inner = true;
      const s0 = proj(v, 0, 0, base + H - 0.6);
      const s1 = proj(v, 0.6, 0, base + H + 2.4);
      S.seg(s0.x, s0.y, s1.x, s1.y, 2, () => '#4f8f3a');
      out.push({ L: S, stage: 'after' });
      break;
    }
    case 'vampire': {
      const outer = '#2a2234';
      const lining = '#b02a3e';
      const front = v.c > 0.15;
      const cape = new Layer();
      cape.vw = 0.2;
      const z1 = rig.torsoTop - 0.6;
      const z0 = rig.torsoBot - 9;
      const f = v.c >= -0.2 ? -3.6 : -4.4;
      for (let z = z1; z >= z0; z -= 0.3) {
        const k = (z1 - z) / (z1 - z0);
        const w = 6.2 + 4.2 * k;
        const a = proj(v, -w, f, z);
        const b = proj(v, w, f, z);
        const y = Math.round(a.y);
        cape.row(y, Math.round(Math.min(a.x, b.x)), Math.round(Math.max(a.x, b.x)), front ? (k > 0.9 ? shade(lining, -0.15) : lining) : k > 0.92 ? shade(outer, 0.1) : outer);
      }
      out.push({ L: cape, stage: v.c >= -0.2 ? 'behind' : 'mid', body: true });
      // gola alta: dois painéis atrás do pescoço, forrados de vermelho
      for (const sg of [1, -1]) {
        const L = new Layer();
        L.inner = true;
        const a = proj(v, sg * 3.2, -1.2, rig.torsoTop - 0.4);
        const b = proj(v, sg * 6.4, -1.6, rig.torsoTop + 7.2);
        L.seg(a.x, a.y, b.x, b.y, 3, (t) => (t > 0.15 && front ? lining : outer));
        L.seg(a.x - sg, a.y, b.x - sg, b.y, 1, () => outer);
        out.push({ L, stage: proj(v, 0, -2, 0).d < 0 ? 'behind' : 'after', body: true });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

export function glassesLayer(c: Ctx): Layer | null {
  const { look, v } = c;
  if (look.glasses === 'none' || v.c < -0.1) return null;
  const eyes = eyeBoxes(c);
  if (!eyes.length) return null;
  const L = new Layer();
  // armação só sobre a cabeça (a lente do lado de longe não pode sair da silhueta)
  const px = (x: number, y: number, col: string) => {
    if (surf(c, x, y).inside) L.fix(x, y, col);
  };
  const sun = look.glasses === 'shades';
  const round = look.glasses === 'round';
  const lens = sun ? '#1a1826' : undefined;
  const frame = round ? '#c9a24a' : FRAME;
  const lensBoxes: { x0: number; x1: number; y0: number }[] = [];
  for (const e of eyes) lensBoxes.push({ x0: e.x - 1, x1: e.x + e.w, y0: e.y - 1 });
  for (const b of lensBoxes) {
    for (let y = b.y0; y < b.y0 + 4; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const edge = y === b.y0 || y === b.y0 + 3 || x === b.x0 || x === b.x1;
        // lente redonda: sem os cantos
        if (round && (y === b.y0 || y === b.y0 + 3) && (x === b.x0 || x === b.x1)) continue;
        if (edge) px(x, y, frame);
        else if (lens) px(x, y, lens);
        else if (round) px(x, y, '#dff2fb');
      }
    }
    if (sun) px(b.x0 + 1, b.y0 + 1, '#58587a');
  }
  // ponte entre as lentes e haste até a orelha
  if (lensBoxes.length === 2) {
    const [a, b] = lensBoxes[0].x0 < lensBoxes[1].x0 ? [lensBoxes[0], lensBoxes[1]] : [lensBoxes[1], lensBoxes[0]];
    for (let x = a.x1 + 1; x < b.x0; x++) px(x, a.y0 + 1, frame);
    px(a.x0 - 1, a.y0 + 1, frame);
    px(b.x1 + 1, a.y0 + 1, frame);
  } else {
    // perfil: haste até o meio da cabeça
    const b = lensBoxes[0];
    const dir = v.s > 0 ? 1 : -1;
    const from = dir > 0 ? b.x1 + 1 : b.x0 - 1;
    for (let i = 0; i < 5; i++) px(from + dir * i, b.y0 + 1, frame);
  }
  return L;
}

export function extraLayers(c: Ctx): HairLayer[] {
  const { look, v, rig } = c;
  const col = look.extraColor;
  const hz = rig.headZ;
  const out: HairLayer[] = [];
  switch (look.extra) {
    case 'necklace': {
      if (v.c < 0.2) break;
      const L = new Layer();
      const chain = shade(col, -0.08);
      for (let t = -1; t <= 1.001; t += 0.1) {
        const p = proj(v, 3.8 * t, 3.3 * Math.sqrt(1 - t * t * 0.9), rig.torsoTop - 0.4 - 2 * (1 - t * t));
        if (p.d <= 0) continue;
        L.fix(Math.floor(p.x), Math.floor(p.y), chain);
      }
      const pd = proj(v, 0, 3.4, rig.torsoTop - 2.9);
      L.fix(Math.floor(pd.x), Math.floor(pd.y), mix(col, '#ffffff', 0.35));
      L.fix(Math.floor(pd.x), Math.floor(pd.y) + 1, col);
      out.push({ L, stage: 'mid', body: true });
      break;
    }
    case 'earring': {
      const L = new Layer();
      for (const sgn of [1, -1]) {
        const p = proj(v, sgn * 7.7, 0, hz - 2.8);
        if (p.d < -0.3) continue;
        const x = AX + rnd(p.x - AX - 0.5);
        const y = Math.round(p.y);
        L.fix(x, y, mix(col, '#ffffff', 0.3));
        L.fix(x, y + 1, col);
      }
      out.push({ L, stage: 'after' });
      break;
    }
    case 'headphones': {
      const bandC = shade(col, -0.15);
      const nearB = new Layer();
      const farB = new Layer();
      for (let a = -1.45; a <= 1.45; a += 0.03) {
        const p = proj(v, 8.9 * Math.sin(a), 0.2, hz + 0.3 + 9.1 * Math.cos(a));
        const L = p.d >= -0.2 ? nearB : farB;
        L.fix(Math.floor(p.x), Math.floor(p.y), bandC);
        L.fix(Math.floor(p.x), Math.floor(p.y) + 1, bandC);
      }
      out.push({ L: farB, stage: 'behind' }, { L: nearB, stage: 'after' });
      for (const sgn of [1, -1]) {
        const L = new Layer();
        L.vw = 0.4;
        const pts: [number, number, number][] = [];
        for (let lat = 8.2; lat <= 9.8; lat += 0.4) for (let f = -2.8; f <= 2.8; f += 0.3) for (let z = -2.8; z <= 2.8; z += 0.3) if (f * f + z * z <= 7.6) pts.push([sgn * lat, f, hz - 1.4 + z]);
        sample(c, L, col, pts);
        const d = proj(v, sgn * 8.6, 0, hz).d;
        out.push({ L, stage: d < -0.2 ? 'behind' : 'after' });
      }
      break;
    }
    case 'backpack': {
      const back = proj(v, 0, -5.8, 0).d < -0.3;
      const L = new Layer();
      L.vw = 0.3;
      const z0 = rig.torsoBot + 1.2;
      const z1 = rig.torsoTop - 1.8;
      const pts: [number, number, number][] = [];
      for (let l = -4.6; l <= 4.6; l += 0.3) {
        for (let z = z0; z <= z1; z += 0.3) {
          for (const f of [-7.6, -3.8]) pts.push([l, f, z]);
        }
        for (let f = -7.6; f <= -3.8; f += 0.3) pts.push([l, f, z1]);
      }
      for (let f = -7.6; f <= -3.8; f += 0.3) for (let z = z0; z <= z1; z += 0.3) for (const l of [-4.6, 4.6]) pts.push([l, f, z]);
      sample(c, L, col, pts);
      out.push({ L, stage: back ? 'behind' : 'mid', body: true });
      if (v.c > 0.3) {
        // alças sobre o peito
        const S = new Layer();
        const sc = shade(col, -0.22);
        for (const sgn of [1, -1]) {
          for (let z = rig.torsoTop - 0.6; z > rig.torsoTop - 9; z -= 0.4) {
            const p = proj(v, sgn * 3.2, 3.5, z);
            S.fix(Math.floor(p.x), Math.floor(p.y), sc);
          }
        }
        out.push({ L: S, stage: 'mid', body: true });
      }
      break;
    }
    case 'scarf': {
      const L = new Layer();
      L.vw = 0.3;
      const rib = shade(col, -0.14);
      const pts: [number, number, number][] = [];
      for (let z = rig.torsoTop - 1.8; z <= rig.torsoTop + 1.2; z += 0.35) for (let a = 0; a < Math.PI * 2; a += 0.08) pts.push([4.6 * Math.cos(a), 4.0 * Math.sin(a), z]);
      sample(c, L, (p) => (Math.round(p[2] * 1.3) % 2 ? col : rib), pts);
      // ponta caída na frente
      const tail: [number, number, number][] = [];
      for (let z = rig.torsoTop - 8; z <= rig.torsoTop - 1; z += 0.35) for (let l = 1.6; l <= 4; l += 0.3) tail.push([l, 4.4, z]);
      sample(c, L, (p) => (Math.round(p[2] * 1.3) % 2 ? col : rib), tail);
      out.push({ L, stage: 'mid', body: true });
      break;
    }
    default:
      break;
  }
  return out;
}

/** Crachá: cordão em volta do pescoço (visto de qualquer lado) e o cartão no peito. */
export function lanyardLayers(c: Ctx): HairLayer[] {
  const { look, v, rig } = c;
  if (!look.lanyard) return [];
  const cord = look.lanyard;
  const top = rig.torsoTop;
  const L = new Layer();
  // anel em volta do pescoço: duas linhas, para aparecer também de costas
  const ringPts: [number, number, number][] = [];
  for (const dz of [-0.9]) for (let a = 0; a < Math.PI * 2; a += 0.07) ringPts.push([4.2 * Math.cos(a), 3.6 * Math.sin(a), top + dz]);
  sample(c, L, cord, ringPts, true);
  // cordão descendo dos ombros ao cartão
  const v1: [number, number, number][] = [];
  for (let t = 0; t <= 1.001; t += 0.04) {
    for (const sg of [1, -1]) v1.push([sg * 3.8 * (1 - t), 3.2 + 0.5 * t, top - 1.2 - 6 * t]);
  }
  sample(c, L, cord, v1, true, -0.5);
  // cartão: fundo claro, faixa na cor do cordão e linha de texto
  const card: [number, number, number][] = [];
  for (let l = -1.7; l <= 1.7; l += 0.3) for (let z = top - 11; z <= top - 7.2; z += 0.3) card.push([l, 3.8, z]);
  sample(c, L, (p) => (p[2] > top - 8.2 ? cord : p[2] < top - 9.8 && Math.abs(p[0]) < 1 ? '#8a8fa3' : '#f4f2ea'), card, true);
  return [{ L, stage: 'mid', body: true }];
}
