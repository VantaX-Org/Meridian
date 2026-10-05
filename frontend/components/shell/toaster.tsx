"use client";

import { Toaster as Sonner } from "sonner";

/** Toast host. Sonner reads its colours from these Aurora tokens, so it follows the theme. */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      style={
        {
          "--normal-bg": "var(--aurora-elev-2-bg)",
          "--normal-text": "var(--aurora-fg-primary)",
          "--normal-border": "var(--aurora-canvas-line-strong)",
          "--success-bg": "var(--aurora-elev-2-bg)",
          "--success-text": "var(--aurora-status-success-500)",
          "--success-border": "var(--aurora-canvas-line-strong)",
          "--error-bg": "var(--aurora-elev-2-bg)",
          "--error-text": "var(--aurora-status-danger-500)",
          "--error-border": "var(--aurora-canvas-line-strong)",
          "--border-radius": "var(--aurora-radius-sheet)",
        } as React.CSSProperties
      }
    />
  );
}
