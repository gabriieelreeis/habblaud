// Móveis isométricos (puro). Convenções em ./kit.ts; a âncora é o canto de trás do footprint.
import type { FurnitureKind } from '../api';
import type { BufFurniture } from '../core/sprite';

/** Desenho isométrico de um kind deste grupo, ou null se o kind não é daqui. */
export function cafeKinds(kind: FurnitureKind, variant: string | undefined, state: number, seed: number): BufFurniture | null {
  void kind;
  void variant;
  void state;
  void seed;
  return null;
}
