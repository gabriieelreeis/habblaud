// Camada estática com dono por pixel (puro, sem DOM): paredes, móveis e props são pintados UMA vez, na ordem de
// profundidade, num buffer RGBA, e cada pixel guarda qual item o cobre por último (o "dono"). A cada quadro, quem se
// mexe (personagens, telas, itens de parede animados) é desenhado por cima, com os pixels escondidos onde o dono do
// cenário naquele ponto fica na frente dele. O cenário em si nunca é redesenhado: fora do que a entidade pinta, o
// quadro é idêntico ao cenário sem ninguém. Testado em compose.test.ts.
import { drawsBefore, type IsoRect, type Sortable } from '../iso';

/** Pixels RGBA (alfa não pré-multiplicado), como os de ImageData e PixelBuf. */
export interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/** Item da camada: recorte (sx, sy, sw, sh) de `px` desenhado com o canto em (dx, dy) do plano isométrico. */
export interface LayerItem extends Sortable {
  px: Pixels;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
}

/** A camada pintada: retângulo no plano isométrico, cor e dono de cada pixel (índice do item + 1; 0 = chão). */
export interface Composite {
  x: number;
  y: number;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  ids: Uint16Array;
}

/** Alfa mínimo para um pixel do item virar o dono daquele ponto (sombras e vidro não escondem ninguém). */
export const OWNER_ALPHA = 128;

/** Caixa (inteira) de todos os itens. */
export function layerBounds(items: readonly LayerItem[]): IsoRect | null {
  if (!items.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of items) {
    x0 = Math.min(x0, it.dx);
    y0 = Math.min(y0, it.dy);
    x1 = Math.max(x1, it.dx + it.sw);
    y1 = Math.max(y1, it.dy + it.sh);
  }
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
}

/**
 * Pinta os itens, já na ordem de desenho (de trás para a frente), num buffer novo e grava o dono de cada pixel: o último
 * item com alfa ≥ OWNER_ALPHA ali. Mistura "source-over" com alfa não pré-multiplicado, como o canvas.
 */
export function composeLayer(order: readonly LayerItem[], bounds = layerBounds(order)): Composite | null {
  if (!bounds || order.length > 65534) return null;
  const { x: bx, y: by, w: W, h: H } = bounds;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const ids = new Uint16Array(W * H);
  for (let n = 0; n < order.length; n++) {
    const it = order[n];
    const src = it.px.data;
    const sw = it.px.w;
    const ox = Math.round(it.dx) - bx;
    const oy = Math.round(it.dy) - by;
    const id = n + 1;
    for (let j = 0; j < it.sh; j++) {
      const ty = oy + j;
      const syy = it.sy + j;
      if (ty < 0 || ty >= H || syy < 0 || syy >= it.px.h) continue;
      for (let i = 0; i < it.sw; i++) {
        const tx = ox + i;
        const sxx = it.sx + i;
        if (tx < 0 || tx >= W || sxx < 0 || sxx >= sw) continue;
        const s = (syy * sw + sxx) * 4;
        const a = src[s + 3];
        if (!a) continue;
        const t = ty * W + tx;
        const d = t * 4;
        if (a >= 255) {
          rgba[d] = src[s];
          rgba[d + 1] = src[s + 1];
          rgba[d + 2] = src[s + 2];
          rgba[d + 3] = 255;
        } else {
          const sa = a / 255;
          const da = rgba[d + 3] / 255;
          const oa = sa + da * (1 - sa);
          rgba[d] = (src[s] * sa + rgba[d] * da * (1 - sa)) / oa;
          rgba[d + 1] = (src[s + 1] * sa + rgba[d + 1] * da * (1 - sa)) / oa;
          rgba[d + 2] = (src[s + 2] * sa + rgba[d + 2] * da * (1 - sa)) / oa;
          rgba[d + 3] = oa * 255;
        }
        if (a >= OWNER_ALPHA) ids[t] = id;
      }
    }
  }
  return { x: bx, y: by, w: W, h: H, rgba, ids };
}

/** Lado (px) das células da grade de busca dos itens. */
export const GRID = 64;
const cellKey = (gx: number, gy: number): number => (gx + 4096) * 8192 + (gy + 4096);

/** Índices dos itens por célula GRID x GRID do plano isométrico (para achar quem cruza um retângulo). */
export function buildGrid(items: readonly { rect: IsoRect }[]): Map<number, number[]> {
  const grid = new Map<number, number[]>();
  items.forEach((it, i) => {
    for (let gy = Math.floor(it.rect.y / GRID); gy <= Math.floor((it.rect.y + it.rect.h) / GRID); gy++) {
      for (let gx = Math.floor(it.rect.x / GRID); gx <= Math.floor((it.rect.x + it.rect.w) / GRID); gx++) {
        const k = cellKey(gx, gy);
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(i);
      }
    }
  });
  return grid;
}

