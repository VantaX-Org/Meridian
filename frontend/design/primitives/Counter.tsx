"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { mMotion, reducedMotion } from "../tokens";

const FORMATS = [0, 1].map((d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

/** "10,521" or "70.0": grouped, at a fixed number of decimals, so a headline number reads like the sentence under it. */
export function formatCount(value: number, decimals: 0 | 1 = 0): string {
  return FORMATS[decimals].format(value);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Count-up headline number. Animates 0 to value over `mMotion.count` once per `versionId`, flashes the settle gradient once, then holds. */
export function Counter({
  value,
  versionId,
  decimals = 0,
  size,
  onHero = false,
}: {
  value: number | null;
  versionId?: string;
  decimals?: 0 | 1;
  /** Size override, a pixel number or any CSS length; defaults to the hero token (56/60). */
  size?: number | string;
  /** Ink from the hero tokens, for use inside `.m-hero`. */
  onHero?: boolean;
}) {
  // Start at 0 (not `value`) so the first paint never flashes the final
  // number before the count-up kicks in.
  const [display, setDisplay] = useState(0);
  const [settled, setSettled] = useState(false);
  const lastVersion = useRef<string | undefined>(undefined);

  // The settle flash is one-shot: drop the class once its animation (mMotion.draw) has played.
  useEffect(() => {
    if (!settled) return;
    const id = setTimeout(() => setSettled(false), mMotion.draw);
    return () => clearTimeout(id);
  }, [settled]);

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
      const t = Math.min(1, (now - start) / mMotion.count);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Mark this version "seen" only once the animation actually finishes,
        // not at effect start — otherwise StrictMode's mount/cleanup/remount
        // double-invoke marks it seen before the first run ever animates.
        lastVersion.current = versionId;
        setSettled(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, versionId]);

  const type = {
    fontSize: size ?? "var(--m-text-hero)",
    lineHeight: size === undefined ? "var(--m-leading-hero)" : size === "inherit" ? "inherit" : undefined,
    letterSpacing: "var(--m-tracking-tight)",
    fontWeight: 600,
    display: "inline-block",
    // Reserve the final width so digits arriving never shift the layout.
    minWidth: value === null ? undefined : `${Math.max(1, formatCount(value, decimals).length)}ch`,
  };

  if (value === null) {
    return (
      <span aria-label="No data" className="m-numeric" style={{ ...type, color: onHero ? "var(--m-hero-ink-3)" : "var(--m-ink-3)" }}>
        —
      </span>
    );
  }

  return (
    <span
      aria-label={formatCount(value, decimals)}
      className={clsx("m-numeric", settled && "m-count-settle")}
      style={{ ...type, color: onHero ? "var(--m-hero-ink)" : "var(--m-ink)" }}
    >
      {formatCount(display, decimals)}
    </span>
  );
}
