// Itens na mão: ícones pequenos (estilo "cartaz": o mesmo desenho em todas as direções, o espelho vira o resto) presos ao
// ponto de empunhadura que a pose calculou. Cada padrão diz qual célula cai sobre a mão.
import { shade } from '../core/color';
import { Layer } from './paint';
import { proj, type Ctx, type ItemKind } from './rig';

interface Icon {
  rows: string[];
  /** Célula do padrão que fica sobre a mão. */
  ax: number;
  ay: number;
}

const ICONS: Partial<Record<ItemKind, Icon>> = {
  coffee: { rows: ['bbbb.', 'wwwwh', 'wwwwh', '.www.'], ax: 2, ay: 2 },
  water: { rows: ['wcw', 'CCC', 'CCC', '.C.'], ax: 1, ay: 2 },
  papers: { rows: ['wwwwww', 'wgggww', 'wwwwww', 'wggwww', 'gggggg'], ax: 3, ay: 3 },
  book: { rows: ['rrrrrw', 'rkkkrw', 'rrrrrw', 'rrrrrw', 'rrrrrg'], ax: 3, ay: 3 },
  box: { rows: ['OOOOOOO', 'oootoo.', 'oootooo', 'ooootoo', 'ooooooo', 'OOOOOOO'], ax: 3, ay: 3 },
  paddle: { rows: ['.rrr.', 'rrrrr', 'rrrrr', 'rrrrr', '.rrr.', '..W..', '..W..'], ax: 2, ay: 5 },
  popcorn: { rows: ['pypyp', 'ypypy', 'rwrwr', 'rwrwr', 'rwrwr', '.rwr.'], ax: 2, ay: 4 },
  controller: { rows: ['.ggggg.', 'gkgggbg', 'gggggrg', '.gg.gg.'], ax: 3, ay: 2 },
  rock: { rows: ['.ss.', 'ssss', 'sdds', '.ss.'], ax: 2, ay: 2 },
  fist: { rows: ['.ss.', 'ssss', 'sdds', '.ss.'], ax: 2, ay: 2 },
  paper: { rows: ['sssss', 'sdsds', 'sssss'], ax: 1, ay: 1 },
  scissors: { rows: ['s..s', 's..s', '.ss.', '.ss.'], ax: 1, ay: 3 },
  phone: { rows: ['kkk', 'kBk', 'kBk', 'kBk', 'kkk'], ax: 1, ay: 3 },
  lipstick: { rows: ['rr', 'rr', 'gg', 'gg', 'kk'], ax: 0, ay: 4 },
  comb: { rows: ['yyyyy', 'y.y.y'], ax: 2, ay: 0 },
};

const LAPTOP_LID: Icon = { rows: ['.gggggg.', '.gggwgg.', '.gggggg.', 'dddddddd'], ax: 4, ay: 2 };
const LAPTOP_SCREEN: Icon = { rows: ['.kkkkkk.', '.kBBBBk.', '.kBwBBk.', 'dddddddd'], ax: 4, ay: 2 };

/** Camada do item e se ele fica atrás do corpo (visto de trás). */
export function itemLayer(c: Ctx): { L: Layer; behind: boolean } | null {
  const { rig, v, look } = c;
  if (rig.item === 'none' || !rig.itemAt) return null;
  const icon = rig.item === 'laptop' ? (v.c >= -0.2 ? LAPTOP_LID : LAPTOP_SCREEN) : ICONS[rig.item];
  if (!icon) return null;
  const p = proj(v, rig.itemAt.l, rig.itemAt.f, rig.itemAt.z);
  const hx = Math.floor(p.x);
  const hy = Math.floor(p.y);
  const pal: Record<string, string> = {
    b: '#5a3a26',
    w: '#f3f1ea',
    h: '#c9ccd6',
    c: '#cfe9f5',
    C: '#6cc0e8',
    g: '#9ea3b4',
    k: '#2a2c3a',
    r: '#c9453b',
    o: '#c89a5c',
    O: '#a47a44',
    t: '#e8d9b0',
    W: '#b98a52',
    p: '#f7e7a0',
    y: '#f1c64a',
    B: '#6ec6ff',
    d: shade(look.skin, -0.28),
    s: look.skin,
  };
  if (rig.item === 'paddle') pal.r = '#d6453c';
  if (rig.item === 'laptop') pal.d = '#6d7285';
  if (rig.item === 'lipstick') pal.g = '#e0b040';
  if (rig.item === 'book') pal.r = look.accent;
  const L = new Layer();
  L.inner = true;
  icon.rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '.') continue;
      L.fix(hx - icon.ax + rx, hy - icon.ay + ry, pal[ch]);
    }
  });
  return { L, behind: p.d < -1.2 };
}
