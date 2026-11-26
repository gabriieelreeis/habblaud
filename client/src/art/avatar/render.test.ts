// Personagem por peças: toda direção x pose x quadro x sentado gera folha do tamanho certo, o espelho bate, a cor do
// cabelo mexe só no cabelo, itens e fantasias mudam o desenho, sentado de costas não desenha as pernas.
import { describe, expect, it } from 'vitest';
import type { HeldItem } from '../api';
import type { PixelBuf } from '../core/pixbuf';
import { BEARDS, BODIES, BOTTOMS, DEFAULT_LOOK, EXTRAS, GLASSES, HAIRS, HATS, SHOES, SKIN_TONES, TOPS, makeLook, type Look } from './look';
import {
  AVATAR_AX,
  AVATAR_AY,
  AVATAR_H,
  AVATAR_SEAT_HIP_Z,
  AVATAR_W,
  POSE_FRAMES,
  SCREEN_DIRS,
  avatarFrames,
  isAvatarSeated,
  renderAvatar,
  type Pose,
  type ScreenDir,
} from './render';

const POSES = Object.keys(POSE_FRAMES) as Pose[];
const DRAWN: ScreenDir[] = ['s', 'sw', 'w', 'nw', 'n'];

const LOOKS = [
  makeLook(),
  makeLook({ skin: SKIN_TONES[6], body: 'b', hair: 'afro', hat: 'top', glasses: 'shades', top: 'suit', bottom: 'slacks', shoes: 'dress', extra: 'headphones', beard: 'beard' }),
  makeLook({ skin: SKIN_TONES[0], hair: 'long', hat: 'bow', top: 'dress', shoes: 'boots', extra: 'necklace', lanyard: '#e0a030' }),
  makeLook({ hair: 'mohawk', hat: 'cap', glasses: 'round', top: 'hoodie', bottom: 'shorts', extra: 'backpack', shoes: 'sandals' }),
];

const r = (look: Look, dir: ScreenDir, pose: Pose, frame = 0, extra: { held?: HeldItem; seated?: boolean; costume?: 'santa' | 'witch' | 'pumpkin' | 'vampire' } = {}) => renderAvatar(look, dir, { pose, frame, ...extra });

function alphaRows(b: PixelBuf, flip: boolean): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.h; y++) {
    let row = '';
    for (let x = 0; x < b.w; x++) row += b.data[(y * b.w + (flip ? b.w - 1 - x : x)) * 4 + 3] > 0 ? '1' : '0';
    rows.push(row);
  }
  return rows;
}

function diff(a: PixelBuf, b: PixelBuf): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) out.add(i / 4);
  }
  return out;
}

/** Última linha com pixel quase opaco (a sombra é translúcida e fica de fora). */
function lastOpaqueRow(b: PixelBuf): number {
  let last = -1;
  for (let y = 0; y < AVATAR_H; y++) for (let x = 0; x < AVATAR_W; x++) if (b.data[(y * AVATAR_W + x) * 4 + 3] >= 200) last = y;
  return last;
}

