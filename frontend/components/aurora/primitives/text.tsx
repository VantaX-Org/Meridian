/**
 * Aurora <Text> primitive — WS2.
 *
 * Thin wrapper around the typography tokens defined in `lib/aurora/tokens.ts`
 * §5.3.2. Exposes the six and only six size variants and a small palette of
 * tone overrides. Every string in the product flows through `<Text>` (or one
 * of the compound components below) — ad-hoc `<p style={{ fontSize: … }}>`
 * is a lint violation per `PLAN_AURORA.md` §16.1.
 */

import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { clsx } from "./internal";

export type TextVariant =
  | "text-micro"
  | "text-small"
  | "text-body"
  | "text-lead"
  | "display-sm"
  | "display-lg";

export type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "muted"
  | "accent"
  | "danger";

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, "as"> {
  /** Token from the six-size Aurora scale. Defaults to `text-body`. */
  variant?: TextVariant;
  /** Foreground tone. Defaults to `primary`. */
  tone?: TextTone;
  /** Tabular, lining figures. Use for every numeric value. */
  numeric?: boolean;
  /** Underlying element. Defaults map variant → semantic tag. */
  as?: ElementType;
  children?: ReactNode;
}

const DEFAULT_AS: Record<TextVariant, ElementType> = {
  "text-micro": "span",
  "text-small": "span",
  "text-body": "p",
  "text-lead": "p",
  "display-sm": "h2",
  "display-lg": "h1",
};

export function Text({
  variant = "text-body",
  tone = "primary",
  numeric = false,
  as,
  className,
  children,
  ...rest
}: TextProps) {
  const Component = as ?? DEFAULT_AS[variant];
  return (
    <Component
      className={clsx("aurora-text", className)}
      data-variant={variant}
      data-tone={tone === "primary" ? undefined : tone}
      data-numeric={numeric ? "true" : undefined}
      {...rest}
    >
      {children}
    </Component>
  );
}
