"use client";

import type { ReactNode } from "react";
import { Drawer } from "./Drawer";
import { BELOW_XL, useMediaQuery } from "../hooks/useMediaQuery";

/**
 * The detail half of a list → detail pair. Wide, it renders in place (the caller's grid column) with `empty`
 * when nothing is picked. Below `below` (a media query, default under xl) there is no room beside the list, so the
 * detail opens as a sheet while `open` and the list keeps the page: no stacking a second long pane under it.
 * The caller sets `open` when the viewer picks a row (not on a default selection), and clears it on close.
 */
export function DetailPane({
  open, onOpenChange, title, children, empty = null, below = BELOW_XL, label = "Selected item", className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's title. */
  title: ReactNode;
  /** The selected item's detail; null when nothing is selected. */
  children: ReactNode;
  /** Shown in place, wide only, when nothing is selected. */
  empty?: ReactNode;
  below?: string;
  /** Accessible name of the in-place region. */
  label?: string;
  className?: string;
}) {
  const narrow = useMediaQuery(below);
  if (narrow) {
    return (
      <Drawer open={open && !!children} onOpenChange={onOpenChange} title={title}>
        {children}
      </Drawer>
    );
  }
  return <section aria-label={label} className={className ?? "min-w-0"}>{children ?? empty}</section>;
}
