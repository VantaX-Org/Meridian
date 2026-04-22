/**
 * Aurora <Button> primitive — WS2.
 *
 * Four variants (primary / secondary / ghost / danger) × three sizes (sm /
 * md / lg) tracking the Aurora density scale. No loading spinners under
 * 1 s (§5.5). Icons belong in `leadingIcon` / `trailingIcon` slots — never
 * as children.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "./internal";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon slot — 16 × 16 in `sm`, 20 × 20 otherwise. */
  leadingIcon?: ReactNode;
  /** Trailing icon slot — 16 × 16 in `sm`, 20 × 20 otherwise. */
  trailingIcon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx("aurora-button", "aurora-focus-ring", className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </button>
  );
}
