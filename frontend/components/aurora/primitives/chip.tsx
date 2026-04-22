/**
 * Aurora <Chip> primitive — WS2.
 *
 * Inline pill for filter state, active selection, and compact status. The
 * `tone` prop pulls from the semantic status tokens — never for decoration.
 * Interactive chips (filter bar) take `onClick`; static chips default to a
 * non-interactive span.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { clsx } from "./internal";

export type ChipTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface ChipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "onClick"> {
  tone?: ChipTone;
  selected?: boolean;
  leadingIcon?: ReactNode;
  onDismiss?: () => void;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({
  tone = "neutral",
  selected = false,
  leadingIcon,
  onDismiss,
  onClick,
  className,
  children,
  ...rest
}: ChipProps) {
  const interactive = typeof onClick === "function";
  return (
    <span
      className={clsx("aurora-chip", className)}
      data-tone={tone === "neutral" ? undefined : tone}
      data-selected={selected ? "true" : undefined}
      data-interactive={interactive ? "true" : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      {...rest}
    >
      {leadingIcon}
      {children}
      {onDismiss ? (
        <button
          type="button"
          aria-label="Remove"
          className="aurora-chip__dismiss"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
