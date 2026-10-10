"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

export function Tooltip({
  label,
  children,
  render,
  side = "top",
  sideOffset,
  preLine = false,
  maxWidth,
}: {
  label: string;
  children: ReactNode;
  /** Render the trigger as this element instead of a plain button, e.g. a disabled Button — avoids nesting two buttons. */
  render?: ReactElement;
  /** Which side of the trigger the popup opens on. */
  side?: "top" | "right" | "bottom" | "left";
  /** Gap between trigger and popup, in px. */
  sideOffset?: number;
  /** Renders `label`'s `\n` line breaks instead of collapsing them (e.g. a parent + its children, one per line). */
  preLine?: boolean;
  /** Caps the popup's width, in px (wraps long multiline labels instead of growing wide). */
  maxWidth?: number;
}) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={render}>{children}</BaseTooltip.Trigger>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
            <BaseTooltip.Popup
              className="rounded px-2 py-1 text-[12px]"
              style={{
                background: "var(--m-ink)",
                color: "var(--m-sheet)",
                whiteSpace: preLine ? "pre-line" : undefined,
                maxWidth,
              }}
            >
              {label}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
