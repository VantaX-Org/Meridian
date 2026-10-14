// Whether the current page draws its own title (a PageHeader). The Breadcrumb keeps the document's
// single top-level heading but renders it screen-reader-only while a PageHeader is mounted, so a title
// never prints twice.
import { useEffect, useSyncExternalStore } from "react";

let shown = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePageTitleShown(): void {
  useEffect(() => {
    shown += 1; emit();
    return () => { shown -= 1; emit(); };
  }, []);
}

export function usePageTitleIsShown(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => shown > 0, () => false);
}
