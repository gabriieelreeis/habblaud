// Personagens isométricos: toda pose x direção gera sprite, a âncora cabe na folha, o espelho bate com a vista
// desenhada e as alturas seguem a escala do cenário.
import { describe, expect, it } from 'vitest';
import type { Dir, HeldItem, Pose } from '../api';
import { appearanceFromSeed } from '../character/appearance';
import { POSE_FRAMES } from '../character/render';
import type { PixelBuf } from '../core/pixbuf';
import { ISO_CHAR_H, ISO_CHAR_W, renderIsoCharacter } from './render';

const DIRS: Dir[] = ['down', 'right', 'up', 'left'];
const POSES = Object.keys(POSE_FRAMES) as Pose[];
const HELD: HeldItem[] = ['none', 'coffee', 'water', 'papers', 'laptop', 'book', 'box', 'paddle', 'popcorn', 'controller', 'rock', 'paper', 'scissors', 'phone', 'lipstick', 'comb'];

/** Máscara de alfa (1 = opaco) espelhada ou não. */
function alphaRows(b: PixelBuf, flip = false): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.h; y++) {
    let r = '';
    for (let x = 0; x < b.w; x++) {
      const xx = flip ? b.w - 1 - x : x;
      r += b.data[(y * b.w + xx) * 4 + 3] > 0 ? '1' : '0';
    }
    rows.push(r);
  }
  return rows;
}

describe('renderIsoCharacter', () => {
  it('gera sprite não vazio em toda pose, direção e quadro, com a âncora dentro da folha', () => {
    for (let i = 0; i < 4; i++) {
      const a = appearanceFromSeed(31 * i + 7, { look: i % 2 ? 'm' : 'f' });
      for (const pose of POSES) {
        for (const dir of DIRS) {
          for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
            const s = renderIsoCharacter({ appearance: a, dir, pose, frame, held: HELD[(i * 5 + frame) % HELD.length], costume: i === 3 ? 'santa' : undefined });
            expect(s.buf.w).toBe(ISO_CHAR_W);
            expect(s.buf.h).toBe(ISO_CHAR_H);
            expect(s.ax).toBeGreaterThanOrEqual(0);
            expect(s.ax).toBeLessThan(ISO_CHAR_W);
            expect(s.ay).toBeGreaterThanOrEqual(0);
            expect(s.ay).toBeLessThan(ISO_CHAR_H);
            expect(s.buf.countOpaque()).toBeGreaterThan(150);
          }
        }
      }
    }
  });

  it('é determinístico', () => {
    const a = appearanceFromSeed(5);
    const x = renderIsoCharacter({ appearance: a, dir: 'down', pose: 'walk', frame: 1 });
    const y = renderIsoCharacter({ appearance: a, dir: 'down', pose: 'walk', frame: 1 });
    expect(Array.from(x.buf.data)).toEqual(Array.from(y.buf.data));
  });

  it("'right' e 'left' são o espelho de 'down' e 'up' (silhueta), com a luz recalculada", () => {
    for (let i = 0; i < 6; i++) {
      const a = appearanceFromSeed(100 + i);
      for (const [pose, frame] of [['stand', 0], ['walk', 0], ['run', 2], ['sit', 0], ['type', 1], ['raise_hand', 0], ['cheer', 1]] as const) {
        const down = renderIsoCharacter({ appearance: a, dir: 'down', pose, frame });
        const right = renderIsoCharacter({ appearance: a, dir: 'right', pose, frame });
        const up = renderIsoCharacter({ appearance: a, dir: 'up', pose, frame });
        const left = renderIsoCharacter({ appearance: a, dir: 'left', pose, frame });
        expect(alphaRows(right.buf)).toEqual(alphaRows(down.buf, true));
        expect(alphaRows(left.buf)).toEqual(alphaRows(up.buf, true));
        expect(right.ax).toBe(ISO_CHAR_W - down.ax);
      }
    }
  });

  it('em pé mede ~40 px e sentado fica mais baixo', () => {
    for (let i = 0; i < 10; i++) {
      const a = { ...appearanceFromSeed(200 + i), hairStyle: 'short' as const, accessory: 'none' as const };
      const stand = renderIsoCharacter({ appearance: a, dir: 'down', pose: 'stand', frame: 0 });
      const sit = renderIsoCharacter({ appearance: a, dir: 'down', pose: 'sit', frame: 0 });
      const top = stand.buf.bounds()!.y;
      const height = stand.ay - top;
      expect(height).toBeGreaterThanOrEqual(38);
      expect(height).toBeLessThanOrEqual(44);
      expect(sit.buf.bounds()!.y).toBeGreaterThan(top + 4);
    }
  });
});
