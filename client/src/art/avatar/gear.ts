// Acessórios: chapéus, óculos e extras (colar, brinco, fone, mochila). Cada função devolve camadas com o estágio em que
// entram na ordem de desenho (ver render.ts).
import { mix, shade } from '../core/color';
import { AX, Layer, rnd } from './paint';
import { HEAD_RZ, eyeBoxes, surf } from './head';
import { cap, type HairLayer } from './hair';
import { proj, type Ctx } from './rig';

const FRAME = '#2e2b3c';

/** Amostra um conjunto 3D com passo fino e pinta cada ponto projetado. */
function sample(c: Ctx, L: Layer, color: string, pts: Iterable<[number, number, number]>, fix = false): void {
  for (const [l, f, z] of pts) {
    const p = proj(c.v, l, f, z);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (fix) L.fix(x, y, color);
    else L.fill(x, y, color);
  }
}

function* ring(r0: number, r1: number, z: (r: number) => number, from = 0, to = Math.PI * 2): Generator<[number, number, number]> {
  for (let r = r0; r <= r1; r += 0.3) {
    for (let a = from; a < to; a += 0.9 / r / 2) yield [r * Math.cos(a), r * Math.sin(a), z(r)];
  }
}

export function hatLayers(c: Ctx): HairLayer[] {
  const { look, v, rig } = c;
  const col = look.hatColor;
  const hz = rig.headZ;
  const out: HairLayer[] = [];
  const dome = (o: { front: number; back: number; ring: number; side?: number }, color = col): Layer => {
    const L = new Layer();
    L.vw = 0.5;
    L.hiT = 0.34;
    L.shT = -0.3;
    L.inner = true;
    return cap(c, { ...o, color }, L);
  };
  switch (look.hat) {
    case 'cap': {
      out.push({ L: dome({ front: 0.18, back: -0.3, ring: 1.4 }), stage: 'after' });
      const L = new Layer();
      L.inner = true;
      const pts: [number, number, number][] = [];
      for (let l = -6.4; l <= 6.4; l += 0.25) {
        const ext = 3.6 * Math.sqrt(Math.max(0, 1 - (l / 6.8) ** 2));
        for (let f = 6.3; f <= 6.3 + ext; f += 0.25) pts.push([l, f, hz + 4.6 - 0.25 * (f - 6.2)]);
      }
      sample(c, L, shade(col, -0.1), pts);
      if (v.c > -0.3) out.push({ L, stage: 'after' });
      else out.push({ L, stage: 'behind' });
      const top = proj(v, 0, 0, hz + HEAD_RZ + 1.6);
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
      cap(c, { front: 0.26, back: -0.2, ring: 1.35, side: -0.05, color: col }, L, (x, y, lim, vv) => {
        if (vv < lim + 0.26) cells.push([x, y]);
      });
      for (const [x, y] of cells) L.fill(x, y, cuff);
      out.push({ L, stage: 'after' });
      const p = proj(v, 0, 0, hz + HEAD_RZ + 2.6);
      const P = new Layer();
      P.blob(p.x, p.y, 2.4, 2.4, mix(col, '#ffffff', 0.5), 2);
      out.push({ L: P, stage: 'after' });
      break;
    }
    case 'bucket': {
      out.push({ L: dome({ front: 0.2, back: -0.25, ring: 1.3 }), stage: 'after' });
      const back = new Layer();
      const front = new Layer();
      back.inner = true;
      front.inner = true;
      const brimC = shade(col, -0.07);
      for (const [l, f, z] of ring(7.6, 10.8, (r) => hz + 4.6 - 0.38 * (r - 7.6))) {
        const p = proj(v, l, f, z);
        (p.d > 0 ? front : back).fill(Math.floor(p.x), Math.floor(p.y), brimC);
      }
      out.push({ L: back, stage: 'behind' }, { L: front, stage: 'after' });
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
      for (const [l, f, z] of ring(5.2, 10.6, () => base)) {
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
      const band = '#b8334a';
      const bs: [number, number, number][] = [];
      for (let z = base + 0.3; z <= base + 2.6; z += 0.4) for (let a = 0; a < Math.PI * 2; a += 0.12) bs.push([(R + 0.05) * Math.cos(a), (R + 0.05) * Math.sin(a), z]);
      sample(c, crown, band, bs, true);
      out.push({ L: backB, stage: 'behind' }, { L: crown, stage: 'after' }, { L: frontB, stage: 'after' });
      break;
    }
    case 'santa': {
      const L = new Layer();
      L.vw = 0.5;
      L.hiT = 0.34;
      L.shT = -0.3;
      L.inner = true;
      const fur = '#f4f1ec';
      const cells: [number, number][] = [];
      cap(c, { front: 0.3, back: -0.12, ring: 1.6, side: 0, color: col }, L, (x, y, lim, vv) => {
        if (vv < lim + 0.24) cells.push([x, y]);
      });
      for (const [x, y] of cells) L.fill(x, y, fur);
      out.push({ L, stage: 'after' });
      // ponta caída para trás, com pompom
      const p0 = proj(v, 0, -1, hz + HEAD_RZ + 1.2);
      const p1 = proj(v, 0, -3.6, hz + HEAD_RZ + 4.4);
      const p2 = proj(v, 0, -8, hz + HEAD_RZ + 1.8);
      const T = new Layer();
      T.inner = true;
      T.seg(p0.x, p0.y, p1.x, p1.y, 5, () => col);
      T.seg(p1.x, p1.y, p2.x, p2.y, 3, () => col);
      T.blob(p2.x, p2.y, 2.2, 2.2, fur, 2);
      out.push({ L: T, stage: p2.d < -0.5 ? 'behind' : 'after' });
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
  const lens = sun ? '#1a1826' : undefined;
  const lensBoxes: { x0: number; x1: number; y0: number }[] = [];
  for (const e of eyes) {
    const x0 = e.x - 1;
    const x1 = e.x + e.w;
    lensBoxes.push({ x0, x1, y0: e.y - 1 });
  }
  for (const b of lensBoxes) {
    for (let y = b.y0; y < b.y0 + 4; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const edge = y === b.y0 || y === b.y0 + 3 || x === b.x0 || x === b.x1;
        if (edge) px(x, y, FRAME);
        else if (lens) px(x, y, lens);
      }
    }
    if (sun) px(b.x0 + 1, b.y0 + 1, '#58587a');
  }
  // ponte entre as lentes e haste até a orelha
  if (lensBoxes.length === 2) {
    const [a, b] = lensBoxes[0].x0 < lensBoxes[1].x0 ? [lensBoxes[0], lensBoxes[1]] : [lensBoxes[1], lensBoxes[0]];
    for (let x = a.x1 + 1; x < b.x0; x++) px(x, a.y0 + 1, FRAME);
    px(a.x0 - 1, a.y0 + 1, FRAME);
    px(b.x1 + 1, a.y0 + 1, FRAME);
  } else {
    // perfil: haste até o meio da cabeça
    const b = lensBoxes[0];
    const dir = v.s > 0 ? 1 : -1;
    const from = dir > 0 ? b.x1 + 1 : b.x0 - 1;
    for (let i = 0; i < 5; i++) px(from + dir * i, b.y0 + 1, FRAME);
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
      out.push({ L, stage: 'mid' });
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
      out.push({ L, stage: back ? 'behind' : 'mid' });
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
        out.push({ L: S, stage: 'mid' });
      }
      break;
    }
    default:
      break;
  }
  return out;
}