describe('poses e quadros', () => {
  it('os quadros e a regra de sentado são os do jogo', () => {
    expect(POSES.length).toBe(20);
    expect(avatarFrames('walk')).toBe(4);
    expect(avatarFrames('type')).toBe(4);
    expect(avatarFrames('stand')).toBe(2);
    for (const p of ['sit', 'type', 'sleep', 'wait'] as Pose[]) expect(isAvatarSeated(p, false)).toBe(true);
    for (const p of ['walk', 'run', 'stretch', 'play', 'groom'] as Pose[]) expect(isAvatarSeated(p, true)).toBe(false);
    expect(isAvatarSeated('talk', true)).toBe(true);
    expect(isAvatarSeated('talk', false)).toBe(false);
    expect(AVATAR_SEAT_HIP_Z).toBeGreaterThan(3);
    expect(AVATAR_SEAT_HIP_Z).toBeLessThan(12);
  });

  it('gera folha do tamanho certo, com pixels e a âncora dentro, em toda direção, pose, quadro e sentado', () => {
    for (const look of LOOKS) {
      for (const dir of SCREEN_DIRS) {
        for (const pose of POSES) {
          for (const seated of [false, true]) {
            for (let frame = 0; frame < avatarFrames(pose); frame++) {
              const s = r(look, dir, pose, frame, { seated });
              expect(s.buf.w).toBe(AVATAR_W);
              expect(s.buf.h).toBe(AVATAR_H);
              expect(s.ax).toBe(AVATAR_AX);
              expect(s.ay).toBe(AVATAR_AY);
              expect(s.buf.countOpaque()).toBeGreaterThan(250);
              const b = s.buf.bounds();
              expect(b, `${pose} ${dir} f${frame}`).not.toBeNull();
              // nada encosta na borda da folha (cabelo, chapéu e braços para o alto cabem)
              expect(b!.x).toBeGreaterThan(0);
              expect(b!.y).toBeGreaterThan(0);
              expect(b!.x + b!.w).toBeLessThan(AVATAR_W);
              expect(b!.y + b!.h).toBeLessThan(AVATAR_H);
            }
          }
        }
      }
    }
  }, 120000);

  it('o quadro dá a volta e é determinístico', () => {
    const a = r(LOOKS[1], 'sw', 'walk', 2);
    const b = r(LOOKS[1], 'sw', 'walk', 2);
    const c = r(LOOKS[1], 'sw', 'walk', 6);
    expect(diff(a.buf, b.buf).size).toBe(0);
    expect(diff(a.buf, c.buf).size).toBe(0);
  });

  it('cada pose difere da parada e os quadros de cada pose diferem entre si', () => {
    const stand = r(LOOKS[0], 'sw', 'stand', 0).buf;
    for (const pose of POSES) {
      if (pose === 'stand') continue;
      const frames = Array.from({ length: avatarFrames(pose) }, (_v, f) => r(LOOKS[0], 'sw', pose, f).buf);
      expect(diff(stand, frames[0]).size, pose).toBeGreaterThan(8);
      for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) expect(diff(frames[i], frames[j]).size, `${pose} ${i}x${j}`).toBeGreaterThan(2);
    }
  });

  it('sentado muda o desenho em toda pose que admite', () => {
    for (const pose of POSES) {
      if (!isAvatarSeated(pose, true) || isAvatarSeated(pose, false)) continue;
      expect(diff(r(LOOKS[0], 'sw', pose, 0, { seated: false }).buf, r(LOOKS[0], 'sw', pose, 0, { seated: true }).buf).size, pose).toBeGreaterThan(30);
    }
  });

  it('sentado de costas (n, nw, ne) não desenha as pernas nem os sapatos; de frente desenha', () => {
    const a = makeLook({ shoesColor: '#e8e8ee', shoes: 'sneakers' });
    const b = makeLook({ shoesColor: '#d02020', shoes: 'boots', bottomColor: '#35466e' });
    for (const dir of ['n', 'nw', 'ne'] as ScreenDir[]) {
      for (const pose of ['sit', 'type', 'wait'] as Pose[]) {
        const sa = r(a, dir, pose, 0);
        const sb = r(b, dir, pose, 0);
        // sapatos e botas não aparecem: nenhum pixel abaixo da linha do assento
        expect(diff(sa.buf, sb.buf).size, `${dir} ${pose}`).toBe(0);
        expect(lastOpaqueRow(sa.buf)).toBeLessThanOrEqual(AVATAR_AY - AVATAR_SEAT_HIP_Z + 1);
      }
    }
    for (const dir of ['s', 'sw', 'se'] as ScreenDir[]) {
      const sa = r(a, dir, 'sit', 0);
      expect(lastOpaqueRow(sa.buf)).toBeGreaterThanOrEqual(AVATAR_AY - 2);
      expect(diff(sa.buf, r(b, dir, 'sit', 0).buf).size).toBeGreaterThan(5);
    }
  });

  it('ne, e e se são o espelho de nw, w e sw (silhueta idêntica) em todas as poses, em pé e sentado', () => {
    const pairs: [ScreenDir, ScreenDir][] = [
      ['ne', 'nw'],
      ['e', 'w'],
      ['se', 'sw'],
    ];
    for (const look of LOOKS.slice(0, 2)) {
      for (const [mirrored, drawn] of pairs) {
        for (const pose of POSES) {
          for (const seated of [false, true]) {
            for (let frame = 0; frame < avatarFrames(pose); frame++) {
              const m = r(look, mirrored, pose, frame, { seated, held: 'coffee' });
              const d = r(look, drawn, pose, frame, { seated, held: 'coffee' });
              expect(alphaRows(m.buf, false)).toEqual(alphaRows(d.buf, true));
            }
          }
        }
      }
    }
  });

  it('o espelho refaz o sombreamento: a luz continua vindo da esquerda', () => {
    const lum = (b: PixelBuf, x: number, y: number) => b.data[(y * b.w + x) * 4] * 0.3 + b.data[(y * b.w + x) * 4 + 1] * 0.59 + b.data[(y * b.w + x) * 4 + 2] * 0.11;
    for (const dir of ['w', 'e'] as ScreenDir[]) {
      const s = r(makeLook({ hair: 'bald' }), dir, 'stand', 0);
      const y = 20; // altura da testa
      let left = 0;
      let right = 0;
      for (let x = AVATAR_AX - 7; x < AVATAR_AX; x++) left += lum(s.buf, x, y);
      for (let x = AVATAR_AX; x < AVATAR_AX + 7; x++) right += lum(s.buf, x, y);
      expect(left).toBeGreaterThan(right);
    }
  });
});

