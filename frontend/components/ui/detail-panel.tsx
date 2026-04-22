"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DetailPanelProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Width in px. Defaults to 480. Pass 640 for dense payloads. */
  width?: number;
  /** Enables ↑/↓ keyboard step-through. Callers wire prev/next row navigation. */
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

/**
 * Right-side slide-over panel for drill-through detail. Used to open a
 * finding, exception, system, or module without leaving the list view.
 * Keyboard: ↑/↓ step through, Esc close.
 */
export function DetailPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  width = 480,
  onPrev,
  onNext,
  className,
}: DetailPanelProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack when user is typing in an input.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (e.key === "ArrowDown" && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowUp" && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onPrev, onNext]);

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <SheetPrimitive.Popup
          aria-label="Details panel"
          style={{ width }}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex max-w-[92vw] flex-col border-l border-border bg-white shadow-[0_0_0_1px_rgba(16,24,40,0.04),_-12px_0_32px_rgba(16,24,40,0.08)] transition-transform duration-200 ease-out",
            "data-starting-style:translate-x-full data-ending-style:translate-x-full",
            className,
          )}
        >
          <header className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <SheetPrimitive.Title className="text-base font-semibold text-foreground">
                {title}
              </SheetPrimitive.Title>
              {subtitle ? (
                <SheetPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                  {subtitle}
                </SheetPrimitive.Description>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {onPrev ? (
                <button
                  type="button"
                  onClick={onPrev}
                  aria-label="Previous item"
                  title="Previous (↑)"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {onNext ? (
                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Next item"
                  title="Next (↓)"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <SheetPrimitive.Close
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </SheetPrimitive.Close>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <footer className="border-t border-border bg-muted/40 px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
