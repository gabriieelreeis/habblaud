import { describe, expect, it } from 'vitest';
import { ACCESSORIES, BOTTOM_STYLES, HAIR_STYLES, LOOK_BODIES, LOOK_BOTTOMS, LOOK_EXTRAS, LOOK_GLASSES, LOOK_HAIRS, LOOK_HATS, LOOK_SHOES, LOOK_TOPS, TOP_STYLES } from '../../../../shared/appearance';
import { appearanceFromSeed } from '../index';
import { lookFromAppearance, legacyOfLook } from './from-appearance';
import { BODIES, BOTTOMS, EXTRAS, GLASSES, HAIRS, HATS, SHOES, TOPS } from './look';

const ids = (o: readonly { id: string }[]) => o.map((x) => x.id).sort();

describe('visual novo a partir da aparência de sempre', () => {
  it('as listas do servidor são as mesmas da arte', () => {
    expect([...LOOK_BODIES].sort()).toEqual(ids(BODIES));
    expect([...LOOK_HAIRS].sort()).toEqual(ids(HAIRS));
    expect([...LOOK_HATS].sort()).toEqual(ids(HATS));
    expect([...LOOK_GLASSES].sort()).toEqual(ids(GLASSES));
    expect([...LOOK_TOPS].sort()).toEqual(ids(TOPS));
    expect([...LOOK_BOTTOMS].sort()).toEqual(ids(BOTTOMS));
    expect([...LOOK_SHOES].sort()).toEqual(ids(SHOES));
    expect([...LOOK_EXTRAS].sort()).toEqual(ids(EXTRAS));
  });

  it('todo mundo de hoje vira um visual válido, com as mesmas cores e o mesmo tipo de cabelo e roupa', () => {
    for (let seed = 1; seed < 400; seed++)
      for (const look of ['f', 'm'] as const) {
        const a = appearanceFromSeed(seed * 7919, { look, sub: seed % 5 === 0 });
        const l = lookFromAppearance(a);
        expect(LOOK_HAIRS).toContain(l.hair);
        expect(LOOK_TOPS).toContain(l.top);
        expect(LOOK_BOTTOMS).toContain(l.bottom);
        expect(LOOK_HATS).toContain(l.hat);
        expect(l.hair).toBe(a.hairStyle);
        expect([l.skin, l.hairColor, l.topColor, l.bottomColor, l.shoesColor]).toEqual([a.skin, a.hair, a.top, a.bottom, a.shoes]);
        expect(l.lanyard).toBe(a.lanyard);
      }
  });

  it('peça escolhida no editor novo vence a convertida', () => {
    const a = appearanceFromSeed(42, { look: 'm', parts: { cut: 'dreads', hat: 'straw', topCut: 'suit', shoesCut: 'boots' } });
    const l = lookFromAppearance(a);
    expect([l.hair, l.hat, l.top, l.shoes]).toEqual(['dreads', 'straw', 'suit', 'boots']);
  });

  it('para o World, o visual novo vira as peças antigas mais parecidas (sempre valores que ele conhece)', () => {
    for (const hair of LOOK_HAIRS)
      for (const top of LOOK_TOPS)
        for (const bottom of LOOK_BOTTOMS) {
          const o = legacyOfLook({ hair, hat: 'none', glasses: 'none', top, bottom, extra: 'none' });
          expect(HAIR_STYLES).toContain(o.hairStyle);
          expect(TOP_STYLES).toContain(o.topStyle);
          expect(BOTTOM_STYLES).toContain(o.bottomStyle);
        }
    for (const hat of LOOK_HATS) for (const glasses of LOOK_GLASSES) for (const extra of LOOK_EXTRAS) expect(ACCESSORIES).toContain(legacyOfLook({ hair: 'short', hat, glasses, top: 'tee', bottom: 'jeans', extra }).accessory);
  });
});