describe('itens e fantasias', () => {
  const ITEM_POSES: [HeldItem, Pose][] = [
    ['coffee', 'stand'], ['water', 'stand'], ['papers', 'stand'], ['laptop', 'stand'], ['book', 'read'], ['box', 'stand'], ['paddle', 'play'], ['popcorn', 'wait'],
    ['controller', 'game'], ['rock', 'rps'], ['paper', 'rps'], ['scissors', 'rps'], ['phone', 'read'], ['lipstick', 'groom'], ['comb', 'groom'],
  ];

  it('todo item muda o desenho na pose própria (de frente e de lado); o segurado ao lado do corpo também de costas', () => {
    expect(ITEM_POSES.length).toBe(15);
    const FRONT: ScreenDir[] = ['s', 'sw', 'w', 'e', 'se'];
    for (const item of ['coffee', 'water', 'box'] as HeldItem[]) {
      for (const dir of SCREEN_DIRS) {
        const a = r(LOOKS[0], dir, 'stand', 0);
        const b = r(LOOKS[0], dir, 'stand', 0, { held: item });
        expect(diff(a.buf, b.buf).size, `${item} stand ${dir}`).toBeGreaterThan(0);
      }
    }
    for (const [item, pose] of ITEM_POSES) {
      for (const dir of FRONT) {
        const a = r(LOOKS[0], dir, pose, 0);
        const b = r(LOOKS[0], dir, pose, 0, { held: item });
        expect(diff(a.buf, b.buf).size, `${item} ${pose} ${dir}`).toBeGreaterThan(0);
      }
    }
  });

  it('itens diferentes desenham coisas diferentes na mesma pose', () => {
    const outs = (['coffee', 'water', 'phone', 'lipstick', 'comb'] as HeldItem[]).map((h) => r(LOOKS[0], 'sw', 'stand', 0, { held: h }).buf);
    for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) expect(diff(outs[i], outs[j]).size).toBeGreaterThan(0);
    const gestures = (['rock', 'paper', 'scissors'] as HeldItem[]).map((h) => r(LOOKS[0], 'sw', 'rps', 0, { held: h }).buf);
    expect(diff(gestures[0], gestures[1]).size).toBeGreaterThan(0);
    expect(diff(gestures[1], gestures[2]).size).toBeGreaterThan(0);
  });

  it('toda fantasia muda o desenho nas direções desenhadas', () => {
    for (const costume of ['santa', 'witch', 'pumpkin', 'vampire'] as const) {
      for (const dir of DRAWN) {
        const a = r(LOOKS[0], dir, 'stand', 0);
        const b = r(LOOKS[0], dir, 'stand', 0, { costume });
        expect(diff(a.buf, b.buf).size, `${costume} ${dir}`).toBeGreaterThan(20);
      }
    }
  });

  it('o crachá aparece nas 8 direções e a cor de destaque mexe só na gravata', () => {
    for (const dir of SCREEN_DIRS) {
      expect(diff(r(makeLook(), dir, 'stand', 0).buf, r(makeLook({ lanyard: '#e0a030' }), dir, 'stand', 0).buf).size, dir).toBeGreaterThan(4);
    }
    const a = r(makeLook({ top: 'shirt_tie', accent: '#b8334a' }), 's', 'stand', 0);
    const b = r(makeLook({ top: 'shirt_tie', accent: '#2a8a4a' }), 's', 'stand', 0);
    expect(diff(a.buf, b.buf).size).toBeGreaterThan(3);
    for (const i of diff(a.buf, b.buf)) {
      const y = Math.floor(i / AVATAR_W);
      expect(y).toBeGreaterThan(30);
      expect(y).toBeLessThan(48);
    }
  });
});

