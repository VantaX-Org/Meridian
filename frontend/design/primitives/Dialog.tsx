"use client";

import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";

/**
 * 480w panel. `footer` is right-aligned (secondary then primary or danger).
 * `destructive` sets the title at the 22/28 title size used by destructive confirms.
 */
export function Dialog({
  open, onOpenChange, title, children, footer, destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  destructive?: boolean;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0" style={{ background: "var(--m-scrim)" }} />
        <BaseDialog.Popup
          className="m-elev-3 m-motion-scale-in fixed inset-0 m-auto h-fit w-[480px] max-w-[calc(100%-32px)]"
          style={{ background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)", padding: "var(--m-space-6)" }}
        >
          <BaseDialog.Title
            className="font-semibold mb-3"
            style={{
              color: "var(--m-ink)",
              fontSize: destructive ? "var(--m-text-title)" : "var(--m-text-section)",
              lineHeight: destructive ? "var(--m-leading-title)" : "var(--m-leading-section)",
            }}
          >
            {title}
          </BaseDialog.Title>
          <div className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
