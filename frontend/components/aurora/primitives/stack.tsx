/**
 * Aurora <Stack> + <Divider> primitives — WS2.
 *
 * Flex container that reads its gap directly from the Aurora spacing scale.
 * Replaces every bespoke `<div style={{ display: "flex", gap: 12 }}>` — those
 * bypass the scale and drift the spacing system.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { clsx } from "./internal";

export type StackDirection = "row" | "column";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between";
export type StackGap = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12 | 16 | 24;

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  align?: StackAlign;
  justify?: StackJustify;
  /** Gap token from Aurora spacing: 1=4px, 2=8px, 3=12px … 24=96px. */
  gap?: StackGap;
  wrap?: boolean;
  children?: ReactNode;
}

export function Stack({
  direction = "column",
  align,
  justify,
  gap = 2,
  wrap,
  style,
  className,
  children,
  ...rest
}: StackProps) {
  const mergedStyle: CSSProperties = {
    ...style,
    gap: `var(--aurora-space-${gap})`,
  };
  return (
    <div
      className={clsx("aurora-stack", className)}
      data-direction={direction}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap ? "true" : undefined}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical";
}

export function Divider({
  orientation = "horizontal",
  className,
  ...rest
}: DividerProps) {
  return (
    <hr
      className={clsx("aurora-divider", className)}
      data-orientation={orientation}
      {...rest}
    />
  );
}
