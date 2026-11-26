import { describe, expect, it } from 'vitest';
import { ViewTracker, viewOfMotion } from './facing-view';

describe('direção na tela', () => {
  it('andando nos eixos do mundo, olha na diagonal da tela; na diagonal do mundo, reto', () => {
    expect(viewOfMotion(0, 1)).toBe('sw');
    expect(viewOfMotion(1, 0)).toBe('se');
    expect(viewOfMotion(0, -1)).toBe('ne');
    expect(viewOfMotion(-1, 0)).toBe('nw');
    expect(viewOfMotion(1, 1)).toBe('s');
    expect(viewOfMotion(-1, -1)).toBe('n');
    expect(viewOfMotion(1, -1)).toBe('e');
    expect(viewOfMotion(-1, 1)).toBe('w');
    expect(viewOfMotion(0.01, 0)).toBeNull();
  });

  it('parado, a direção do mundo; ao virar 90°, um instante na direção do meio', () => {
    const t = new ViewTracker();
    expect(t.view('a', 0, 0, 'down', false, 0)).toBe('sw');
    expect(t.view('a', 0, 0, 'right', false, 10)).toBe('s');
    expect(t.view('a', 0, 0, 'right', false, 200)).toBe('se');
    // meia-volta (180°): passa por um lado
    expect(['e', 'n', 'ne', 'w', 's']).toContain(t.view('a', 0, 0, 'left', false, 300));
    expect(t.view('a', 0, 0, 'left', false, 500)).toBe('nw');
  });

  it('andando, segue o movimento', () => {
    const t = new ViewTracker();
    t.view('a', 0, 0, 'down', true, 0);
    expect(t.view('a', 2, 2, 'down', true, 1000)).toBe('s');
    t.keep(new Set());
    expect(t.view('a', 2, 2, 'up', false, 2000)).toBe('ne');
  });
});
