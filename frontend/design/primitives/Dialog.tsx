"use client";

import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";

export function Dialog({
  open, onOpenChange, title, children,
}: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0" style={{ background: "var(--m-scrim)" }} />
        <BaseDialog.Popup
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded shadow-lg p-4 w-[420px]"
          style={{ background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)" }}
        >
          <BaseDialog.Title className="text-[17px] leading-6 font-semibold mb-3" style={{ color: "var(--m-ink)" }}>
            {title}
          </BaseDialog.Title>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
