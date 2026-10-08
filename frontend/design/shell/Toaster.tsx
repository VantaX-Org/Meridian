"use client";

import { Toaster as Sonner } from "sonner";
import type { CSSProperties } from "react";

/** Sonner viewport, themed from the Meridian tokens. Mounted once in the root layout. */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
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
