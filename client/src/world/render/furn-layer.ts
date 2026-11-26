// Camadas de desenho do lado de fora: que props podem ser pintados uma vez (a camada dos móveis e paredes, com o
// dono de cada pixel, fica em compose.ts).
// Puro (sem DOM): testado em furn-layer.test.ts.
import type { ExteriorProp } from '../layout/types';

/** Retângulo no mundo. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Props do lado de fora que nunca se cruzam com nada que se mexe: vão para as camadas pré-pintadas.
 * Fora: os que surgem com a sala (`whenRoom`), o poste (carro passa na frente), banco, totem e calçamento
 * (perto do caminho do visitante).
 */
export function isStaticProp(p: Pick<ExteriorProp, 'kind' | 'whenRoom'>): boolean {
  return p.whenRoom === undefined && p.kind !== 'lamp' && p.kind !== 'bench' && p.kind !== 'totem' && p.kind !== 'paving';
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Props que vão para as camadas pré-pintadas: os estáticos que não tocam nenhum prop dinâmico. Um estático que
 * cruza o poste (ou outro dinâmico) fica na lista de profundidade, senão a camada o pintaria por cima do poste
 * (ou por baixo) mesmo quando o `y` manda o contrário.
 */
export function layerProps<P extends Pick<ExteriorProp, 'kind' | 'whenRoom'>>(props: readonly P[], rectOf: (p: P) => Rect): Set<P> {
  const dyn: Rect[] = [];
  for (const p of props) if (!isStaticProp(p)) dyn.push(rectOf(p));
  const out = new Set<P>();
  for (const p of props) {
    if (!isStaticProp(p)) continue;
    const r = rectOf(p);
    if (!dyn.some((d) => overlaps(d, r))) out.add(p);
  }
  return out;
}
