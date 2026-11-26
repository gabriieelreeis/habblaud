// Personagem por peças: toda direção x pose x quadro gera folha do tamanho certo, o espelho bate, a cor do cabelo mexe
// só no cabelo e os pés ficam na âncora.
import { describe, expect, it } from 'vitest';
import type { PixelBuf } from '../core/pixbuf';
import { BODIES, DEFAULT_LOOK, EXTRAS, GLASSES, HAIRS, HATS, SHOES, SKIN_TONES, TOPS, BOTTOMS, makeLook } from './look';
import { AVATAR_AX, AVATAR_AY, AVATAR_H, AVATAR_W, POSE_FRAMES, SCREEN_DIRS, renderAvatar, type Pose, type ScreenDir } from './render';

const POSES = Object.keys(POSE_FRAMES) as Pose[];

const LOOKS = [
  makeLook(),
  makeLook({ skin: SKIN_TONES[6], body: 'b', hair: 'afro', hat: 'top', glasses: 'shades', top: 'suit', bottom: 'slacks', shoes: 'dress', extra: 'headphones' }),
  makeLook({ skin: SKIN_TONES[0], hair: 'long', hat: 'santa', top: 'dress', shoes: 'boots', extra: 'necklace' }),
  makeLook({ hair: 'mohawk', hat: 'cap', glasses: 'glasses', top: 'hoodie', bottom: 'shorts', extra: 'backpack' }),
];

