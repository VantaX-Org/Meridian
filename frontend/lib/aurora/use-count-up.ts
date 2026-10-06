"use client";

import { useEffect, useState } from "react";

/** Last value each figure showed, so a re-render or tab switch is not mistaken for a change. */
const lastSeen = new Map<string, number>();

/**
 * Counts to `target` over `ms`, from the figure's previous value (or 0), and only when the value
 * for `key` changed since it was last shown. Integers count; decimals snap to the
 * target at the end. Returns the target at once under prefers-reduced-motion
 * or when the tab is hidden.
 */
export function useCountUp(target: number | null, ms = 360, key?: string): number | null {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    const prev = key === undefined ? undefined : lastSeen.get(key);
    if (key !== undefined) lastSeen.set(key, target);
    const from = prev ?? 0;
    const still = prev === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || ms <= 0;
    if (still || !Number.isInteger(target)) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(from + (target - from) * (1 - (1 - t) ** 3)));
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms, key]);
  return target === null ? null : (shown ?? target);
}
