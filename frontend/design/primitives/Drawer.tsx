"use client";

import type { ReactNode } from "react";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";

export function Drawer({
  open, onOpenChange, title, children,
}: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return (
    <BaseDrawer.Root open={open} onOpenChange={onOpenChange}>
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0" style={{ background: "var(--m-scrim)" }} />
        <BaseDrawer.Popup
          className="fixed right-0 top-0 h-full w-[420px] shadow-lg flex flex-col"
          style={{ background: "var(--m-sheet)", transitionDuration: "var(--m-motion-duration)", transitionTimingFunction: "var(--m-motion-ease)" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--m-line)" }}>
            <BaseDrawer.Title className="text-[17px] leading-6 font-semibold" style={{ color: "var(--m-ink)" }}>
              {title}
            </BaseDrawer.Title>
            <BaseDrawer.Close aria-label="Close" className="p-1">
              <X size={18} />
            </BaseDrawer.Close>
          </div>
          <div className="flex-1 overflow-auto p-4">{children}</div>
        </BaseDrawer.Popup>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
