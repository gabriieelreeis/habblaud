// Pintura em espaço de tela dos personagens isométricos (puro). As formas são descritas em coordenadas locais
// (x para a direita, y para baixo, origem na âncora) e o espelho é aplicado na rasterização; o sombreado é
// calculado depois, já na tela, com a luz sempre de cima/esquerda — assim as vistas espelhadas não invertem a luz.
import { mix, outlineFor, parseColor, shade, type Ramp } from '../core/color';
import { PixelBuf } from '../core/pixbuf';

export type V2 = readonly [number, number];

/** Cor por pixel da folha (coordenadas absolutas); undefined = não pinta. */
export type Shader = (x: number, y: number) => string | undefined;

/** Máscara binária do tamanho da folha, com caixa delimitadora para varrer pouco. */
export class Mask {
  readonly d: Uint8Array;
  x0: number;
  y0: number;
  x1 = -1;
  y1 = -1;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.d = new Uint8Array(w * h);
    this.x0 = w;
    this.y0 = h;
  }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[y * this.w + x] === 1;
  }

  put(x: number, y: number, on: boolean): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = on ? 1 : 0;
    if (on) {
      if (x < this.x0) this.x0 = x;
      if (y < this.y0) this.y0 = y;
      if (x > this.x1) this.x1 = x;
      if (y > this.y1) this.y1 = y;
    }
  }

  empty(): boolean {
    return this.x1 < 0;
  }

  each(fn: (x: number, y: number) => void): void {
    for (let y = this.y0; y <= this.y1; y++) for (let x = this.x0; x <= this.x1; x++) if (this.d[y * this.w + x]) fn(x, y);
  }

  /** Une outra máscara a esta. */
  add(o: Mask): void {
    o.each((x, y) => this.put(x, y, true));
  }

  /** Remove da máscara os pixels de outra. */
  cut(o: Mask): void {
    o.each((x, y) => this.put(x, y, false));
  }

  /** Mantém só a interseção com outra. */
  keep(o: Mask): void {
    this.each((x, y) => {
      if (!o.has(x, y)) this.put(x, y, false);
    });
  }

  clone(): Mask {
    const m = new Mask(this.w, this.h);
    m.d.set(this.d);
    m.x0 = this.x0;
    m.y0 = this.y0;
    m.x1 = this.x1;
    m.y1 = this.y1;
    return m;
  }

  /** Pixel na borda (algum vizinho de 4 fora da máscara) na direção (dx, dy). */
  edge(x: number, y: number, dx: number, dy: number): boolean {
    return !this.has(x + dx, y + dy);
  }
}

export interface PaintOpts {
  /** Contorno interno sobre o que já estava pintado atrás: false desliga; string fixa a cor. */
  contour?: false | string;
  /** Mistura do contorno interno com a cor de trás (0 = escuro pleno). */
  soft?: number;
}

/** Folha + transformação local -> tela (âncora e espelho). */
export class Painter {
  readonly buf: PixelBuf;

  constructor(
    w: number,
    h: number,
    readonly ax: number,
    readonly ay: number,
    /** 1 = normal, -1 = espelhado. */
    readonly m: 1 | -1,
  ) {
    this.buf = new PixelBuf(w, h);
  }

  /** Coordenada x de tela (contínua) de um x local. */
  X(x: number): number {
    return this.ax + this.m * x;
  }

  Y(y: number): number {
    return this.ay + y;
  }

  mask(): Mask {
    return new Mask(this.buf.w, this.buf.h);
  }

  // ------------------------------------------------------------ formas (locais)

  ellipse(mk: Mask, cx: number, cy: number, rx: number, ry: number, on = true): Mask {
    const X = this.X(cx);
    const Y = this.Y(cy);
    for (let y = Math.floor(Y - ry); y <= Math.ceil(Y + ry); y++) {
      for (let x = Math.floor(X - rx); x <= Math.ceil(X + rx); x++) {
        const u = (x + 0.5 - X) / rx;
        const v = (y + 0.5 - Y) / ry;
        if (u * u + v * v <= 1) mk.put(x, y, on);
      }
    }
    return mk;
  }

