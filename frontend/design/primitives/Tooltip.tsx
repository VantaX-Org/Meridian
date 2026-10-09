"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

export function Tooltip({
  label,
  children,
  render,
}: {
  label: string;
  children: ReactNode;
  /** Render the trigger as this element instead of a plain button, e.g. a disabled Button — avoids nesting two buttons. */
  render?: ReactElement;
}) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={render}>{children}</BaseTooltip.Trigger>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner>
            <BaseTooltip.Popup
              className="rounded px-2 py-1 text-[12px]"
              style={{ background: "var(--m-ink)", color: "var(--m-sheet)" }}
            >
              {label}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
