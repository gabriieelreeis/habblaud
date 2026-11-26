// Cabelos: uma "calota" sobre a cabeça (definida pela linha do cabelo em função de lateral/frente/altura, então vale
// para qualquer direção) mais volumes próprios de cada estilo (coque, rabo, cortina, crista, afro...).
import { mix, shade } from '../core/color';
import { AX, Layer, rnd } from './paint';
import { HEAD_RX, HEAD_RZ, headCy, surf } from './head';
import { proj, type Ctx } from './rig';

/** Onde a camada entra na ordem de desenho: antes do corpo, depois do tronco, ou por cima da cabeça. */
export type Stage = 'behind' | 'mid' | 'after';
export interface HairLayer {
  L: Layer;
  stage: Stage;
  /** Peça do corpo (acompanha a inclinação do tronco) em vez da cabeça. */
  body?: boolean;
}

export interface Cap {
  front: number;
  back: number;
  ring: number;
  /** Altura mínima da linha do cabelo nas laterais (cobre orelha/bochecha). */
  side?: number;
  /** Inclinação da linha do cabelo para um lado (repartido). */
  skew?: number;
  color: string;
}

export function cap(c: Ctx, o: Cap, into = new Layer(), mark?: (x: number, y: number, lim: number, v: number) => void): Layer {
  const rx = HEAD_RX + o.ring;
  const rz = HEAD_RZ + o.ring;
  const cy = headCy(c);
  for (let y = Math.floor(cy - rz) - 1; y <= Math.ceil(cy + rz); y++) {
    for (let x = AX - Math.ceil(rx) - 1; x <= AX + Math.ceil(rx); x++) {
      const s = surf(c, x, y, rx, rz);
      if (!s.inside) continue;
      const t = Math.min(1, Math.max(0, (0.45 - s.f) / 0.9));
      let lim = o.front + (o.back - o.front) * t;
      if (o.side !== undefined && Math.abs(s.l) > 0.8 && s.f < 0.55) lim = Math.min(lim, o.side);
      if (o.skew) lim += o.skew * s.l * Math.max(0, s.f);
      if (s.v > lim) {
        into.fill(x, y, o.color);
        mark?.(x, y, lim, s.v);
      }
    }
  }
  return into;
}

/** Pixel da cabeça que é rosto (fica sem cabelo em estilos volumosos). */
function isFace(c: Ctx, x: number, y: number): boolean {
  const s = surf(c, x, y);
  return s.inside && s.f > 0.25 && s.v < 0.5;
}

/** Volume redondo (afro, cachos) que deixa o rosto descoberto. */
function puff(c: Ctx, L: Layer, cx: number, cy: number, rx: number, ry: number, color: string, clipY: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = Math.abs(x + 0.5 - cx) / rx;
      const v = Math.abs(y + 0.5 - cy) / ry;
      if (u ** 2.2 + v ** 2.2 > 1 || y >= clipY || isFace(c, x, y)) continue;
      L.fill(x, y, color);
    }
  }
}

function bump(c: Ctx, L: Layer, cx: number, cy: number, r: number, color: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r || isFace(c, x, y)) continue;
      L.fill(x, y, color);
    }
  }
}

/** Mecha pendurada: segmento de a até b com largura w. */
function lock(c: Ctx, L: Layer, a: [number, number, number], b: [number, number, number], w: number, color: string): void {
  const p = proj(c.v, ...a);
  const q = proj(c.v, ...b);
  L.seg(p.x, p.y, q.x, q.y, w, () => color);
}