describe('catálogo', () => {
  it('trocar a cor do cabelo muda só pixels de cabelo', () => {
    for (const hair of HAIRS.map((h) => h.id).filter((h) => h !== 'bald')) {
      for (const dir of ['s', 'sw', 'n'] as ScreenDir[]) {
        const a = r(makeLook({ hair, hairColor: '#4a3020' }), dir, 'stand', 0);
        const b = r(makeLook({ hair, hairColor: '#e0b030' }), dir, 'stand', 0);
        const bald = r(makeLook({ hair: 'bald' }), dir, 'stand', 0);
        const changed = diff(a.buf, b.buf);
        const hairPixels = diff(a.buf, bald.buf);
        expect(changed.size, `${hair} ${dir}`).toBeGreaterThan(8);
        for (const i of changed) expect(hairPixels.has(i)).toBe(true);
        // a silhueta não muda com a cor
        expect(alphaRows(a.buf, false)).toEqual(alphaRows(b.buf, false));
      }
    }
  });

  it('trocar a cor da camiseta não mexe na cabeça nem nos pés', () => {
    const a = r(makeLook({ topColor: '#3f7fd0' }), 's', 'stand', 0);
    const b = r(makeLook({ topColor: '#d04f3f' }), 's', 'stand', 0);
    for (const i of diff(a.buf, b.buf)) {
      const y = Math.floor(i / AVATAR_W);
      expect(y).toBeGreaterThan(30);
      expect(y).toBeLessThan(54);
    }
  });

  it('os pés ficam na âncora (centrados e a poucas linhas dela)', () => {
    for (const dir of SCREEN_DIRS) {
      for (const look of [LOOKS[0], LOOKS[2]]) {
        const s = r(look, dir, 'stand', 0);
        const lastY = lastOpaqueRow(s.buf);
        expect(Math.abs(lastY - s.ay)).toBeLessThanOrEqual(2);
        let sum = 0;
        let n = 0;
        for (let y = lastY - 3; y <= lastY; y++) {
          for (let x = 0; x < AVATAR_W; x++) {
            if (s.buf.data[(y * AVATAR_W + x) * 4 + 3] >= 200) {
              sum += x + 0.5;
              n++;
            }
          }
        }
        expect(Math.abs(sum / n - s.ax)).toBeLessThanOrEqual(2.5);
      }
    }
  });

  it('a altura em pé fica perto de 50 px (cabeça ~1/3)', () => {
    const s = r(makeLook({ hair: 'short' }), 's', 'stand', 0);
    const b = s.buf.bounds()!;
    let top = AVATAR_H;
    for (let y = 0; y < AVATAR_H; y++) for (let x = 0; x < AVATAR_W; x++) if (s.buf.data[(y * AVATAR_W + x) * 4 + 3] >= 200) top = Math.min(top, y);
    const h = s.ay - top;
    expect(h).toBeGreaterThanOrEqual(44);
    expect(h).toBeLessThanOrEqual(52);
    expect(b.w).toBeLessThanOrEqual(26);
  });

  it('a respiração e a caminhada mudam o desenho entre quadros', () => {
    const stand = [0, 1].map((f) => r(LOOKS[0], 'w', 'stand', f).buf);
    expect(diff(stand[0], stand[1]).size).toBeGreaterThan(5);
    const walk = [0, 1, 2, 3].map((f) => r(LOOKS[0], 'w', 'walk', f).buf);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(diff(walk[i], walk[j]).size).toBeGreaterThan(5);
  });

  it('cada opção de cada peça muda o desenho (catálogo sem opção morta)', () => {
    const base = makeLook({ hair: 'short', top: 'tee', bottom: 'jeans', shoes: 'sneakers', beard: 'none' });
    const lists: [keyof Look, readonly { id: string }[]][] = [
      ['body', BODIES],
      ['hair', HAIRS],
      ['hat', HATS],
      ['glasses', GLASSES],
      ['top', TOPS],
      ['bottom', BOTTOMS],
      ['shoes', SHOES],
      ['extra', EXTRAS],
      ['beard', BEARDS],
    ];
    for (const dir of ['s', 'sw'] as ScreenDir[]) {
      const px = (look: Look) => r(look, dir, 'stand', 0).buf;
      for (const [key, list] of lists) {
        const seen: PixelBuf[] = [];
        for (const o of list) {
          if (key === 'extra' && o.id === 'earring') continue; // brinco é 2 pixels: coberto abaixo
          const b = px({ ...base, [key]: o.id } as Look);
          for (const prev of seen) expect(diff(prev, b).size, `${String(key)}=${o.id} ${dir}`).toBeGreaterThan(0);
          seen.push(b);
        }
      }
      expect(diff(px(base), px({ ...base, extra: 'earring' })).size).toBeGreaterThan(0);
    }
  });

  it('as listas têm rótulos em PT e os mínimos pedidos', () => {
    expect(SKIN_TONES.length).toBe(8);
    expect(BODIES.length).toBe(2);
    expect(HAIRS.length).toBeGreaterThanOrEqual(21);
    for (const id of ['spiky', 'side_part', 'wavy', 'bob', 'pigtails', 'bald']) expect(HAIRS.some((h) => h.id === id)).toBe(true);
    expect(HATS.map((h) => h.id)).toEqual(['none', 'cap', 'cap_back', 'beanie', 'bucket', 'top', 'straw', 'bow']);
    expect(GLASSES.length).toBe(4);
    expect(TOPS.length).toBe(10);
    for (const id of ['shirt_tie', 'sweater', 'blouse']) expect(TOPS.some((t) => t.id === id)).toBe(true);
    expect(BOTTOMS.length).toBe(5);
    expect(SHOES.length).toBe(4);
    expect(EXTRAS.length).toBe(6);
    expect(BEARDS.length).toBe(5);
    expect(DEFAULT_LOOK.beard).toBe('none');
    expect(DEFAULT_LOOK.lanyard).toBeNull();
    for (const l of [HAIRS, HATS, GLASSES, TOPS, BOTTOMS, SHOES, EXTRAS, BODIES, BEARDS]) for (const o of l) expect(o.label.length).toBeGreaterThan(1);
  });
});
