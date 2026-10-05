/**
 * Aurora <Tooltip> primitive. Pure CSS: the label lives in `data-tip` and is
 * drawn on hover or keyboard focus. Set `fallback` to also set a native
 * `title`, for places where the CSS layer may be clipped.
 */

import type { ReactNode } from "react";
import { clsx } from "./internal";

export interface TooltipProps {
  label: string;
  fallback?: boolean;
  className?: string;
  children: ReactNode;
}

export function Tooltip({ label, fallback = false, className, children }: TooltipProps) {
  return (
    <span className={clsx("aurora-tooltip", className)} data-tip={label} title={fallback ? label : undefined}>
      {children}
    </span>
  );
}
