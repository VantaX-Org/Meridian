"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { focusables, trapTab } from "./focus";

export type Placement = "bottom" | "top" | "start" | "end";
const OPPOSITE: Record<Placement, Placement> = { bottom: "top", top: "bottom", start: "end", end: "start" };
const GAP = 8;
const ORIGIN: Record<Placement, string> = { bottom: "top left", top: "bottom left", start: "center right", end: "center left" }; // i18n-ignore

/** Where a box of this size goes beside the anchor, flipped to the other side when it would leave the viewport. */
export function place(a: DOMRect, w: number, h: number, vw: number, vh: number, want: Placement): { left: number; top: number; placement: Placement } {
  const at = (p: Placement) => {
    switch (p) {
      case "bottom": return { left: a.left, top: a.bottom + GAP };
      case "top": return { left: a.left, top: a.top - h - GAP };
      case "start": return { left: a.left - w - GAP, top: a.top };
      default: return { left: a.right + GAP, top: a.top };
    }
  };
  const fits = (p: Placement) => {
    const { left, top } = at(p);
    return p === "bottom" || p === "top" ? top >= 0 && top + h <= vh : left >= 0 && left + w <= vw;
  };
  const placement = fits(want) || !fits(OPPOSITE[want]) ? want : OPPOSITE[want];
  const o = at(placement);
  return { left: Math.min(Math.max(0, o.left), Math.max(0, vw - w)), top: Math.min(Math.max(0, o.top), Math.max(0, vh - h)), placement };
}

export interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  label: string;
  children: ReactNode;
}

/** A small anchored layer: Esc and an outside click close it, Tab stays inside, arrows walk its `role="menuitem"` children. */
export function Popover({ anchor, open, onClose, placement = "bottom", label, children }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const p = place(anchor.getBoundingClientRect(), r.width, r.height, window.innerWidth, window.innerHeight, placement);
    setPos({ left: p.left, top: p.top, origin: ORIGIN[p.placement] });
  }, [open, anchor, placement]);

  useEffect(() => {
    if (!open) return;
    const el = box.current;
    (el ? focusables(el)[0] ?? el : null)?.focus();
    const outside = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!el?.contains(n) && !anchor?.contains(n)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      anchor?.focus?.();
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="nx-pop nx-glass nx-m-pop"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden", ["--nx-pop-origin" as string]: pos?.origin }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          return;
        }
        trapTab(e, box.current);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
          if (!items.length) return;
          e.preventDefault();
          const at = items.indexOf(document.activeElement as HTMLElement);
          items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1) + (at < 0 && e.key === "ArrowUp" ? 1 : 0)) % items.length].focus();
        }
      }}
    >
      {children}
    </div>
  );
}