const overlaps = (a: IsoRect, b: IsoRect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Marca em `flags` (um byte por item) os itens da camada que ficam NA FRENTE de `e` e cruzam o desenho dela; devolve
 * quantos e uma assinatura (para cache). `out` recebe os índices marcados, para limpar depois.
 */
export function markFront(e: Sortable, items: readonly (Sortable & { rect: IsoRect })[], grid: Map<number, number[]>, flags: Uint8Array, out: number[]): { n: number; sig: number } {
  out.length = 0;
  let sig = 0;
  const r = e.rect;
  for (let gy = Math.floor(r.y / GRID); gy <= Math.floor((r.y + r.h) / GRID); gy++) {
    for (let gx = Math.floor(r.x / GRID); gx <= Math.floor((r.x + r.w) / GRID); gx++) {
      const a = grid.get(cellKey(gx, gy));
      if (!a) continue;
      for (const i of a) {
        if (flags[i]) continue;
        const it = items[i];
        if (!overlaps(it.rect, r) || !drawsBefore(e, it)) continue;
        flags[i] = 1;
        out.push(i);
        sig = (Math.imul(sig, 31) + i + 1) | 0;
      }
    }
  }
  return { n: out.length, sig };
}

/**
 * Esconde (alfa 0) os pixels de um desenho RGBA com o canto em (ex, ey) cujo dono na camada está marcado em `flags`.
 * Devolve quantos pixels visíveis foram escondidos.
 */
export function maskBehind(rgba: Uint8ClampedArray, w: number, h: number, ex: number, ey: number, layer: Pick<Composite, 'x' | 'y' | 'w' | 'h' | 'ids'>, flags: Uint8Array): number {
  let hidden = 0;
  const ox = ex - layer.x;
  const oy = ey - layer.y;
  for (let j = 0; j < h; j++) {
    const ly = oy + j;
    if (ly < 0 || ly >= layer.h) continue;
    const row = ly * layer.w;
    for (let i = 0; i < w; i++) {
      const lx = ox + i;
      if (lx < 0 || lx >= layer.w) continue;
      const id = layer.ids[row + lx];
      if (!id || !flags[id - 1]) continue;
      const a = (j * w + i) * 4 + 3;
      if (rgba[a]) {
        rgba[a] = 0;
        hidden++;
      }
    }
  }
  return hidden;
}

/**
 * Máscara (RGBA, branco opaco) dos pixels de um retângulo da tela cujo dono na camada está marcado em `flags`: onde o
 * cenário fica na frente da entidade. O renderizador desenha a entidade e depois devolve, só nesses pixels, os pixels da
 * própria camada (o resultado é o mesmo de esconder os pixels da entidade ali, sem ler pixels da placa de vídeo).
 */
export function frontMask(x: number, y: number, w: number, h: number, layer: Pick<Composite, 'x' | 'y' | 'w' | 'h' | 'ids'>, flags: Uint8Array, out?: Uint8ClampedArray): Uint8ClampedArray {
  const m = out && out.length >= w * h * 4 ? out : new Uint8ClampedArray(w * h * 4);
  m.fill(0, 0, w * h * 4);
  const ox = x - layer.x;
  const oy = y - layer.y;
  for (let j = 0; j < h; j++) {
    const ly = oy + j;
    if (ly < 0 || ly >= layer.h) continue;
    const row = ly * layer.w;
    for (let i = 0; i < w; i++) {
      const lx = ox + i;
      if (lx < 0 || lx >= layer.w) continue;
      const id = layer.ids[row + lx];
      if (!id || !flags[id - 1]) continue;
      const k = (j * w + i) * 4;
      m[k] = 255;
      m[k + 1] = 255;
      m[k + 2] = 255;
      m[k + 3] = 255;
    }
  }
  return m;
}

/**
 * O que o renderizador faz na placa de vídeo ('source-atop'): os pixels da camada cujo dono está marcado em `flags`
 * entram por cima do desenho RGBA de uma entidade (canto em ex, ey), só onde ela tem pixel, e o alfa continua o dela.
 * Onde ela não pinta, o quadro fica igual ao cenário; atrás de vidro, ela aparece através dele.
 */
export function atopFront(src: Uint8ClampedArray, w: number, h: number, ex: number, ey: number, layer: Pick<Composite, 'x' | 'y' | 'w' | 'h' | 'ids' | 'rgba'>, flags: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  for (let j = 0; j < h; j++) {
    const ly = ey + j - layer.y;
    if (ly < 0 || ly >= layer.h) continue;
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      if (!out[k + 3]) continue;
      const lx = ex + i - layer.x;
      if (lx < 0 || lx >= layer.w) continue;
      const id = layer.ids[ly * layer.w + lx];
      if (!id || !flags[id - 1]) continue;
      const d = (ly * layer.w + lx) * 4;
      const sa = layer.rgba[d + 3] / 255;
      out[k] = layer.rgba[d] * sa + out[k] * (1 - sa);
      out[k + 1] = layer.rgba[d + 1] * sa + out[k + 1] * (1 - sa);
      out[k + 2] = layer.rgba[d + 2] * sa + out[k + 2] * (1 - sa);
    }
  }
  return out;
}

/** Mistura um desenho RGBA (canto em ex, ey) sobre um buffer do tamanho da camada (para testes e prévias). */
export function blendOnto(dst: Uint8ClampedArray, layer: Pick<Composite, 'x' | 'y' | 'w' | 'h'>, src: Uint8ClampedArray, w: number, h: number, ex: number, ey: number): void {
  for (let j = 0; j < h; j++) {
    const ty = ey + j - layer.y;
    if (ty < 0 || ty >= layer.h) continue;
    for (let i = 0; i < w; i++) {
      const tx = ex + i - layer.x;
      if (tx < 0 || tx >= layer.w) continue;
      const s = (j * w + i) * 4;
      const a = src[s + 3];
      if (!a) continue;
      const d = (ty * layer.w + tx) * 4;
      const sa = a / 255;
      const da = dst[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      dst[d] = (src[s] * sa + dst[d] * da * (1 - sa)) / oa;
      dst[d + 1] = (src[s + 1] * sa + dst[d + 1] * da * (1 - sa)) / oa;
      dst[d + 2] = (src[s + 2] * sa + dst[d + 2] * da * (1 - sa)) / oa;
      dst[d + 3] = oa * 255;
    }
  }
}
