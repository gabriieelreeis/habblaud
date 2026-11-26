// Paleta do personagem isométrico (puro): as mesmas cores da aparência do personagem de cima, com rampas um pouco
// mais longas para os volumes maiores.
import type { Appearance } from '../api';
import { luminance, mix, ramp, shade, type Ramp } from '../core/color';

export interface Pal {
  skin: Ramp;
  hair: Ramp;
  top: Ramp;
  acc: Ramp;
  bottom: Ramp;
  shoes: Ramp;
  item: Ramp;
  /** Olho: cílio/contorno, íris, pupila e reflexo de baixo. */
  lash: string;
  iris: string;
  pupil: string;
  irisLt: string;
  blush: string;
  lip: string;
  mouth: string;
  mouthOpen: string;
  tongue: string;
  brow: string;
  shaved: string;
  stubble: string;
  darkSkin: boolean;
}

const cache = new Map<Appearance, Pal>();

export function palOf(a: Appearance): Pal {
  let p = cache.get(a);
  if (p) return p;
  const dark = luminance(a.skin) < 0.38;
  const skin = ramp(a.skin, 0.06);
  p = {
    skin,
    hair: ramp(a.hair, 0.085),
    top: ramp(a.top, 0.075),
    acc: ramp(a.topAccent, 0.075),
    bottom: ramp(a.bottom, 0.07),
    shoes: ramp(a.shoes, 0.08),
    item: ramp(a.accessoryColor, 0.09),
    lash: dark ? '#120d16' : '#231b2c',
    iris: mix(a.eyes, '#1d1826', dark ? 0.15 : 0.05),
    pupil: mix(a.eyes, '#0d0a12', 0.7),
    irisLt: mix(a.eyes, '#ffffff', 0.35),
    blush: mix(a.skin, '#ff6f7a', dark ? 0.22 : 0.3),
    lip: mix(shade(a.skin, -0.12), '#c0505a', a.look === 'f' ? 0.4 : 0.12),
    mouth: shade(a.skin, -0.24),
    mouthOpen: '#6e2633',
    tongue: '#d8646e',
    brow: mix(shade(a.hair, -0.08), a.skin, 0.15),
    shaved: mix(a.skin, a.hair, 0.42),
    stubble: mix(a.skin, a.hair, 0.3),
    darkSkin: dark,
  };
  if (cache.size > 4096) cache.clear();
  cache.set(a, p);
  return p;
}