function alphaRows(b: PixelBuf, flip: boolean): string[] {
  const rows: string[] = [];
  for (let y = 0; y < b.h; y++) {
    let r = '';
    for (let x = 0; x < b.w; x++) r += b.data[(y * b.w + (flip ? b.w - 1 - x : x)) * 4 + 3] > 0 ? '1' : '0';
    rows.push(r);
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

describe('renderAvatar', () => {
  it('gera folha do tamanho certo, com pixels e a âncora dentro, em toda direção, pose e quadro', () => {
    for (const look of LOOKS) {
      for (const dir of SCREEN_DIRS) {
        for (const pose of POSES) {
          for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
            const s = renderAvatar(look, dir, pose, frame);
            expect(s.buf.w).toBe(AVATAR_W);
            expect(s.buf.h).toBe(AVATAR_H);
            expect(s.ax).toBe(AVATAR_AX);
            expect(s.ay).toBe(AVATAR_AY);
            expect(s.buf.countOpaque()).toBeGreaterThan(300);
            const b = s.buf.bounds();
            expect(b).not.toBeNull();
            // nada encosta na borda da folha (cabelo/chapéu cabem)
            expect(b!.x).toBeGreaterThan(0);
            expect(b!.y).toBeGreaterThan(0);
            expect(b!.x + b!.w).toBeLessThan(AVATAR_W);
            expect(b!.y + b!.h).toBeLessThan(AVATAR_H);
          }
        }
      }
    }
  });

  it('é determinístico', () => {
    const a = renderAvatar(LOOKS[1], 'sw', 'walk', 2);
    const b = renderAvatar(LOOKS[1], 'sw', 'walk', 2);
    expect(diff(a.buf, b.buf).size).toBe(0);
  });

  it('ne, e e se são o espelho de nw, w e sw (silhueta idêntica)', () => {
    const pairs: [ScreenDir, ScreenDir][] = [
      ['ne', 'nw'],
      ['e', 'w'],
      ['se', 'sw'],
    ];
    for (const look of LOOKS) {
      for (const [mirrored, drawn] of pairs) {
        for (const pose of POSES) {
          for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
            const m = renderAvatar(look, mirrored, pose, frame);
            const d = renderAvatar(look, drawn, pose, frame);
            expect(alphaRows(m.buf, false)).toEqual(alphaRows(d.buf, true));
          }
        }
      }
    }
  });

  it('o espelho refaz o sombreamento: a luz continua vindo da esquerda', () => {
    // coluna mais clara e mais escura do tronco: no lado espelhado a esquerda continua mais clara
    const lum = (b: PixelBuf, x: number, y: number) => b.data[(y * b.w + x) * 4] * 0.3 + b.data[(y * b.w + x) * 4 + 1] * 0.59 + b.data[(y * b.w + x) * 4 + 2] * 0.11;
    for (const dir of ['w', 'e'] as ScreenDir[]) {
      const s = renderAvatar(makeLook({ hair: 'bald' }), dir, 'stand', 0);
      const y = 22; // altura do rosto
      let left = 0;
      let right = 0;
      for (let x = AVATAR_AX - 7; x < AVATAR_AX; x++) left += lum(s.buf, x, y);
      for (let x = AVATAR_AX; x < AVATAR_AX + 7; x++) right += lum(s.buf, x, y);
      expect(left).toBeGreaterThan(right);
    }
  });

  it('trocar a cor do cabelo muda só pixels de cabelo', () => {
    for (const hair of HAIRS.map((h) => h.id).filter((h) => h !== 'bald')) {
      for (const dir of ['s', 'sw', 'n'] as ScreenDir[]) {
        const a = renderAvatar(makeLook({ hair, hairColor: '#4a3020' }), dir, 'stand', 0);
        const b = renderAvatar(makeLook({ hair, hairColor: '#e0b030' }), dir, 'stand', 0);
        const bald = renderAvatar(makeLook({ hair: 'bald' }), dir, 'stand', 0);
        const changed = diff(a.buf, b.buf);
        const hairPixels = diff(a.buf, bald.buf);
        expect(changed.size).toBeGreaterThan(15);
        for (const i of changed) expect(hairPixels.has(i)).toBe(true);
        // a silhueta não muda com a cor
        expect(alphaRows(a.buf, false)).toEqual(alphaRows(b.buf, false));
      }
    }
  });

  it('trocar a cor da camiseta não mexe na cabeça nem nos pés', () => {
    const a = renderAvatar(makeLook({ topColor: '#3f7fd0' }), 's', 'stand', 0);
    const b = renderAvatar(makeLook({ topColor: '#d04f3f' }), 's', 'stand', 0);
    for (const i of diff(a.buf, b.buf)) {
      const y = Math.floor(i / AVATAR_W);
      expect(y).toBeGreaterThan(30);
      expect(y).toBeLessThan(54);
    }
  });

  it('os pés ficam na âncora (centrados e a poucas linhas dela)', () => {
    for (const dir of SCREEN_DIRS) {
      for (const look of [LOOKS[0], LOOKS[2]]) {
        const s = renderAvatar(look, dir, 'stand', 0);
        // solas: último pixel opaco (a sombra é translúcida e fica de fora)
        let lastY = -1;
        for (let y = 0; y < AVATAR_H; y++) for (let x = 0; x < AVATAR_W; x++) if (s.buf.data[(y * AVATAR_W + x) * 4 + 3] >= 200) lastY = y;
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
    const s = renderAvatar(makeLook({ hair: 'short' }), 's', 'stand', 0);
    const b = s.buf.bounds()!;
    // sem a sombra, que é translúcida
    let top = AVATAR_H;
    for (let y = 0; y < AVATAR_H; y++) for (let x = 0; x < AVATAR_W; x++) if (s.buf.data[(y * AVATAR_W + x) * 4 + 3] >= 200) top = Math.min(top, y);
    const h = s.ay - top;
    expect(h).toBeGreaterThanOrEqual(44);
    expect(h).toBeLessThanOrEqual(52);
    expect(b.w).toBeLessThanOrEqual(26);
  });

  it('a respiração e a caminhada mudam o desenho entre quadros', () => {
    const stand = [0, 1].map((f) => renderAvatar(LOOKS[0], 'w', 'stand', f).buf);
    expect(diff(stand[0], stand[1]).size).toBeGreaterThan(5);
    const walk = [0, 1, 2, 3].map((f) => renderAvatar(LOOKS[0], 'w', 'walk', f).buf);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(diff(walk[i], walk[j]).size).toBeGreaterThan(5);
  });

  it('cada opção de cada peça muda o desenho (catálogo sem opção morta)', () => {
    const base = makeLook({ hair: 'short', top: 'tee', bottom: 'jeans', shoes: 'sneakers' });
    const px = (look: ReturnType<typeof makeLook>) => renderAvatar(look, 's', 'stand', 0).buf;
    const lists: [keyof typeof DEFAULT_LOOK, readonly { id: string }[]][] = [
      ['body', BODIES],
      ['hair', HAIRS],
      ['hat', HATS],
      ['glasses', GLASSES],
      ['top', TOPS],
      ['bottom', BOTTOMS],
      ['shoes', SHOES],
      ['extra', EXTRAS],
    ];
    for (const [key, list] of lists) {
      const seen: PixelBuf[] = [];
      for (const o of list) {
        if (key === 'extra' && o.id === 'earring') continue; // brinco é 2 pixels: coberto abaixo
        const b = px({ ...base, [key]: o.id } as typeof base);
        for (const prev of seen) expect(diff(prev, b).size, `${String(key)}=${o.id}`).toBeGreaterThan(0);
        seen.push(b);
      }
    }
    expect(diff(px(base), px({ ...base, extra: 'earring' })).size).toBeGreaterThan(0);
  });

  it('as listas têm rótulos em PT e os mínimos pedidos', () => {
    expect(SKIN_TONES.length).toBe(8);
    expect(BODIES.length).toBe(2);
    expect(HAIRS.length).toBe(9);
    expect(HATS.length).toBe(6);
    expect(GLASSES.length).toBe(3);
    expect(TOPS.length).toBe(7);
    expect(BOTTOMS.length).toBe(4);
    expect(SHOES.length).toBe(3);
    expect(EXTRAS.length).toBe(5);
    for (const l of [HAIRS, HATS, GLASSES, TOPS, BOTTOMS, SHOES, EXTRAS, BODIES]) for (const o of l) expect(o.label.length).toBeGreaterThan(1);
  });
});