/** Camadas de cabelo (a calota vem separada: `hairFront`). */
export function hairBack(c: Ctx): HairLayer[] {
  const { look, v, rig } = c;
  const col = look.hairColor;
  const hz = rig.headZ;
  const out: HairLayer[] = [];
  // cortina que cai atrás da cabeça: do alto da cabeça até `yBot` (linha de tela), mais larga nas laterais
  const curtain = (yBot: number, wave: number, inset: number): HairLayer => {
    const L = new Layer();
    L.vw = 0.2;
    const cx = AX + 5.5 * v.s;
    const half = 7 * Math.abs(v.c) + 3.4 * Math.abs(v.s) + 0.6;
    const yTop = Math.round(headCy(c) - 2);
    for (let y = yTop; y <= yBot; y++) {
      const taper = y > yBot - 2 ? inset : 0;
      const h = half - taper - (y === yBot ? 0.8 : 0) + (wave ? Math.sin(y * 1.1) * wave : 0);
      L.row(y, AX + rnd(cx - AX - h), AX + rnd(cx - AX + h) - 1, col);
    }
    return { L, stage: v.c >= -0.2 ? 'behind' : 'mid' };
  };
  switch (look.hair) {
    case 'bun': {
      const p = proj(v, 0, -3, hz + HEAD_RZ + 2.6);
      const L = new Layer();
      L.blob(p.x, p.y, 3.6, 3.3, col, 2);
      out.push({ L, stage: p.d < -0.5 ? 'behind' : 'after' });
      break;
    }
    case 'space_buns': {
      for (const sg of [1, -1]) {
        const p = proj(v, sg * 5.4, -1.2, hz + HEAD_RZ + 1.2);
        const L = new Layer();
        L.blob(p.x, p.y, 3.3, 3.1, col, 2);
        L.fix(Math.floor(p.x) - 1, Math.floor(p.y) - 1, shade(col, 0.16));
        out.push({ L, stage: p.d < -0.5 ? 'behind' : 'after' });
      }
      break;
    }
    case 'ponytail': {
      const tie = proj(v, 0, -6.6, hz + 2.6);
      const mid = proj(v, 0, -8.4, hz - 2.4);
      const end = proj(v, 0.5, -8.2, hz - 8.4);
      const L = new Layer();
      L.seg(tie.x, tie.y, mid.x, mid.y, 4, () => col);
      L.seg(mid.x, mid.y, end.x, end.y, 3, () => col);
      const top = proj(v, 0, -4.2, hz + HEAD_RZ + 1.2);
      L.blob(top.x, top.y, 2.8, 2, col, 2);
      L.fix(Math.floor(tie.x), Math.floor(tie.y), shade(col, 0.25));
      out.push({ L, stage: tie.d < -0.5 ? 'behind' : 'after' });
      break;
    }
    case 'pigtails': {
      for (const sg of [1, -1]) {
        const L = new Layer();
        const tie = proj(v, sg * 7.6, -0.8, hz + 3.2);
        const mid = proj(v, sg * 9.6, -1.2, hz - 2);
        const end = proj(v, sg * 9.8, -0.8, hz - 8.6);
        L.seg(tie.x, tie.y, mid.x, mid.y, 3, () => col);
        L.seg(mid.x, mid.y, end.x, end.y, 3, () => col);
        L.blob(end.x, end.y, 1.9, 1.4, col, 2);
        L.fix(Math.floor(tie.x), Math.floor(tie.y), shade(col, 0.3));
        L.fix(Math.floor(tie.x), Math.floor(tie.y) + 1, shade(col, 0.3));
        out.push({ L, stage: proj(v, sg * 9, 0, hz).d < -0.3 ? 'behind' : 'after' });
      }
      break;
    }
    case 'braids': {
      for (const sg of [1, -1]) {
        const L = new Layer();
        const a = proj(v, sg * 7.2, 0.2, hz - 1);
        const b = proj(v, sg * 6.6, 1.6, rig.torsoTop + 1);
        const e = proj(v, sg * 5.6, 2.6, rig.torsoTop - 7);
        L.seg(a.x, a.y, b.x, b.y, 3, () => col);
        L.seg(b.x, b.y, e.x, e.y, 3, () => col);
        // trama da trança: pontos alternados claros e escuros; amarra na ponta
        for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y)) L.fix(x, y, (x + y) % 2 ? shade(col, -0.16) : shade(col, 0.1));
        const ey = Math.round(e.y);
        for (let x = 0; x < 40; x++) if (L.has(x, ey - 1)) L.fix(x, ey - 1, look.accent);
        out.push({ L, stage: 'mid' });
      }
      break;
    }
    case 'dreads': {
      const spots: [number, number, number][] = [[8.2, 0.6, 10], [-8.2, 0.6, 10], [7.4, -3.4, 12], [-7.4, -3.4, 12], [4.2, -6.8, 13], [-4.2, -6.8, 13], [0, -7.8, 12]];
      for (const [l, f, len] of spots) {
        const L = new Layer();
        lock(c, L, [l, f, hz + 2], [l * 1.06, f * 1.04, hz + 2 - len], 2, col);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && (y + x) % 3 === 0) L.fix(x, y, shade(col, -0.14));
        out.push({ L, stage: proj(v, l, f, hz).d < -0.3 ? 'behind' : 'after' });
      }
      break;
    }
    case 'long':
    case 'long_bangs':
      out.push(curtain(Math.round(proj(v, 0, 0, rig.torsoTop - 3.5).y), 0, 1.2));
      break;
    case 'wavy':
      out.push(curtain(Math.round(proj(v, 0, 0, rig.torsoTop - 0.5).y), 0.9, 0.4));
      break;
    case 'bob':
      out.push(curtain(Math.round(headCy(c) + HEAD_RZ - 2.4), 0, 1.6));
      break;
    default:
      break;
  }
  return out;
}

