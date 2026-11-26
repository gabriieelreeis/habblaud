import { describe, expect, it } from 'vitest';
import { LOOK_BOTTOMS, LOOK_HATS, LOOK_TOPS, PART_KEYS, parseAgentParts } from '../../../shared/appearance';
import { appearanceFromSeed } from '../art';
import { lookFromAppearance } from '../art/avatar/from-appearance';
import { SKIN_TONES } from '../art/avatar/look';
import { LOOK_TABS, applyLook, editedParts, optionLabel, paletteFor, randomLook, rowShown, styleOptions, valueOf } from './look-model';

/** Gerador determinístico para os sorteios dos testes. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const base = (seed = 11, look: 'f' | 'm' = 'm') => appearanceFromSeed(seed, { look });

describe('abas do editor de visual', () => {
  it('as oito abas, na ordem pedida, e todo estilo tem rótulo', () => {
    expect(LOOK_TABS.map((t) => t.id)).toEqual(['body', 'hair', 'hat', 'glasses', 'top', 'bottom', 'shoes', 'extra']);
    for (const t of LOOK_TABS)
      for (const r of t.rows)
        if (r.kind === 'style') {
          const opts = styleOptions(r.key);
          expect(opts.length, r.key).toBeGreaterThan(1);
          for (const o of opts) expect(optionLabel(r.key, o.id), `${r.key}:${o.id}`).not.toBe(o.id);
        }
  });

  it('a paleta sempre tem a cor atual, mesmo a de fora da paleta', () => {
    const a = base();
    expect(paletteFor('skin', a)).toEqual(expect.arrayContaining([...SKIN_TONES]));
    for (const t of LOOK_TABS)
      for (const r of t.rows) if (r.kind === 'color') expect(paletteFor(r.key, a)).toContain(valueOf(a, r.key));
    const odd = applyLook(a, 'top', '#123456');
    expect(paletteFor('top', odd)).toContain('#123456');
    expect(paletteFor('top', odd).length).toBeGreaterThan(10);
  });

  it('esconde o que não se aplica', () => {
    const rows = LOOK_TABS.flatMap((t) => t.rows);
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(rowShown(row('hatColor'), applyLook(base(), 'hat', 'none'))).toBe(false);
    expect(rowShown(row('hatColor'), applyLook(base(), 'hat', 'cap'))).toBe(true);
    expect(rowShown(row('bottomCut'), applyLook(base(), 'topCut', 'dress'))).toBe(false);
    expect(rowShown(row('topAccent'), applyLook(base(), 'topCut', 'tank'))).toBe(false);
  });
});

describe('applyLook', () => {
  it('não altera a aparência original', () => {
    const a = base();
    const before = JSON.stringify(a);
    const b = applyLook(a, 'topCut', 'dress');
    expect(JSON.stringify(a)).toBe(before);
    expect(b).not.toBe(a);
  });

  it('peça nova vai em pieces e ajusta a peça de sempre mais parecida', () => {
    const a = base();
    const b = applyLook(a, 'cut', 'braids');
    expect(b.pieces?.cut).toBe('braids');
    expect(b.hairStyle).toBe('long');
    const c = applyLook(b, 'topCut', 'suit');
    expect(c.topStyle).toBe('shirt_tie');
    expect(applyLook(c, 'bottomCut', 'long_skirt').bottomStyle).toBe('skirt');
    expect(applyLook(a, 'hat', 'cap').accessory).toBe('cap');
    expect(applyLook(applyLook(a, 'hat', 'none'), 'glasses', 'shades').accessory).toBe('sunglasses');
  });

  it('cores e barba vão nos campos de sempre', () => {
    const a = base();
    expect(applyLook(a, 'skin', '#112233').skin).toBe('#112233');
    expect(applyLook(a, 'hair', '#112233').hair).toBe('#112233');
    expect(applyLook(a, 'top', '#112233').top).toBe('#112233');
    expect(applyLook(a, 'topAccent', '#112233').topAccent).toBe('#112233');
    expect(applyLook(a, 'bottom', '#112233').bottom).toBe('#112233');
    expect(applyLook(a, 'shoes', '#112233').shoes).toBe('#112233');
    expect(applyLook(a, 'facialHair', 'goatee').facialHair).toBe('goatee');
    expect(lookFromAppearance(applyLook(a, 'hair', '#112233')).hairColor).toBe('#112233');
    const hat = applyLook(applyLook(a, 'hat', 'beanie'), 'hatColor', '#445566');
    expect(hat.pieces?.hatColor).toBe('#445566');
    expect(hat.accessoryColor).toBe('#445566');
    expect(applyLook(a, 'extraColor', '#445566').pieces?.extraColor).toBe('#445566');
  });

  it('trocar o corte não perde chapéu, óculos e acessório que já vinham do acessório de sempre', () => {
    for (let seed = 1; seed < 300; seed++) {
      const a = appearanceFromSeed(seed * 31);
      const was = lookFromAppearance(a);
      const b = lookFromAppearance(applyLook(a, 'cut', 'quiff'));
      expect(b.hat).toBe(was.hat);
      expect(b.glasses).toBe(was.glasses);
      expect(b.extra).toBe(was.extra);
      expect(b.hair).toBe('quiff');
    }
  });
});

describe('randomLook', () => {
  it('sorteia peças válidas, sem vestido com parte de baixo escolhida e com sapato social no terno', () => {
    for (let i = 0; i < 300; i++) {
      const a = randomLook(base(i + 1, i % 2 ? 'f' : 'm'), rng(i + 1));
      const l = lookFromAppearance(a);
      expect(LOOK_TOPS).toContain(l.top);
      expect(LOOK_BOTTOMS).toContain(l.bottom);
      expect(LOOK_HATS).toContain(l.hat);
      if (l.top === 'dress') expect(l.bottom).toBe('jeans');
      if (l.top === 'suit' || l.top === 'shirt_tie') expect(l.shoes).toBe('dress');
      if (a.look === 'f') expect(l.beard).toBe('none');
      if (['afro', 'bun', 'mohawk', 'pigtails', 'space_buns'].includes(l.hair)) expect(['cap', 'cap_back', 'beanie']).not.toContain(l.hat);
    }
  });

  it('é determinístico com o mesmo gerador e varia com outro', () => {
    const a = base();
    expect(JSON.stringify(randomLook(a, rng(5)))).toBe(JSON.stringify(randomLook(a, rng(5))));
    const seen = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(lookFromAppearance(randomLook(a, rng(i + 1))))));
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe('editedParts (salvar e reabrir dá o mesmo visual)', () => {
  const reopen = (seed: number, look: 'f' | 'm', a: ReturnType<typeof base>, sub = false) => {
    const parts = editedParts(appearanceFromSeed(seed, { look, sub }), a);
    expect(parseAgentParts(parts), 'o servidor aceita').not.toBeNull();
    return { parts, back: appearanceFromSeed(seed, { look, sub, parts }) };
  };

  it('sem mudança, nada vai ao servidor', () => {
    const a = base();
    expect(editedParts(a, { ...a })).toEqual({});
  });

  it('o que não mudou nas peças novas não vai em parts', () => {
    const a = base();
    expect(editedParts(a, applyLook(a, 'skin', '#112233'))).toEqual({ skin: '#112233' });
  });

  it('ida e volta depois de qualquer escolha, em muitas aparências', () => {
    const fields = LOOK_TABS.flatMap((t) => t.rows);
    for (let seed = 1; seed < 150; seed++) {
      const look = seed % 2 ? 'f' : 'm';
      const b = appearanceFromSeed(seed * 7919, { look, sub: seed % 7 === 0 });
      for (const row of fields) {
        const values = row.kind === 'style' ? styleOptions(row.key).map((o) => o.id) : ['#112233'];
        for (const v of values) {
          const edited = applyLook(b, row.key, v);
          const { back } = reopen(seed * 7919, look, edited, seed % 7 === 0);
          const want = JSON.stringify(lookFromAppearance(edited));
          expect(JSON.stringify(lookFromAppearance(back)), `${seed} ${row.key}=${v}`).toBe(want);
          for (const k of PART_KEYS) expect(back[k], `${seed} ${row.key}=${v} ${k}`).toBe(edited[k]);
        }
      }
    }
  });

  it('ida e volta depois de sorteios completos', () => {
    for (let i = 1; i < 200; i++) {
      const look = i % 2 ? 'f' : 'm';
      const seed = i * 104729;
      const edited = randomLook(appearanceFromSeed(seed, { look }), rng(i));
      const { back } = reopen(seed, look, edited);
      expect(JSON.stringify(lookFromAppearance(back))).toBe(JSON.stringify(lookFromAppearance(edited)));
    }
  });

  it('segunda edição em cima da primeira salva também volta igual', () => {
    const seed = 777;
    const b = appearanceFromSeed(seed, { look: 'f' });
    const first = reopen(seed, 'f', applyLook(applyLook(b, 'hat', 'straw'), 'glasses', 'round'));
    const { back } = reopen(seed, 'f', applyLook(first.back, 'topCut', 'tank'));
    const l = lookFromAppearance(back);
    expect(l.hat).toBe('straw');
    expect(l.glasses).toBe('round');
    expect(l.top).toBe('tank');
  });
});
