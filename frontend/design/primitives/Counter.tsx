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
  size,
}: {
  value: number | null;
  versionId?: string;
  decimals?: 0 | 1;
  /** Pixel size override; defaults to the hero token (56/60). */
  size?: number;
}) {
  // Start at 0 (not `value`) so the first paint never flashes the final
  // number before the count-up kicks in.
  const [display, setDisplay] = useState(0);
  const lastVersion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (value === null) return;
    // Snap without animating. setState runs in a frame callback, not
    // synchronously in the effect body, so it never cascades a render.
    const snap = () => {
      const raf = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(raf);
    };
    if (reducedMotion()) {
      lastVersion.current = versionId;
      return snap();
    }
    // Only animate the first time this versionId is seen — a refetch of the
    // same run must not re-trigger the count-up.
    if (versionId !== undefined && lastVersion.current === versionId) return snap();
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / mMotion.draw);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Mark this version "seen" only once the animation actually finishes,
        // not at effect start — otherwise StrictMode's mount/cleanup/remount
        // double-invoke marks it seen before the first run ever animates.
        lastVersion.current = versionId;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, versionId]);

  const type = {
    fontSize: size ?? "var(--m-text-hero)",
    lineHeight: size ? undefined : "var(--m-leading-hero)",
    letterSpacing: "var(--m-tracking-tight)",
    fontWeight: 600,
  };

  if (value === null) {
    return (
      <span aria-label="No data" className="m-numeric" style={{ ...type, color: "var(--m-ink-3)" }}>
        —
      </span>
    );
  }

  return (
    <span
      aria-label={value.toFixed(decimals)}
      className="m-numeric"
      style={{ ...type, color: "var(--m-ink)" }}
    >
      {display.toFixed(decimals)}
    </span>
  );
}
