// Para onde o personagem olha NA TELA, entre 8 direções (puro). Andando, vale o movimento de verdade (na diagonal do
// mundo ele olha reto na tela); parado, a direção do mundo vira a diagonal da tela. Ao virar 90° ou mais, passa um
// instante pela direção do meio, como quem gira o corpo.
import type { Dir, ScreenDir } from '../../art/api';

/** Ordem no sentido horário, começando olhando para quem vê. */
export const VIEWS: readonly ScreenDir[] = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];
const DIAGONAL: Readonly<Record<Dir, ScreenDir>> = { down: 'sw', right: 'se', up: 'ne', left: 'nw' };

/** Direção na tela de um deslocamento no mundo (px), ou null se for pequeno demais. */
export function viewOfMotion(dx: number, dy: number): ScreenDir | null {
  // tela: x = dx − dy, y = (dx + dy) / 2
  const sx = dx - dy;
  const sy = (dx + dy) / 2;
  if (sx * sx + sy * sy < 0.04) return null;
  // ângulo a partir de "para baixo" (s), crescendo para a esquerda (sw, w...)
  const a = Math.atan2(-sx, sy);
  const k = Math.round(a / (Math.PI / 4));
  return VIEWS[((k % 8) + 8) % 8];
}

const TURN_MS = 110;

interface Track {
  view: ScreenDir;
  x: number;
  y: number;
  /** Direção do meio mostrada até este instante (giro). */
  mid: ScreenDir | null;
  midUntil: number;
}

/** Guarda, por personagem, a última direção e posição para escolher a próxima. */
export class ViewTracker {
  private tracks = new Map<string, Track>();

  view(id: string, x: number, y: number, dir: Dir, moving: boolean, now: number): ScreenDir {
    let t = this.tracks.get(id);
    const still = DIAGONAL[dir];
    if (!t) {
      t = { view: still, x, y, mid: null, midUntil: 0 };
      this.tracks.set(id, t);
    }
    let target = still;
    if (moving) target = viewOfMotion(x - t.x, y - t.y) ?? t.view;
    t.x = x;
    t.y = y;
    if (target !== t.view) {
      const from = VIEWS.indexOf(t.view);
      const to = VIEWS.indexOf(target);
      const d = (to - from + 8) % 8;
      // virou 90° ou mais: um instante na direção do meio (pelo lado mais curto)
      if (d >= 2 && d <= 6) {
        const step = d <= 4 ? 1 : -1;
        t.mid = VIEWS[(from + step + 8) % 8];
        t.midUntil = now + TURN_MS;
      }
      t.view = target;
    }
    if (t.mid && now < t.midUntil) return t.mid;
    t.mid = null;
    return t.view;
  }

  /** Esquece quem não está mais no escritório. */
  keep(ids: ReadonlySet<string>): void {
    for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id);
  }
}
