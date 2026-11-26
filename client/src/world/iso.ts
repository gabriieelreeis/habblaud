// Projeção isométrica 2:1 do escritório. A simulação continua no plano visto de cima (px de mundo, TILE por tile);
// só o desenho, a câmera e os cliques passam pelo plano isométrico:
//   ix = x − y        iy = (x + y) / 2 − z
// Um tile vira um losango de 2*TILE × TILE; z é a altura em px de tela acima do chão.
// Puro (sem DOM): testado em iso.test.ts.

/** Altura das paredes do fundo (norte e oeste de cada área), em px. */
export const WALL_H = 64;
/** Altura das paredes da frente (sul e leste), cortadas para não esconder o interior. */
export const LOW_WALL_H = 10;
/** Espessura das paredes (px de mundo). */
export const WALL_T = 4;

/** Matriz do plano do chão para `ctx.transform`: desenhar no plano de mundo sob ela projeta no chão. */
export const FLOOR_MATRIX = [1, 0.5, -1, 0.5] as const;

export function isoX(x: number, y: number): number {
  return x - y;
}

export function isoY(x: number, y: number, z = 0): number {
  return (x + y) / 2 - z;
}

/** Ponto do chão (z = 0) sob um ponto do plano isométrico. */
export function fromIso(ix: number, iy: number): { x: number; y: number } {
  return { x: iy + ix / 2, y: iy - ix / 2 };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface IsoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caixa no plano isométrico de um retângulo do chão erguido até `zTop` (px). */
export function isoBounds(b: Box, zTop = 0): IsoRect {
  const x = b.x0 - b.y1;
  const y = (b.x0 + b.y0) / 2 - zTop;
  return { x, y, w: b.x1 - b.y0 - x, h: (b.x1 + b.y1) / 2 - y };
}

/**
 * Ordem de desenho de duas caixas do chão: negativo se `a` fica atrás de `b` (desenha antes), positivo se fica na
 * frente, 0 se não dá para decidir pela separação (caixas que se cruzam). A câmera olha de sudeste: x e y maiores
 * ficam mais perto.
 */
export function boxOrder(a: Box, b: Box): number {
  const behindX = a.x1 <= b.x0;
  const frontX = a.x0 >= b.x1;
  const behindY = a.y1 <= b.y0;
  const frontY = a.y0 >= b.y1;
  const behind = (behindX && !frontY) || (behindY && !frontX);
  const front = (frontX && !behindY) || (frontY && !behindX);
  if (behind && !front) return -1;
  if (front && !behind) return 1;
  return 0;
}

/** Profundidade do centro da caixa (desempate). */
export function centerDepth(b: Box): number {
  return (b.x0 + b.x1 + b.y0 + b.y1) / 2;
}

export interface Sortable {
  box: Box;
  /** Retângulo do desenho no plano isométrico. */
  rect: IsoRect;
  /** Desempate entre caixas que se cruzam: maior desenha depois (ex.: encosto da cadeira por cima de quem senta). */
  bias?: number;
}

function rectsOverlap(a: IsoRect, b: IsoRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** `a` desenha antes de `b`? Usa a separação das caixas e, sem ela, a profundidade do centro e o `bias`. */
export function drawsBefore(a: Sortable, b: Sortable): boolean {
  const o = boxOrder(a.box, b.box);
  if (o !== 0) return o < 0;
  const d = centerDepth(a.box) + (a.bias ?? 0) - centerDepth(b.box) - (b.bias ?? 0);
  return d < 0;
}

/**
 * Ordenação topológica (de trás para a frente) dos itens cujos desenhos se cruzam. Itens que não se cruzam ficam na
 * ordem da profundidade do centro, que também desfaz ciclos. Para as camadas estáticas: O(n²) só quando o layout muda.
 */
export function isoSort<T extends Sortable>(items: readonly T[]): T[] {
  const list = items.slice().sort((a, b) => centerDepth(a.box) + (a.bias ?? 0) - centerDepth(b.box) - (b.bias ?? 0));
  const n = list.length;
  const behind: number[][] = Array.from({ length: n }, () => []);
  // varredura por x do retângulo: só compara quem se cruza na horizontal
  const byX = list.map((_, i) => i).sort((i, j) => list[i].rect.x - list[j].rect.x);
  for (let k = 0; k < n; k++) {
    const i = byX[k];
    const ri = list[i].rect;
    for (let m = k + 1; m < n; m++) {
      const j = byX[m];
      const rj = list[j].rect;
      if (rj.x >= ri.x + ri.w) break;
      if (!rectsOverlap(ri, rj)) continue;
      if (drawsBefore(list[i], list[j])) behind[j].push(i);
      else behind[i].push(j);
    }
  }
  const out: T[] = [];
  const state = new Uint8Array(n);
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (state[s]) continue;
    // DFS iterativa: visita primeiro o que fica atrás
    stack.push(s);
    while (stack.length) {
      const v = stack[stack.length - 1];
      if (state[v] === 0) {
        state[v] = 1;
        const deps = behind[v];
        for (let q = deps.length - 1; q >= 0; q--) if (state[deps[q]] === 0) stack.push(deps[q]);
        continue;
      }
      stack.pop();
      if (state[v] === 1) {
        state[v] = 2;
        out.push(list[v]);
      }
    }
  }
  return out;
}

/** Parede para o corte em fatias: 'south' corre em x no plano y = at; 'east' corre em y no plano x = at. */
export interface WallPlane {
  facing: 'south' | 'east';
  at: number;
  a0: number;
  a1: number;
}

/** Uma fatia de 1 tile de uma parede: recorte [sx0, sx1) do sprite, a caixa no chão e o canto no plano isométrico. */
export interface WallSlice {
  sx0: number;
  sx1: number;
  box: Box;
  rect: IsoRect;
  dx: number;
  dy: number;
}

/**
 * Corta o sprite de uma parede (âncora ax, ay no canto de trás do footprint dela; cw x ch px) em fatias de 1 tile, cada
 * uma com a sua caixa no chão, para a ordem de desenho. Coordenadas do canto arredondadas para px inteiros.
 */
export function wallSlices(ax: number, ay: number, cw: number, ch: number, plane: WallPlane, thick: number, tile = 16): WallSlice[] {
  const out: WallSlice[] = [];
  const south = plane.facing === 'south';
  const bx = south ? plane.a0 : plane.at - thick;
  const by = south ? plane.at - thick : plane.a0;
  const ox = Math.round(isoX(bx, by) - ax);
  const oy = Math.round(isoY(bx, by) - ay);
  const len = plane.a1 - plane.a0;
  const n = Math.max(1, Math.ceil(len / tile - 1e-6));
  for (let k = 0; k < n; k++) {
    const a = k * tile;
    const b = Math.min(len, a + tile);
    let sx0 = south ? ax + a - thick : ax + thick - b;
    let sx1 = south ? ax + b - thick : ax + thick - a;
    if (south ? k === 0 : k === n - 1) sx0 = 0;
    if (south ? k === n - 1 : k === 0) sx1 = cw;
    sx0 = Math.max(0, Math.round(sx0));
    sx1 = Math.min(cw, Math.round(sx1));
    if (sx1 <= sx0) continue;
    const box: Box = south ? { x0: plane.a0 + a, y0: plane.at - thick, x1: plane.a0 + b, y1: plane.at } : { x0: plane.at - thick, y0: plane.a0 + a, x1: plane.at, y1: plane.a0 + b };
    out.push({ sx0, sx1, box, rect: { x: ox + sx0, y: oy, w: sx1 - sx0, h: ch }, dx: ox + sx0, dy: oy });
  }
  return out;
}
