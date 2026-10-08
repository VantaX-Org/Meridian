import type { ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger>{children}</BaseTooltip.Trigger>
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
