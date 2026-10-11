"use client";

import { Toaster as Sonner } from "sonner";
import type { CSSProperties } from "react";

/** The one toast viewport, themed from the Meridian tokens. Mounted once in the root layout.
 *  `expand` keeps every visible toast readable; collapsed, the toasts behind the front one show as empty slivers.
 *  Tone bars and the ghost action button are styled in globals.css via [data-type] / [data-button]. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      expand
      richColors={false}
      style={
        {
          "--normal-bg": "var(--m-sheet)",
          "--normal-text": "var(--m-ink)",
          "--normal-border": "transparent",
          "--border-radius": "var(--m-radius-sheet)",
        } as CSSProperties
      }
    />
  );
}
