// Kit de desenho isométrico (puro): folha com origem no canto de trás do footprint e faces preenchidas pixel a
// pixel pela projeção inversa, para as arestas 2:1 saírem sempre iguais.
//
// Coordenadas locais: x e y em px de mundo (TILE por tile) a partir do canto de trás (noroeste) do footprint, z em
// px para cima. Na folha: sx = ox + x − y, sy = oy + (x + y) / 2 − z. A câmera olha de sudeste: vemos o topo, a face
// sul (embaixo à esquerda, mais clara) e a face leste (embaixo à direita, mais escura).
import { TILE, type Rect } from '../api';
import { mix, shade, type Ramp } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite, Rects } from '../core/sprite';

/** Cor fixa ou sombreador por pixel: (u, v) dentro da face e o tamanho (w, h) dela. */
export type Fill = string | undefined | ((u: number, v: number, w: number, h: number) => string | undefined);

export interface BoxMat {
  top: Fill;
  south: Fill;
  east: Fill;
}

/** Retângulo de conteúdo dinâmico (tela, quadro) numa face: `skew` = px que desce a cada px para a direita. */
export type SkewRect = Rect & { skew?: number };

const call = (f: Fill, u: number, v: number, w: number, h: number): string | undefined => (typeof f === 'function' ? f(u, v, w, h) : f);

/** Material padrão de uma rampa: topo claro com a aresta da frente brilhante, sul na base, leste escuro. */
export function rampMat(m: Ramp): BoxMat {
  return {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? m.hi : m.lt),
    south: (_u, v) => (v < 1 ? m.lt : m.base),
    east: (_u, v) => (v < 1 ? m.base : m.dk),
  };
}

export class Iso {
  readonly buf: PixelBuf;
  /** Posição na folha do ponto (0, 0, 0): o canto de trás do footprint (a âncora do sprite). */
  readonly ox: number;
  readonly oy: number;
  /** Footprint em px de mundo. */
  readonly fw: number;
  readonly fh: number;
  readonly rects: Rects & Partial<Record<string, SkewRect>> = {};

  /** `wt` x `ht` tiles de footprint; `up` = px livres acima do chão (altura máxima do desenho). */
  constructor(wt: number, ht: number, up = 64, margin = 6) {
    this.fw = wt * TILE;
    this.fh = ht * TILE;
    const w = this.fw + this.fh + margin * 2;
    const h = up + (this.fw + this.fh) / 2 + margin * 2;
    this.buf = new PixelBuf(Math.ceil(w), Math.ceil(h));
    this.ox = margin + this.fh;
    this.oy = up + margin;
  }

  sx(x: number, y: number): number {
    return this.ox + x - y;
  }

  sy(x: number, y: number, z = 0): number {
    return this.oy + (x + y) / 2 - z;
  }

  /** Pixel no ponto 3D (arredondado). */
  px(x: number, y: number, z: number, c: string | undefined): void {
    this.buf.set(Math.floor(this.sx(x, y)), Math.floor(this.sy(x, y, z)), c);
  }

  /** Linha entre dois pontos 3D. */
  line(a: readonly [number, number, number], b: readonly [number, number, number], c: string | undefined, size = 1): void {
    this.buf.line(Math.floor(this.sx(a[0], a[1])), Math.floor(this.sy(a[0], a[1], a[2])), Math.floor(this.sx(b[0], b[1])), Math.floor(this.sy(b[0], b[1], b[2])), c, size);
  }

  /** Face horizontal na altura z sobre [x0,x1]×[y0,y1]. u = x − x0, v = y − y0. */
  top(x0: number, y0: number, x1: number, y1: number, z: number, fill: Fill): void {
    const w = x1 - x0;
    const h = y1 - y0;
    const sxA = Math.floor(this.sx(x0, y1)) - 1;
    const sxB = Math.ceil(this.sx(x1, y0)) + 1;
    const syA = Math.floor(this.sy(x0, y0, z)) - 1;
    const syB = Math.ceil(this.sy(x1, y1, z)) + 1;
    for (let py = syA; py <= syB; py++) {
      const b = 2 * (py + 0.5 - this.oy + z);
      for (let px = sxA; px <= sxB; px++) {
        const a = px + 0.5 - this.ox;
        const x = (b + a) / 2;
        const y = (b - a) / 2;
        // folga de 1/4 px: as pontas do losango ficam com a largura cheia (32 px por tile), como na pixel art isométrica
        if (x < x0 - 0.25 || x >= x1 + 0.25 || y < y0 - 0.25 || y >= y1 + 0.25) continue;
        this.buf.set(px, py, call(fill, Math.max(0, Math.min(w - 0.01, x - x0)), Math.max(0, Math.min(h - 0.01, y - y0)), w, h));
      }
    }
  }

