import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushFocusReporter, windowFocused } from './focus';

interface FakeDoc {
  visibilityState: string;
  focused: boolean;
  hasFocus(): boolean;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

function fake() {
  const docListeners = new Map<string, (() => void)[]>();
  const winListeners = new Map<string, (() => void)[]>();
  const doc: FakeDoc = {
    visibilityState: 'visible',
    focused: true,
    hasFocus: () => doc.focused,
    addEventListener: (type, fn) => docListeners.set(type, [...(docListeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => docListeners.set(type, (docListeners.get(type) ?? []).filter((f) => f !== fn)),
  };
  const win = {
    addEventListener: (type: string, fn: () => void) => winListeners.set(type, [...(winListeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: () => void) => winListeners.set(type, (winListeners.get(type) ?? []).filter((f) => f !== fn)),
  };
  const fire = (map: Map<string, (() => void)[]>, type: string) => {
    for (const fn of map.get(type) ?? []) fn();
  };
  return { doc, win, fire: { doc: (t: string) => fire(docListeners, t), win: (t: string) => fire(winListeners, t) } };
}

afterEach(() => vi.useRealTimers());

describe('windowFocused', () => {
  it('needs a visible and focused window', () => {
    expect(windowFocused({ visibilityState: 'visible', hasFocus: () => true })).toBe(true);
    expect(windowFocused({ visibilityState: 'visible', hasFocus: () => false })).toBe(false);
    expect(windowFocused({ visibilityState: 'hidden', hasFocus: () => true })).toBe(false);
  });
});

describe('PushFocusReporter', () => {
  it('reports the initial state and heartbeats only while focused', () => {
    vi.useFakeTimers();
    const { doc, win, fire } = fake();
    const sent: boolean[] = [];
    const r = new PushFocusReporter((on) => sent.push(on), doc, win, 1000);
    r.start();
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([true, true, true]);
    doc.focused = false;
    fire.win('blur');
    expect(sent.at(-1)).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([true, true, true, false]);
    doc.focused = true;
    fire.win('focus');
    vi.advanceTimersByTime(1000);
    expect(sent.at(-1)).toBe(true);
    r.stop();
    expect(sent.at(-1)).toBe(false);
  });

  it('hiding the tab unfocuses it and pagehide does not double-report', () => {
    const { doc, win, fire } = fake();
    const sent: boolean[] = [];
    const r = new PushFocusReporter((on) => sent.push(on), doc, win, 1000);
    r.start();
    doc.visibilityState = 'hidden';
    fire.doc('visibilitychange');
    fire.win('pagehide');
    expect(sent).toEqual([true, false]);
    r.stop();
    expect(sent).toEqual([true, false]);
  });

  it('unfocusing one tab does not stop the heartbeat of another', () => {
    const first = fake();
    const second = fake();
    const a: boolean[] = [];
    const b: boolean[] = [];
    const ra = new PushFocusReporter((on) => a.push(on), first.doc, first.win, 1000);
    const rb = new PushFocusReporter((on) => b.push(on), second.doc, second.win, 1000);
    ra.start();
    rb.start();
    expect(ra.tab).not.toBe(rb.tab);
    first.doc.focused = false;
    first.fire.win('blur');
    expect(a.at(-1)).toBe(false);
    expect(b.at(-1)).toBe(true);
    ra.stop();
    rb.stop();
  });
});
