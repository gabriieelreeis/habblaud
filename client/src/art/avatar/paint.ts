// Camadas de pintura do personagem: cada peça é desenhada numa Layer (espaço de projeto, plana, sem sombreamento) e só
// na composição vira pixels: o espelho é aplicado ali e o sombreamento (luz de cima/esquerda) é calculado DEPOIS, já
// em coordenadas de tela, então um lado espelhado continua iluminado pela esquerda.
import { outlineFor, parseColor, shade } from '../core/color';
import type { PixelBuf } from '../core/pixbuf';

export const SHEET_W = 40;
export const SHEET_H = 64;
/** Âncora: centro dos pés, na linha do chão (a primeira linha abaixo das solas). */
export const AX = 20;
export const AY = 59;

/** Arredonda com meio-pixel afastando do zero: formas simétricas em torno de AX continuam simétricas. */
export const rnd = (v: number): number => (v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5));

const idx = (x: number, y: number) => y * SHEET_W + x;
const inSheet = (x: number, y: number) => x >= 0 && y >= 0 && x < SHEET_W && y < SHEET_H;

export class Layer {
  readonly col: (string | undefined)[] = new Array<string | undefined>(SHEET_W * SHEET_H);
  readonly fx = new Uint8Array(SHEET_W * SHEET_H);
  /** Limiares de luz (-0.5*u - 0.5*vw*v): acima de hiT clareia, abaixo de shT escurece. */
  hiT = 0.3;
  shT = -0.22;
  vw = 0.35;
  /** Contorno interno: escurece o vizinho já pintado por baixo (separa braço/cabelo/chapéu do que está atrás). */
  inner = false;
  flat = false;

  fill(x: number, y: number, c: string | undefined): void {
    if (!c || !inSheet(x, y)) return;
    this.col[idx(x, y)] = c;
    this.fx[idx(x, y)] = 0;
  }

  /** Pixel de cor fixa: não recebe sombreamento. */
  fix(x: number, y: number, c: string | undefined): void {
    if (!c || !inSheet(x, y)) return;
    this.col[idx(x, y)] = c;
    this.fx[idx(x, y)] = 1;
  }

  erase(x: number, y: number): void {
    if (inSheet(x, y)) this.col[idx(x, y)] = undefined;
  }

  has(x: number, y: number): boolean {
    return inSheet(x, y) && this.col[idx(x, y)] !== undefined;
  }

  get(x: number, y: number): string | undefined {
    return inSheet(x, y) ? this.col[idx(x, y)] : undefined;
  }

  row(y: number, x0: number, x1: number, c: string | undefined): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.fill(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: string | undefined): void {
    for (let yy = y; yy < y + h; yy++) this.row(yy, x, x + w - 1, c);
  }

  /** Superelipse preenchida; (cx, cy) em coordenadas de fronteira (o pixel x cobre [x, x+1)). */
  blob(cx: number, cy: number, rx: number, ry: number, c: string | undefined, p = 2): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = Math.abs(x + 0.5 - cx) / rx;
        const v = Math.abs(y + 0.5 - cy) / ry;
        if (u ** p + v ** p <= 1) this.fill(x, y, c);
      }
    }
  }

  /**
   * Segmento grosso de (x0, y0) a (x1, y1) (fronteiras), largura `w`; `colorAt(t)` dá a cor ao longo dele (t em
   * [t0, t1]). Segmentos mais verticais viram faixas horizontais por linha; os mais horizontais, colunas.
   */
  seg(x0: number, y0: number, x1: number, y1: number, w: number, colorAt: (t: number) => string | undefined, t0 = 0, t1 = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.abs(dy) >= Math.abs(dx)) {
      const a = Math.round(Math.min(y0, y1));
      let b = Math.round(Math.max(y0, y1));
      if (b <= a) b = a + 1;
      for (let r = a; r < b; r++) {
        const k = dy === 0 ? 0 : Math.min(1, Math.max(0, (r + 0.5 - y0) / dy));
        const xc = x0 + dx * k;
        const left = AX + rnd(xc - AX - w / 2);
        const c = colorAt(t0 + (t1 - t0) * k);
        for (let i = 0; i < w; i++) this.fill(left + i, r, c);
      }
    } else {
      const a = Math.round(Math.min(x0, x1));
      let b = Math.round(Math.max(x0, x1));
      if (b <= a) b = a + 1;
      for (let cx = a; cx < b; cx++) {
        const k = Math.min(1, Math.max(0, (cx + 0.5 - x0) / dx));
        const yc = y0 + dy * k;
        const top = Math.round(yc - w / 2);
        const c = colorAt(t0 + (t1 - t0) * k);
        for (let i = 0; i < w; i++) this.fill(cx, top + i, c);
      }
    }
  }
}

const HI = 0.075;
const SH = -0.115;

/** Pinta a camada no buffer; `mirror` espelha em torno do eixo da folha; (dx, dy) desloca antes do espelho. */
export function composite(buf: PixelBuf, L: Layer, mirror: boolean, dx = 0, dy = 0): void {
  const W = SHEET_W;
  const H = SHEET_H;
  const col = new Array<string | undefined>(W * H);
  const fx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const sx = mirror ? W - 1 - tx : tx;
      col[idx(sx, ty)] = L.col[idx(x, y)];
      fx[idx(sx, ty)] = L.fx[idx(x, y)];
    }
  }
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && col[idx(x, y)] !== undefined;

  // contorno interno sobre o que já existe por baixo
  if (L.inner) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = col[idx(x, y)];
        if (!c) continue;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (has(nx, ny) || !buf.inside(nx, ny) || buf.alpha(nx, ny) < 160) continue;
          const [r, g, b] = parseColor(c);
          buf.set(nx, ny, outlineFor(r, g, b));
        }
      }
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = col[idx(x, y)];
      if (!c) continue;
      if (fx[idx(x, y)] || L.flat) {
        buf.set(x, y, c);
        continue;
      }
      // trechos contíguos na linha e na coluna dão a posição relativa (u, v) dentro da forma
      let l = x;
      while (has(l - 1, y)) l--;
      let r = x;
      while (has(r + 1, y)) r++;
      let t = y;
      while (has(x, t - 1)) t--;
      let b = y;
      while (has(x, b + 1)) b++;
      const u = (x + 0.5 - (l + r + 1) / 2) / ((r - l + 1) / 2);
      const v = (y + 0.5 - (t + b + 1) / 2) / ((b - t + 1) / 2);
      const I = -0.5 * u - 0.5 * L.vw * v;
      buf.set(x, y, I > L.hiT ? shade(c, HI) : I < L.shT ? shade(c, SH) : c);
    }
  }
}
