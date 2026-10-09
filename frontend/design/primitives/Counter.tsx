"use client";

import { useEffect, useRef, useState } from "react";
import { mMotion, reducedMotion } from "../tokens";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Count-up headline number (spec 9.1). Animates 0 → value once per `versionId`, then holds. */
export function Counter({
  value,
  versionId,
  decimals = 0,
  size = 72,
}: {
  value: number | null;
  versionId?: string;
  decimals?: 0 | 1;
  size?: number;
}) {
  const [display, setDisplay] = useState(value ?? 0);
  const lastVersion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (value === null) return;
    if (reducedMotion()) {
      setDisplay(value);
      lastVersion.current = versionId;
      return;
    }
    // Only animate the first time this versionId is seen — a refetch of the
    // same run must not re-trigger the count-up.
    if (versionId !== undefined && lastVersion.current === versionId) {
      setDisplay(value);
      return;
    }
    lastVersion.current = versionId;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / mMotion.draw);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, versionId]);

  if (value === null) {
    return (
      <span
        aria-label="No data"
        style={{ fontSize: 72, fontWeight: 600, color: "var(--m-ink-3)", fontVariantNumeric: "tabular-nums" }}
      >
        —
      </span>
    );
  }

  return (
    <span
      aria-label={value.toFixed(decimals)}
      style={{ fontSize: size, fontWeight: 600, color: "var(--m-ink)", fontVariantNumeric: "tabular-nums" }}
    >
      {display.toFixed(decimals)}
    </span>
  );
}
