"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { clsx } from "clsx";

const Framed = createContext(false);

/**
 * The one page frame: 1600px max, page padding, centred, inline-size container for the grid recipes.
 * The (app) layout renders the outermost frame; a PageFrame inside it only lays out its children
 * (a column with the page gap), so a page or template never double-pads. Outside the layout
 * (tests, standalone use) it renders the full frame itself.
 */
export function PageFrame({
  children, gap = 4, className, style, ...rest
}: {
  children: ReactNode;
  /** Spacing step: 4 is the 16px data-page gap, 6 the 24px narrative gap. */
  gap?: 3 | 4 | 6;
  className?: string;
  style?: CSSProperties;
  "data-state"?: string;
  "aria-busy"?: boolean | "true" | "false";
}) {
  const inside = useContext(Framed);
  const cls = clsx("flex flex-col", !inside && "m-page", className);
  return <div className={cls} style={{ gap: `var(--m-space-${gap})`, ...style }} {...rest}>{children}</div>;
}

/** Layout-level frame: marks the subtree as framed so nested PageFrames do not pad again. */
export function RootPageFrame({ children }: { children: ReactNode }) {
  return (
    <Framed.Provider value>
      <div className="m-page">{children}</div>
    </Framed.Provider>
  );
}
