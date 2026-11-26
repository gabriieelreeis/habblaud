// Carro de passeio na visão isométrica, andando ao longo do eixo x do mundo (footprint 2x1 tiles).
import type { BufSprite } from '../core/sprite';
import { Iso, tone } from './kit';

// Corpo, escuro e claro de cada variante (mesma tabela do desenho antigo dos carros).
const CAR_COLORS: [string, string, string][] = [
  ['#d9534a', '#a83a33', '#f08a80'],
  ['#3f7fd8', '#2c5ea6', '#7fb0f0'],
  ['#f2f2ee', '#c4c6c8', '#ffffff'],
  ['#f2b33d', '#c88a1f', '#ffd889'],
  ['#2fb3a3', '#1f8579', '#79dccf'],
  ['#4a5468', '#323a4a', '#76819a'],
];

const TIRE = '#23262f';
const RIM = '#8c93a1';
const GLASS = tone('#7fb4dc', 0.08);

/** `dir` 1 = para leste (frente na face leste), -1 = para oeste (face leste mostra a traseira). */
export function renderIsoCar(variant: number, dir: 1 | -1): BufSprite {
  const [body, dark, light] = CAR_COLORS[((variant % CAR_COLORS.length) + CAR_COLORS.length) % CAR_COLORS.length];
  const s = new Iso(2, 1, 30);
  s.shadow(1, 1, 31, 15, 0.26, 2);

  const X0 = 1;
  const X1 = 31;
  const Y0 = 1;
  const Y1 = 15;
  // cabine: mais perto da traseira
  const c0 = dir === 1 ? 6 : 12;
  const c1 = dir === 1 ? 20 : 26;
  const front = dir === 1 ? X1 : X0;

  // rodas de trás (lado norte/oeste ficam escondidas); aparecem as da face sul
  const wheelX = [X0 + 5, X1 - 5];
  for (const wx of wheelX) s.box(wx - 3, Y0 + 1, 0, wx + 3, Y1 - 1, 5, { top: TIRE, south: TIRE, east: '#171a21' });

  // saia escura sob a carroceria
  s.box(X0, Y0, 1, X1, Y1, 4, { top: dark, south: dark, east: tone(dark).dk });

  // carroceria baixa
  s.box(X0, Y0, 4, X1, Y1, 9, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? light : body),
    south: (u, v, w) => {
      if (v < 1) return light; // friso de cima
      if (v >= 3 && v < 4 && u > 2 && u < w - 2) return dark; // porta/linha de cintura
      if (v >= 5) return dark;
      return body;
    },
    east: (u, v) => (v < 1 ? body : v >= 5 ? tone(dark).dk : tone(body).dk),
  });

  // cabine mais estreita
  const roofZ = 17;
  s.box(c0, Y0 + 2, 9, c1, Y1 - 2, roofZ, {
    top: (u, v, w, h) => (v >= h - 1 || u >= w - 1 ? '#ffffff55' : light),
    south: (u, v, w, h) => {
      if (v < 1 || v >= h - 1) return body;
      const pillar = u < 1.5 || u >= w - 1.5 || Math.abs(u - w / 2) < 0.8;
      if (pillar) return body;
      return v < 2.5 ? GLASS.hi : GLASS.base;
    },
    east: (u, v, w, h) => {
      if (v < 1 || v >= h - 1 || u < 1 || u >= w - 1) return tone(body).dk;
      return v < 3 ? GLASS.base : GLASS.dk;
    },
  });
  // brilho no vidro
  s.line([c0 + 3, Y1 - 2, 15], [c0 + 5, Y1 - 2, 11], '#ffffffaa');

  // rodas da face sul (por cima da carroceria) e arcos
  for (const wx of wheelX) {
    s.south(wx - 3, wx + 3, Y1, 0, 5, (u, v) => (v < 1 && (u < 1 || u > 4) ? undefined : TIRE));
    s.south(wx - 1, wx + 1, Y1, 1.5, 3.5, RIM);
  }

  // frente/traseira: faróis ou lanternas na face leste e no canto da face sul
  const headEast = dir === 1;
  const lampE = headEast ? '#fff5c4' : '#e0383a';
  const lampDim = headEast ? '#e8d78a' : '#9c2226';
  s.east(Y0 + 1, Y0 + 4, X1, 5, 7.5, (_u, v) => (v < 1.5 ? lampE : lampDim));
  s.east(Y1 - 4, Y1 - 1, X1, 5, 7.5, (_u, v) => (v < 1.5 ? lampE : lampDim));
  // grade/placa na face leste
  s.east(Y0 + 5, Y1 - 5, X1, 4.5, 6.5, headEast ? '#3a4050' : '#e9ecf2');
  // lanterna/farol da ponta da face sul
  const fx = front === X1 ? X1 - 2 : X0;
  s.south(fx, fx + 2, Y1, 5, 7.5, front === X1 ? '#fff5c4' : '#e0383a');
  s.south(front === X1 ? X1 - 3 : X0 + 2, front === X1 ? X1 - 2 : X0 + 3, Y1, 5, 7.5, front === X1 ? '#e8d78a' : '#9c2226');

  // âncora no centro do footprint (16, 8, 0)
  const cx = s.sx(16, 8);
  const cy = s.sy(16, 8, 0);
  const r = s.finish();
  return { ...r, ax: r.ax + (cx - s.ox), ay: r.ay + (cy - s.oy) };
}
