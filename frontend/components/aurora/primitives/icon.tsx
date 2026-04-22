/**
 * Aurora <Icon> primitive — WS2.
 *
 * A size-controlled slot. Pass any 24×24 SVG (Aurora SAP icon catalogue,
 * Lucide, or bespoke). Use `title` to expose an accessible label; omit for
 * decorative icons beside text.
 */

import type { ReactElement } from "react";
import { clsx } from "./internal";

export type IconSize = "sm" | "md" | "lg";

export interface IconProps {
  children: ReactElement;
  size?: IconSize;
  /** Optional accessible label. Without it the icon is treated as decorative. */
  title?: string;
  className?: string;
}

export function Icon({ children, size = "md", title, className }: IconProps) {
  return (
    <span
      className={clsx("aurora-icon", className)}
      data-size={size}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      {children}
    </span>
  );
}
