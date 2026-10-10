"use client";

import { Toaster as Sonner } from "sonner";
import type { CSSProperties } from "react";

/** The one toast viewport, themed from the Meridian tokens. Mounted once in the root layout.
 *  `expand` keeps every visible toast readable; collapsed, the toasts behind the front one show as empty slivers. */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      expand
      style={
        {
          "--normal-bg": "var(--m-sheet-raised)",
          "--normal-text": "var(--m-ink)",
          "--normal-border": "var(--m-line)",
          "--success-bg": "var(--m-sheet-raised)",
          "--success-text": "var(--m-pass)",
          "--success-border": "var(--m-line)",
          "--error-bg": "var(--m-sheet-raised)",
          "--error-text": "var(--m-critical)",
          "--error-border": "var(--m-line)",
          "--border-radius": "var(--m-radius-sheet)",
        } as CSSProperties
      }
    />
  );
}
