// Personagem isométrico por peças (puro, sem DOM): folha fixa de SHEET_W x SHEET_H com a âncora no centro dos pés.
// 8 direções de TELA; só 5 são desenhadas (s, sw, w, nw, n) e ne, e, se são o espelho de nw, w, sw — o espelho é feito
// na composição, antes do sombreamento, então a luz continua vindo de cima/esquerda.
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';
import { drawArm, drawHood, drawLeg, drawNeck, drawPelvis, drawShoe, drawSkirt, drawTorso, hoodDepth, put } from './body';
import { extraLayers, glassesLayer, hatLayers } from './gear';
import { hairBack, hairFront, type HairLayer, type Stage } from './hair';
import { drawHead } from './head';
import type { Look } from './look';
import { AX, AY, SHEET_H, SHEET_W, composite } from './paint';
import { POSE_FRAMES, makeRig, makeView, type Ctx, type Pose } from './rig';

export { AX as AVATAR_AX, AY as AVATAR_AY, SHEET_H as AVATAR_H, SHEET_W as AVATAR_W };
export { POSE_FRAMES, type Pose };

export type ScreenDir = 's' | 'sw' | 'w' | 'nw' | 'n' | 'ne' | 'e' | 'se';

export const SCREEN_DIRS: readonly ScreenDir[] = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];

/** Ângulo de giro desenhado e se a direção é o espelho de uma desenhada. */
const DIRS: Record<ScreenDir, { phi: number; mirror: boolean }> = {
  s: { phi: 0, mirror: false },
  sw: { phi: 45, mirror: false },
  w: { phi: 90, mirror: false },
  nw: { phi: 135, mirror: false },
  n: { phi: 180, mirror: false },
  ne: { phi: 135, mirror: true },
  e: { phi: 90, mirror: true },
  se: { phi: 45, mirror: true },
};

export function renderAvatar(look: Look, dir: ScreenDir, pose: Pose, frame: number): BufSprite {
  const d = DIRS[dir];
  const buf = new PixelBuf(SHEET_W, SHEET_H);
  const v = makeView(d.phi);
  const rig = makeRig(pose, frame);
  const c: Ctx = { look, v, rig, buf, mirror: d.mirror };

  const placed: Record<Stage, HairLayer[]> = { behind: [], mid: [], after: [] };
  const add = (list: HairLayer[]) => {
    for (const p of list) placed[p.stage].push(p);
  };
  add(hairBack(c));
  add(hatLayers(c));
  add(extraLayers(c));
  const glasses = glassesLayer(c);
  const front = hairFront(c);
  const flush = (stage: Stage) => {
    for (const p of placed[stage]) composite(buf, p.L, d.mirror);
  };

  // 1) atrás de tudo
  const hoodBehind = look.top === 'hoodie' && hoodDepth(c) < 0;
  if (hoodBehind) drawHood(c);
  flush('behind');

  // 2) braço de trás, pernas (de trás para a frente), quadril, saia, pescoço e tronco
  const armD = (i: 0 | 1) => rig.arms[i].root.l * v.s;
  const far = ([0, 1] as const).filter((i) => armD(i) < -0.3);
  const near = ([0, 1] as const).filter((i) => armD(i) >= -0.3).sort((a, b) => armD(a) - armD(b));
  for (const i of far) drawArm(c, i, false);
  const legs = ([0, 1] as const).slice().sort((a, b) => rig.legs[a].root.l * v.s - rig.legs[b].root.l * v.s);
  for (const i of legs) {
    drawLeg(c, i);
    drawShoe(c, i);
  }
  drawPelvis(c);
  drawSkirt(c);
  drawNeck(c);
  drawTorso(c);
  if (look.top === 'hoodie' && !hoodBehind) drawHood(c);
  flush('mid');

  // 3) braços da frente, cabeça e o que vai por cima dela
  for (const i of near) drawArm(c, i, true);
  drawHead(c);
  if (front) {
    front.inner = true;
    put(c, front);
  }
  flush('after');
  if (glasses) put(c, glasses);

  buf.outline();
  buf.shadow(AX, AY, 6.5, 2.7, '#1c2034', 0.22);
  return { buf, ax: AX, ay: AY };
}
