"use client";

import { useEffect, useState } from "react";

/**
 * Counts from 0 to `target` over `ms`. Integers count; decimals snap to the
 * target at the end. Returns the target at once under prefers-reduced-motion
 * or when the tab is hidden.
 */
export function useCountUp(target: number | null, ms = 360): number | null {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || ms <= 0;
    if (still || !Number.isInteger(target)) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return target === null ? null : (shown ?? target);
}
