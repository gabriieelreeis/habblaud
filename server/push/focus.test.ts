import { describe, expect, it } from 'vitest';
import { FocusTracker, FOCUS_TABS_MAX, FOCUS_TTL_MS } from './focus';

describe('FocusTracker', () => {
  it('one focused window is enough for the device', () => {
    const t = new FocusTracker();
    expect(t.isFocused('a', 1000)).toBe(false);
    t.set('a', 'tab-1', 1000);
    expect(t.isFocused('a', 1000)).toBe(true);
    expect(t.isFocused('b', 1000)).toBe(false);
  });

  it('unfocusing one window keeps the others', () => {
    const t = new FocusTracker();
    t.set('a', 'tab-1', 1000);
    t.set('a', 'tab-2', 1000);
    t.clear('a', 'tab-1');
    expect(t.isFocused('a', 1000)).toBe(true);
    t.clear('a', 'tab-2');
    expect(t.isFocused('a', 1000)).toBe(false);
    expect(t.size).toBe(0);
  });

  it('a heartbeat refreshes the window', () => {
    const t = new FocusTracker();
    t.set('a', 'tab-1', 1000);
    t.set('a', 'tab-1', 1000 + FOCUS_TTL_MS - 1);
    expect(t.isFocused('a', 1000 + FOCUS_TTL_MS - 1)).toBe(true);
  });

  it('a window that stopped sending heartbeats expires', () => {
    const t = new FocusTracker();
    t.set('a', 'tab-1', 1000);
    expect(t.isFocused('a', 1000 + FOCUS_TTL_MS)).toBe(false);
    expect(t.size).toBe(0);
  });

  it('a clock that went backwards cannot keep a window focused forever', () => {
    const t = new FocusTracker();
    t.set('a', 'tab-1', Number.POSITIVE_INFINITY);
    expect(t.isFocused('a', 1000)).toBe(false);
    t.set('a', 'tab-2', 2000);
    expect(t.isFocused('a', 1000)).toBe(false);
    expect(t.isFocused('a', 2000)).toBe(true);
  });

  it('one endpoint cannot grow an unbounded number of tab ids', () => {
    const t = new FocusTracker();
    for (let i = 0; i < FOCUS_TABS_MAX + 5; i++) t.set('a', `tab-${i}`, 1000 + i);
    expect(t.isFocused('a', 2000)).toBe(true);
    t.clearEndpoint('a');
    expect(t.isFocused('a', 2000)).toBe(false);
  });
});