/** Espeta uma mecha da cabeça para fora: base larga e ponta fina. */
function spike(c: Ctx, L: Layer, l: number, f: number, h: number): void {
  const hz = c.rig.headZ;
  const zb = hz + HEAD_RZ * Math.sqrt(Math.max(0.05, 1 - (l / 9) ** 2 - (f / 9) ** 2)) - 1.2;
  const n = Math.hypot(l * 0.35, f * 0.35, 1);
  const b = proj(c.v, l, f, zb);
  const m = proj(c.v, l + (l * 0.35 * h * 0.5) / n, f + (f * 0.35 * h * 0.5) / n, zb + (h * 0.5) / n);
  const t = proj(c.v, l + (l * 0.35 * h) / n, f + (f * 0.35 * h) / n, zb + h / n);
  L.seg(b.x, b.y, m.x, m.y, 3, () => c.look.hairColor);
  L.seg(m.x, m.y, t.x, t.y, 1, () => c.look.hairColor);
}

/** Calota e adereços de cabelo que vão por cima da cabeça. */
export function hairFront(c: Ctx): Layer | null {
  const { look, v, rig } = c;
  const col = look.hairColor;
  const cy = headCy(c);
  const L = new Layer();
  L.vw = 0.5;
  L.hiT = 0.34;
  L.shT = -0.3;
  switch (look.hair) {
    case 'bald':
      return null;
    case 'short':
    case 'bun':
    case 'ponytail':
    case 'pigtails':
    case 'braids':
    case 'space_buns':
      cap(c, { front: look.hair === 'short' ? 0.3 : 0.36, back: look.hair === 'short' ? -0.64 : -0.5, ring: look.hair === 'short' ? 1.1 : 0.7, color: col }, L);
      break;
    case 'long':
    case 'wavy':
      cap(c, { front: 0.3, back: -0.85, ring: 1.1, side: -0.78, color: col }, L);
      break;
    case 'bangs':
      cap(c, { front: 0.12, back: -0.64, ring: 1.1, side: 0.1, color: col }, L);
      break;
    case 'long_bangs':
      cap(c, { front: 0.12, back: -0.85, ring: 1.1, side: -0.78, color: col }, L);
      break;
    case 'bob':
      cap(c, { front: 0.2, back: -0.8, ring: 1.4, side: -0.55, color: col }, L);
      break;
    case 'side_part':
      cap(c, { front: 0.24, back: -0.64, ring: 1.1, skew: -0.3, side: 0.2, color: col }, L);
      break;
    case 'spiky': {
      cap(c, { front: 0.32, back: -0.4, ring: 0.6, color: col }, L);
      const pts: [number, number, number][] = [[0, 3.6, 4.4], [-3.4, 2.4, 3.6], [3.4, 2.4, 3.6], [-5.6, -0.4, 3.4], [5.6, -0.4, 3.4], [-2.6, -2.8, 3.6], [2.6, -2.8, 3.6], [0, -1, 4.8], [0, -5, 3]];
      for (const [l, f, h] of pts) spike(c, L, l, f, h);
      break;
    }
    case 'quiff': {
      cap(c, { front: 0.3, back: -0.55, ring: 0.8, color: col }, L);
      const p = proj(v, 0, 3.4, rig.headZ + HEAD_RZ + 2.2);
      L.blob(p.x, p.y, 5.2, 3.6, col, 2);
      const q = proj(v, 0, 2.4, rig.headZ + HEAD_RZ + 3.4);
      L.fix(Math.floor(q.x) - 1, Math.floor(q.y), shade(col, 0.18));
      L.fix(Math.floor(q.x), Math.floor(q.y), shade(col, 0.18));
      break;
    }
    case 'undercut': {
      // laterais raspadas e o topo comprido, penteado para trás
      cap(c, { front: 0.5, back: -0.2, ring: 0.4, color: mix(look.skin, col, 0.7) }, L);
      cap(c, { front: 0.34, back: -0.1, ring: 1.4, color: col }, L);
      const p = proj(v, 0, 2.6, rig.headZ + HEAD_RZ + 1.6);
      L.blob(p.x, p.y, 4.4, 2.6, col, 2);
      break;
    }
    case 'dreads':
      cap(c, { front: 0.32, back: -0.5, ring: 1.0, color: col }, L);
      break;
    case 'buzz':
      cap(c, { front: 0.5, back: -0.2, ring: 0.4, color: mix(look.skin, col, 0.75) }, L);
      break;
    case 'mohawk': {
      cap(c, { front: 0.5, back: -0.15, ring: 0.2, color: mix(look.skin, col, 0.22) }, L);
      const crest = new Layer();
      crest.vw = 0.3;
      const wc = Math.max(2, rnd(2.4 * Math.abs(v.c) + 1.2));
      let i = 0;
      for (let f = -1; f <= 0.94; f += 0.04, i++) {
        const z = rig.headZ + HEAD_RZ * Math.sqrt(1 - f * f);
        const h = 5.6 - 3.2 * Math.abs(f - 0.05) + (i % 2 ? 1.4 : 0);
        const base = proj(v, 0, f * 7.6, z - 1);
        const top = proj(v, 0, f * 7.6, z + h);
        const left = AX + rnd(base.x - AX - wc / 2);
        for (let y = Math.round(top.y); y <= Math.round(base.y); y++) for (let k = 0; k < wc; k++) crest.fill(left + k, y, col);
      }
      for (let k = 0; k < crest.col.length; k++) {
        const cc = crest.col[k];
        if (cc) {
          L.col[k] = cc;
          L.fx[k] = 0;
        }
      }
      break;
    }
    case 'afro': {
      // nuvem grande e lisa em volta da cabeça
      cap(c, { front: 0.5, back: -0.5, ring: 0.8, color: col }, L);
      puff(c, L, AX, cy - 3, 11.2, 11.6, col, Math.round(cy + 5));
      for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && (x * 7 + y * 13) % 17 === 0) L.fix(x, y, shade(col, 0.14));
      break;
    }
    case 'curly': {
      // cachos: volume menor, borda recortada e espirais escuras dentro
      cap(c, { front: 0.42, back: -0.5, ring: 1, color: col }, L);
      const R = [HEAD_RX + 0.2, HEAD_RZ - 0.2];
      for (let k = 0; k <= 11; k++) {
        const th = (Math.PI * (k + 0.2)) / 11.4;
        bump(c, L, AX + R[0] * Math.cos(th), cy - 0.8 - R[1] * Math.sin(th), 2.5, col);
      }
      bump(c, L, AX - 2.6, cy - HEAD_RZ - 1.6, 2.6, col);
      bump(c, L, AX + 2.6, cy - HEAD_RZ - 1.6, 2.6, col);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 40; x++) if (L.has(x, y) && (x * 3 + y * 5) % 11 === 0) L.fix(x, y, shade(col, -0.2));
      break;
    }
  }
  return L;
}
