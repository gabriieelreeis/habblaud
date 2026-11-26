// Cabelos: uma "calota" sobre a cabeça (definida pela linha do cabelo em função de lateral/frente/altura, então vale
// para qualquer direção) mais volumes próprios de cada estilo (coque, rabo, cortina, crista, afro...).
import { mix } from '../core/color';
import { AX, Layer, rnd } from './paint';
import { HEAD_RX, HEAD_RZ, headCy, surf } from './head';
import { proj, type Ctx } from './rig';

/** Onde a camada entra na ordem de desenho: antes do corpo, depois do tronco, ou por cima da cabeça. */
export type Stage = 'behind' | 'mid' | 'after';
export interface HairLayer {
  L: Layer;
  stage: Stage;
}

export interface Cap {
  front: number;
  back: number;
  ring: number;
  /** Altura mínima da linha do cabelo nas laterais (cobre orelha/bochecha). */
  side?: number;
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

/** Camadas de cabelo (a calota vem separada: `hairFront`). */
export function hairBack(c: Ctx): HairLayer[] {
  const { look, v, rig } = c;
  const col = look.hairColor;
  const hz = rig.headZ;
  const out: HairLayer[] = [];
  switch (look.hair) {
    case 'bun': {
      const p = proj(v, 0, -3, hz + HEAD_RZ + 2.6);
      const L = new Layer();
      L.blob(p.x, p.y, 3.6, 3.3, col, 2);
      out.push({ L, stage: p.d < -0.5 ? 'behind' : 'after' });
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
      out.push({ L, stage: tie.d < -0.5 ? 'behind' : 'after' });
      break;
    }
    case 'long': {
      const L = new Layer();
      L.vw = 0.2;
      const cx = AX + 5.5 * v.s;
      const half = 7 * Math.abs(v.c) + 3.4 * Math.abs(v.s) + 0.6;
      const yTop = Math.round(headCy(c) - 2);
      const yBot = Math.round(proj(v, 0, 0, rig.torsoTop - 3.5).y);
      for (let y = yTop; y <= yBot; y++) {
        const taper = y > yBot - 2 ? 1 : 0;
        const h = half - taper * 1.2 - (y === yBot ? 0.8 : 0);
        L.row(y, AX + rnd(cx - AX - h), AX + rnd(cx - AX + h) - 1, col);
      }
      out.push({ L, stage: v.c >= -0.2 ? 'behind' : 'mid' });
      break;
    }
    default:
      break;
  }
  return out;
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
      cap(c, { front: look.hair === 'short' ? 0.3 : 0.36, back: look.hair === 'short' ? -0.64 : -0.5, ring: look.hair === 'short' ? 1.1 : 0.7, color: col }, L);
      break;
    case 'long':
      cap(c, { front: 0.3, back: -0.85, ring: 1.1, side: -0.78, color: col }, L);
      break;
    case 'buzz':
      L.flat = false;
      cap(c, { front: 0.5, back: -0.2, ring: 0.4, color: mix(look.skin, col, 0.75) }, L);
      break;
    case 'mohawk': {
      cap(c, { front: 0.5, back: -0.15, ring: 0.2, color: mix(col, '#1c2034', 0.62) }, L);
      const crest = new Layer();
      crest.vw = 0.3;
      const wc = Math.max(2, rnd(2 * Math.abs(v.c) + 1));
      for (let f = -1; f <= 0.92; f += 0.04) {
        const z = rig.headZ + HEAD_RZ * Math.sqrt(1 - f * f);
        const h = 3.8 - 2.6 * Math.abs(f - 0.1);
        const base = proj(v, 0, f * 7.6, z - 1);
        const top = proj(v, 0, f * 7.6, z + h);
        const left = AX + rnd(base.x - AX - wc / 2);
        for (let y = Math.round(top.y); y <= Math.round(base.y); y++) for (let i = 0; i < wc; i++) crest.fill(left + i, y, col);
      }
      // a crista vai por cima da calota
      for (let i = 0; i < crest.col.length; i++) {
        const cc = crest.col[i];
        if (cc) {
          L.col[i] = cc;
          L.fx[i] = 0;
        }
      }
      break;
    }
    case 'afro': {
      cap(c, { front: 0.5, back: -0.5, ring: 0.8, color: col }, L);
      puff(c, L, AX, cy - 3, 11, 11.4, col, Math.round(cy + 5));
      break;
    }
    case 'curly': {
      cap(c, { front: 0.42, back: -0.5, ring: 1, color: col }, L);
      const R = [HEAD_RX + 0.6, HEAD_RZ + 0.2];
      for (let k = 0; k <= 9; k++) {
        const th = (Math.PI * (k + 0.2)) / 9.4;
        bump(c, L, AX + R[0] * Math.cos(th), cy - 0.8 - R[1] * Math.sin(th), 3.1, col);
      }
      bump(c, L, AX - 3, cy - HEAD_RZ - 1.6, 3.1, col);
      bump(c, L, AX + 3, cy - HEAD_RZ - 1.6, 3.1, col);
      break;
    }
  }
  return L;
}