  /** Face vertical voltada para o sul (plano y fixo, de x0 a x1). u = x − x0, v = z1 − z (0 no alto). */
  south(x0: number, x1: number, y: number, z0: number, z1: number, fill: Fill): void {
    const w = x1 - x0;
    const h = z1 - z0;
    const sxA = Math.floor(this.sx(x0, y));
    const sxB = Math.ceil(this.sx(x1, y));
    const syA = Math.floor(this.sy(x0, y, z1));
    const syB = Math.ceil(this.sy(x1, y, z0));
    for (let px = sxA; px <= sxB; px++) {
      const x = px + 0.5 - this.ox + y;
      if (x < x0 || x > x1) continue;
      for (let py = syA; py <= syB; py++) {
        const z = this.oy + (x + y) / 2 - (py + 0.5);
        if (z < z0 || z > z1) continue;
        this.buf.set(px, py, call(fill, Math.min(w - 0.5, x - x0), z1 - z, w, h));
      }
    }
  }

  /** Face vertical voltada para o leste (plano x fixo, de y0 a y1). u = y − y0, v = z1 − z. */
  east(y0: number, y1: number, x: number, z0: number, z1: number, fill: Fill): void {
    const w = y1 - y0;
    const h = z1 - z0;
    const sxA = Math.floor(this.sx(x, y1));
    const sxB = Math.ceil(this.sx(x, y0));
    const syA = Math.floor(this.sy(x, y0, z1));
    const syB = Math.ceil(this.sy(x, y1, z0));
    for (let px = sxA; px <= sxB; px++) {
      const y = x - (px + 0.5 - this.ox);
      if (y < y0 || y > y1) continue;
      for (let py = syA; py <= syB; py++) {
        const z = this.oy + (x + y) / 2 - (py + 0.5);
        if (z < z0 || z > z1) continue;
        this.buf.set(px, py, call(fill, Math.min(w - 0.5, y - y0), z1 - z, w, h));
      }
    }
  }

  /** Caixa: faces sul e leste e o topo. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: BoxMat | Ramp): void {
    const m = 'top' in mat ? mat : rampMat(mat);
    this.south(x0, x1, y1, z0, z1, m.south);
    this.east(y0, y1, x1, z0, z1, m.east);
    this.top(x0, y0, x1, y1, z1, m.top);
  }

  /** Cilindro vertical de raio r (px de mundo) centrado em (cx, cy). Luz da esquerda. */
  cyl(cx: number, cy: number, r: number, z0: number, z1: number, m: Ramp, topFill?: Fill): void {
    const R = r * Math.SQRT2;
    const scx = this.sx(cx, cy);
    const scy0 = this.sy(cx, cy, z0);
    const scy1 = this.sy(cx, cy, z1);
    for (let px = Math.floor(scx - R); px <= Math.ceil(scx + R); px++) {
      const t = (px + 0.5 - scx) / R;
      if (t < -1 || t > 1) continue;
      const half = (R / 2) * Math.sqrt(1 - t * t);
      const c = t < -0.55 ? m.lt : t < 0.1 ? m.base : t < 0.6 ? m.dk : m.dd;
      for (let py = Math.floor(scy1); py <= Math.ceil(scy0 + half); py++) {
        const yy = py + 0.5;
        if (yy < scy1 || yy > scy0 + half) continue;
        this.buf.set(px, py, c);
      }
    }
    this.disc(cx, cy, r, z1, topFill ?? m.lt);
  }

  /** Disco horizontal (elipse 2:1) de raio r na altura z. u, v em [-1, 1]. */
  disc(cx: number, cy: number, r: number, z: number, fill: Fill): void {
    const R = r * Math.SQRT2;
    const scx = this.sx(cx, cy);
    const scy = this.sy(cx, cy, z);
    for (let py = Math.floor(scy - R / 2); py <= Math.ceil(scy + R / 2); py++) {
      for (let px = Math.floor(scx - R); px <= Math.ceil(scx + R); px++) {
        const u = (px + 0.5 - scx) / R;
        const v = (py + 0.5 - scy) / (R / 2);
        if (u * u + v * v > 1) continue;
        this.buf.set(px, py, call(fill, u, v, 2, 2));
      }
    }
  }

