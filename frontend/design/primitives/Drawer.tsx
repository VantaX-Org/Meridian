"use client";

import type { ReactNode } from "react";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";

export function Drawer({
  open, onOpenChange, title, subtitle, footer, children,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string;
  /** 12/16 line under the title, e.g. a check ID in Mono. */
  subtitle?: ReactNode;
  /** Sticky action row at the foot of the sheet. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <BaseDrawer.Root open={open} onOpenChange={onOpenChange}>
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0" style={{ background: "var(--m-scrim)" }} />
        <BaseDrawer.Popup
          className="m-elev-3 m-motion-slide-in-right fixed right-0 top-0 h-full w-[480px] max-w-full flex flex-col lg:right-2 lg:top-2 lg:h-[calc(100%-16px)] lg:rounded-[var(--m-radius-sheet)]"
          style={{ background: "var(--m-sheet)" }}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-5 border-b" style={{ borderColor: "var(--m-line)" }}>
            <div className="min-w-0">
              <BaseDrawer.Title className="text-[15px] leading-5 font-semibold" style={{ color: "var(--m-ink)" }}>
                {title}
              </BaseDrawer.Title>
              {subtitle && <div className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{subtitle}</div>}
            </div>
            <BaseDrawer.Close aria-label="Close" className="m-iconbtn m-motion-colors">
              <X size={18} />
            </BaseDrawer.Close>
          </div>
          <div className="flex-1 overflow-auto p-5">{children}</div>
          {footer && (
            <div className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
              {footer}
            </div>
          )}
        </BaseDrawer.Popup>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
