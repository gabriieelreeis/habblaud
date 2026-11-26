import { describe, expect, it } from 'vitest';
import { appearanceFromSeed, costumeFor } from '../index';

describe('chapéu escolhido x fantasia de época', () => {
  it('sem escolha, a fantasia de época vale', () => {
    const a = appearanceFromSeed(42, { look: 'm' });
    expect(costumeFor(a, 'santa')).toBe('santa');
    expect(costumeFor(appearanceFromSeed(42, { look: 'm', parts: { hat: 'none' } }), 'santa')).toBe('santa');
  });

  it('chapéu escolhido no editor fica por cima do gorro de época; a capa continua', () => {
    const a = appearanceFromSeed(42, { look: 'm', parts: { hat: 'top' } });
    expect(costumeFor(a, 'santa')).toBeUndefined();
    expect(costumeFor(a, 'witch')).toBeUndefined();
    expect(costumeFor(a, 'vampire')).toBe('vampire');
    expect(costumeFor(a, undefined)).toBeUndefined();
  });
});