  /** Bolha (folhagem, almofada): elipse de tela centrada no ponto 3D, com sombreado de 3 tons. */
  blob(x: number, y: number, z: number, rx: number, ry: number, m: Ramp): void {
    const scx = this.sx(x, y);
    const scy = this.sy(x, y, z);
    for (let py = Math.floor(scy - ry); py <= Math.ceil(scy + ry); py++) {
      for (let px = Math.floor(scx - rx); px <= Math.ceil(scx + rx); px++) {
        const u = (px + 0.5 - scx) / rx;
        const v = (py + 0.5 - scy) / ry;
        const d = u * u + v * v;
        if (d > 1) continue;
        const lit = u * 0.6 + v * 0.8;
        this.buf.set(px, py, lit < -0.45 ? m.hi : lit < 0.05 ? m.lt : lit < 0.5 ? m.base : m.dk);
      }
    }
  }

  /** Sombra de contato no chão (composta por baixo) sobre [x0,x1]×[y0,y1], um pouco maior que o footprint. */
  shadow(x0: number, y0: number, x1: number, y1: number, alpha = 0.22, grow = 2): void {
    const c = `rgba(28,32,52,${alpha})`;
    const sxA = Math.floor(this.sx(x0 - grow, y1 + grow));
    const sxB = Math.ceil(this.sx(x1 + grow, y0 - grow));
    const syA = Math.floor(this.sy(x0 - grow, y0 - grow));
    const syB = Math.ceil(this.sy(x1 + grow, y1 + grow));
    for (let py = syA; py <= syB; py++) {
      const b = 2 * (py + 0.5 - this.oy);
      for (let px = sxA; px <= sxB; px++) {
        const a = px + 0.5 - this.ox;
        const x = (b + a) / 2;
        const y = (b - a) / 2;
        if (x < x0 - grow || x >= x1 + grow || y < y0 - grow || y >= y1 + grow) continue;
        this.buf.under(px, py, c);
      }
    }
  }

  /** Registra um retângulo de conteúdo dinâmico na face sul (x de x0 a x1 no plano y, z de z0 a z1). */
  southRect(name: string, x0: number, x1: number, y: number, z0: number, z1: number): void {
    const x = Math.round(this.sx(x0, y));
    const top = Math.round(this.sy(x0, y, z1));
    this.rects[name as keyof Rects] = { x, y: top, w: Math.round(x1 - x0), h: Math.round(z1 - z0), skew: 0.5 } as SkewRect;
  }

  /** Idem na face leste (y de y0 a y1 no plano x). */
  eastRect(name: string, y0: number, y1: number, x: number, z0: number, z1: number): void {
    const left = Math.round(this.sx(x, y1));
    const top = Math.round(this.sy(x, y1, z1));
    this.rects[name as keyof Rects] = { x: left, y: top, w: Math.round(y1 - y0), h: Math.round(z1 - z0), skew: -0.5 } as SkewRect;
  }

  /** Contorna, recorta e devolve o sprite com a âncora no canto de trás do footprint. */
  finish(opts: { outline?: boolean } = {}): BufSprite {
    if (opts.outline !== false) this.buf.outline();
    const b = this.buf.bounds();
    if (!b) return { buf: this.buf, ax: this.ox, ay: this.oy, rects: this.rects };
    const buf = this.buf.crop(b.x, b.y, b.w, b.h);
    const rects: Rects = {};
    for (const [k, r] of Object.entries(this.rects)) if (r) (rects as Record<string, SkewRect>)[k] = { ...r, x: r.x - b.x, y: r.y - b.y };
    return { buf, ax: this.ox - b.x, ay: this.oy - b.y, rects };
  }
}

/** Rampa a partir de uma cor (atalho com o passo dos móveis). */
export function tone(base: string, step = 0.07): Ramp {
  return { hi: shade(base, step * 2), lt: shade(base, step), base, dk: shade(base, -step), dd: shade(base, -step * 2) };
}

/** Mistura de duas cores (reexportada para os desenhos). */
export { mix, shade };
