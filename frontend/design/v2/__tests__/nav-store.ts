import { useMemo, useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * A working stand-in for next/navigation in jsdom: the URL is a small store, router.push and router.replace write it,
 * and the hooks re-render when it changes, so "?open=" round trips can be tested without a Next app.
 */
let url = "/";
const listeners = new Set<() => void>();

export function setUrl(next: string): void {
  url = next;
  listeners.forEach((l) => l());
}
export const getUrl = (): string => url;

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const push = vi.fn((next: string) => setUrl(next));
export const replace = vi.fn((next: string) => setUrl(next));

export const navigationMock = {
  usePathname: () => {
    const u = useSyncExternalStore(subscribe, () => url, () => url);
    return u.split("?")[0];
  },
  useSearchParams: () => {
    const u = useSyncExternalStore(subscribe, () => url, () => url);
    return useMemo(() => new URLSearchParams(u.includes("?") ? u.slice(u.indexOf("?") + 1) : ""), [u]);
  },
  useRouter: () => ({ push, replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
};