  /** Polígono (pontos locais), regra par-ímpar nos centros dos pixels. */
  poly(mk: Mask, pts: readonly V2[], on = true): Mask {
    if (pts.length < 3) return mk;
    const P = pts.map(([x, y]) => [this.X(x), this.Y(y)] as const);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of P) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const cy = y + 0.5;
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        const cx = x + 0.5;
        let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const [xi, yi] = P[i];
          const [xj, yj] = P[j];
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) mk.put(x, y, on);
      }
    }
    return mk;
  }

  /** Cápsula entre dois pontos locais com raio variando de ra a rb. */
  capsule(mk: Mask, a: V2, b: V2, ra: number, rb = ra, on = true): Mask {
    const ax = this.X(a[0]);
    const ay = this.Y(a[1]);
    const bx = this.X(b[0]);
    const by = this.Y(b[1]);
    const r = Math.max(ra, rb);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-6;
    for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px;
        const qy = ay + dy * t - py;
        const rr = ra + (rb - ra) * t;
        if (qx * qx + qy * qy <= rr * rr) mk.put(x, y, on);
      }
    }
    return mk;
  }

  /** Retângulo local alinhado (x0, y0 inclusivos; largura/altura em px). */
  rect(mk: Mask, x0: number, y0: number, w: number, h: number, on = true): Mask {
    return this.poly(mk, [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], on);
  }

  // ------------------------------------------------------------ pintura

  /**
   * Pinta a máscara com o shader e, onde ela cobre algo já pintado, traça um contorno interno de 1 px por
   * fora dela (sobre a peça de trás) para separar as partes.
   */
  paint(mk: Mask, sh: Shader, opts: PaintOpts = {}): void {
    if (mk.empty()) return;
    const b = this.buf;
    if (opts.contour !== false) {
      const soft = opts.soft ?? 0.3;
      const fixed = typeof opts.contour === 'string' ? opts.contour : null;
      for (let y = mk.y0 - 1; y <= mk.y1 + 1; y++) {
        for (let x = mk.x0 - 1; x <= mk.x1 + 1; x++) {
          if (mk.has(x, y) || b.alpha(x, y) < 160) continue;
          let src: [number, number] | null = null;
          if (mk.has(x, y - 1)) src = [x, y - 1];
          else if (mk.has(x - 1, y)) src = [x - 1, y];
          else if (mk.has(x + 1, y)) src = [x + 1, y];
          else if (mk.has(x, y + 1)) src = [x, y + 1];
          if (!src) continue;
          const front = sh(src[0], src[1]);
          if (!front) continue;
          const back = pixelHex(b, x, y);
          const ink = fixed ?? inkOf(front);
          b.set(x, y, soft > 0 ? mix(ink, back, soft) : ink);
        }
      }
    }
    mk.each((x, y) => b.set(x, y, sh(x, y)));
  }

  /** Pixel solto em coordenadas locais (arredondadas para o pixel que contém o ponto). */
  dot(x: number, y: number, c: string | undefined): void {
    if (!c) return;
    // No espelho, o pixel que começa em x vira o que termina em -x.
    const sx = this.m === 1 ? Math.floor(this.ax + x) : Math.floor(this.ax - x - 1);
    this.buf.set(sx, Math.floor(this.ay + y), c);
  }

  /** Linha de pixels locais (pincel de 1 px), extremos inclusivos. */
  line(a: V2, b: V2, c: string | undefined): void {
    if (!c) return;
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    const steps = Math.max(1, Math.round(n));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.dot(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), c);
    }
  }

  /**
   * Template ASCII em coordenadas locais: (x, y) é o canto superior esquerdo ANTES do espelho. No espelho o
   * desenho inverte junto (as colunas correm para a esquerda).
   */
  stamp(rows: readonly string[], x: number, y: number, pal: Readonly<Record<string, string | undefined>>): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        this.dot(x + i, y + r, pal[ch]);
      }
    }
  }
}

/** Cor do contorno interno a partir da cor da frente. */
export function inkOf(front: string): string {
  const [r, g, b] = parseColor(front);
  return mix(outlineFor(r, g, b), front, 0.25);
}

function pixelHex(b: PixelBuf, x: number, y: number): string {
  if (!b.inside(x, y)) return '#000000';
  const i = (y * b.w + x) * 4;
  const d = b.data;
  return `#${hex(d[i])}${hex(d[i + 1])}${hex(d[i + 2])}`;
}

const hex = (n: number) => n.toString(16).padStart(2, '0');

// ------------------------------------------------------------ sombreadores

/**
 * Volume arredondado (elipse de tela): luz de cima/esquerda em faixas. `bias` desloca as faixas (positivo =
 * mais claro).
 */
export function sphereShade(m: Ramp, cx: number, cy: number, rx: number, ry: number, bias = 0): Shader {
  return (x, y) => {
    const u = (x + 0.5 - cx) / rx;
    const v = (y + 0.5 - cy) / ry;
    const lit = -(u * 0.62 + v * 0.78) + bias;
    if (lit > 0.78) return m.hi;
    if (lit > 0.3) return m.lt;
    if (lit > -0.55) return m.base;
    if (lit > -0.95) return m.dk;
    return m.dd;
  };
}

/**
 * Sombreado por borda da máscara: base no miolo, claro onde a borda olha para a luz (cima/esquerda) e escuro
 * onde olha para baixo/direita (2 px na borda de baixo para volumes grandes).
 */
export function rimShade(mk: Mask, m: Ramp, opts: { deep?: boolean; hiTop?: boolean } = {}): Shader {
  return (x, y) => {
    const up = !mk.has(x, y - 1);
    const left = !mk.has(x - 1, y);
    const down = !mk.has(x, y + 1);
    const right = !mk.has(x + 1, y);
    if ((down && right) || (down && opts.deep && !mk.has(x, y + 2) && right)) return m.dd;
    if (down || right) return m.dk;
    if (opts.deep && (!mk.has(x, y + 2) || !mk.has(x + 2, y))) return m.dk;
    if (up && left) return opts.hiTop ? m.hi : m.lt;
    if (up || left) return m.lt;
    return m.base;
  };
}

/** Membro (tubo) entre dois pontos de tela: claro do lado da luz, escuro do outro. */
export function tubeShade(m: Ramp, ax: number, ay: number, bx: number, by: number, r: number): Shader {
  let nx = -(by - ay);
  let ny = bx - ax;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  // normal voltada para a luz (cima/esquerda)
  if (nx * -0.62 + ny * -0.78 < 0) {
    nx = -nx;
    ny = -ny;
  }
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-6;
  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = ((px - (ax + dx * t)) * nx + (py - (ay + dy * t)) * ny) / Math.max(1, r);
    if (s > 0.5) return m.lt;
    if (s > -0.35) return m.base;
    return m.dk;
  };
}

/** Atalho: tom mais escuro para linhas de detalhe (costuras, mechas). */
export function crease(c: string, k = 0.1): string {
  return shade(c, -k);
}
