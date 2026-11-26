import { describe, expect, it } from 'vitest';
import { appearanceFromSeed } from './character/appearance';
import { lookFromAppearance } from './avatar/from-appearance';
import { renderAvatar } from './avatar/render';
import { PixelBuf } from './core/pixbuf';
import { opaqueRect } from './index';

describe('retângulo visível medido no buffer', () => {
  it('pega só os pixels com alfa acima de 16', () => {
    const b = new PixelBuf(10, 8);
    const put = (x: number, y: number, a: number) => (b.data[(y * 10 + x) * 4 + 3] = a);
    put(2, 3, 255);
    put(7, 5, 17);
    put(9, 7, 16);
    expect(opaqueRect(b)).toEqual({ x: 2, y: 3, w: 6, h: 3 });
  });

  it('vazio: o sprite inteiro', () => {
    expect(opaqueRect(new PixelBuf(4, 6))).toEqual({ x: 0, y: 0, w: 4, h: 6 });
  });

  it('personagem: a cabeça fica no alto do retângulo e os pés no fim, perto da âncora', () => {
    const s = renderAvatar(lookFromAppearance(appearanceFromSeed(42, { look: 'm' })), 'sw', { pose: 'stand', frame: 0 });
    const r = opaqueRect(s.buf);
    expect(r.y).toBeLessThan(12);
    expect(Math.abs(r.y + r.h - 1 - s.ay)).toBeLessThanOrEqual(3);
    expect(r.w).toBeLessThanOrEqual(s.buf.w);
  });
});
