/**
 * Aurora signature moment — Process-Graph Emergence (§12 moment 02).
 *
 * Wraps <ProcessGraph> from WS3 with an on-mount stagger that fades + scales
 * nodes in waves from source to sink. Motion runs on --aurora-duration-slow
 * and is disabled under prefers-reduced-motion (the graph snaps to final).
 *
 * Implementation: a small CSS-only overlay on top of the ReactFlow canvas
 * that uses a sweep gradient + a stagger variable per node rank. The
 * component simply toggles a `data-emerging` attribute on the host for
 * 400 ms on mount; CSS does the rest. No motion lib required.
 */

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { clsx } from "../primitives/internal";

export interface ProcessGraphEmergenceProps {
  /** Typically <ProcessGraph nodes edges …/>. */
  children: ReactNode;
  /** Remount key — bumps the entrance when the graph payload changes. */
  remountKey?: string | number;
  className?: string;
}

export function ProcessGraphEmergence({
  children,
  remountKey,
  className,
}: ProcessGraphEmergenceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.setAttribute("data-emerging", "true");
    const timeout = window.setTimeout(() => {
      el.removeAttribute("data-emerging");
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [remountKey]);

  return (
    <div
      ref={rootRef}
      className={clsx("aurora-process-emergence", className)}
    >
      {children}
    </div>
  );
}
