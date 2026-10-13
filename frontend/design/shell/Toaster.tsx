"use client";

import { Toaster as Sonner, toast as sonner } from "sonner";
import type { CSSProperties } from "react";

export interface UndoableOptions {
  /** Calls the inverse endpoint. Only offer undo where the API really has one. */
  undo: () => Promise<void>;
  /** How long the Undo action stays available. Default 8000. */
  timeoutMs?: number;
}

/** A toast with an "Undo" action. Resolves the toast with a confirmation or an error, never silently. */
function undoable(message: string, { undo, timeoutMs = 8000 }: UndoableOptions): string | number {
  return sonner(message, {
    duration: timeoutMs,
    action: {
      label: "Undo",
      onClick: () => {
        undo().then(
          () => { sonner("Undone"); },
          () => { sonner.error("Could not undo"); },
        );
      },
    },
  });
}

/** sonner's toast plus `toast.undoable(message, { undo, timeoutMs })`. */
export const toast = Object.assign((...args: Parameters<typeof sonner>) => sonner(...args), sonner, { undoable }) as typeof sonner & { undoable: typeof undoable };

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
