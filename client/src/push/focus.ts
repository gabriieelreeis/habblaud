// Reports this window's focus to the server so a device reading the office in front of it gets no push.
// The service worker must still show every push it receives: iOS drops the subscription otherwise.

export interface FocusSource {
  readonly visibilityState: string;
  hasFocus(): boolean;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface FocusEvents {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export function windowFocused(doc: Pick<FocusSource, 'visibilityState' | 'hasFocus'>): boolean {
  return doc.visibilityState === 'visible' && doc.hasFocus();
}

let nextTab = 0;

/** The id survives a reload in this tab, so a reload does not leave an old focused window behind. */
function tabId(): string {
  const fresh = () => `tab-${Date.now().toString(36)}-${(nextTab++).toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const saved = sessionStorage.getItem('habblaud-push-tab');
    if (saved) return saved;
    const id = fresh();
    sessionStorage.setItem('habblaud-push-tab', id);
    return id;
  } catch {
    return fresh();
  }
}

export const FOCUS_HEARTBEAT_MS = 15_000;

export class PushFocusReporter {
  readonly tab: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last?: boolean;

  constructor(
    private readonly send: (focused: boolean, tab: string) => void,
    private readonly doc: FocusSource,
    private readonly win: FocusEvents,
    private readonly heartbeatMs = FOCUS_HEARTBEAT_MS,
  ) {
    this.tab = tabId();
  }

  start(): void {
    this.win.addEventListener('focus', this.sync);
    this.win.addEventListener('blur', this.sync);
    this.doc.addEventListener('visibilitychange', this.sync);
    this.win.addEventListener('pagehide', this.hide);
    this.sync();
  }

  stop(): void {
    this.win.removeEventListener('focus', this.sync);
    this.win.removeEventListener('blur', this.sync);
    this.doc.removeEventListener('visibilitychange', this.sync);
    this.win.removeEventListener('pagehide', this.hide);
    this.clearTimer();
    if (this.last) this.send(false, this.tab);
    this.last = undefined;
  }

  private readonly sync = (): void => {
    const focused = windowFocused(this.doc);
    this.last = focused;
    this.send(focused, this.tab);
    if (focused && !this.timer) this.timer = setInterval(this.keepAlive, this.heartbeatMs);
    if (!focused) this.clearTimer();
  };

  private readonly keepAlive = (): void => {
    this.send(true, this.tab);
  };

  private readonly hide = (): void => {
    this.clearTimer();
    if (this.last) this.send(false, this.tab);
    this.last = false;
  };

  private clearTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
