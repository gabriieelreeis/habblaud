// Focused windows per subscription, in memory only. A device with a focused window gets no push: the notice is
// already on screen. A window that closes without unfocusing expires by TTL instead of silencing the device.

export const FOCUS_TTL_MS = 45_000;
export const FOCUS_TABS_MAX = 8;
export const TAB_ID_MAX = 64;

export class FocusTracker {
  private readonly byEndpoint = new Map<string, Map<string, number>>();

  set(endpoint: string, tab: string, at: number): void {
    const tabs = this.byEndpoint.get(endpoint) ?? new Map<string, number>();
    tabs.set(tab, at);
    while (tabs.size > FOCUS_TABS_MAX) tabs.delete(tabs.keys().next().value!);
    this.byEndpoint.set(endpoint, tabs);
  }

  clear(endpoint: string, tab: string): void {
    const tabs = this.byEndpoint.get(endpoint);
    if (!tabs) return;
    tabs.delete(tab);
    if (!tabs.size) this.byEndpoint.delete(endpoint);
  }

  clearEndpoint(endpoint: string): void {
    this.byEndpoint.delete(endpoint);
  }

  isFocused(endpoint: string, at: number): boolean {
    const tabs = this.byEndpoint.get(endpoint);
    if (!tabs) return false;
    let live = false;
    for (const [tab, seen] of tabs) {
      if (!Number.isFinite(seen) || at - seen >= FOCUS_TTL_MS) tabs.delete(tab);
      else if (seen <= at) live = true;
    }
    if (!tabs.size) this.byEndpoint.delete(endpoint);
    return live;
  }

  get size(): number {
    return this.byEndpoint.size;
  }
}
