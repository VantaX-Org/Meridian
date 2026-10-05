"use client";

/**
 * Aurora <Menu> primitive. A trigger button plus a native `popover` panel:
 * light dismiss, Esc and top-layer stacking come from the platform. The panel
 * is placed under the trigger on open. Any element inside marked
 * `data-menu-item` closes the panel when clicked.
 */

import { useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clsx } from "./internal";

export interface MenuProps {
  /** Accessible name of the trigger. */
  label: string;
  /** Trigger content. */
  trigger: ReactNode;
  triggerClassName?: string;
  align?: "start" | "end";
  /** Panel width in px. */
  width?: number;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}

export function Menu({ label, trigger, triggerClassName, align = "end", width = 240, onOpenChange, className, children }: MenuProps) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        // @ts-expect-error popovertarget is not yet in React's button typings
        popovertarget={id}
      >
        {trigger}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className={clsx("aurora-menu", className)}
        data-align={align}
        style={{ width }}
        onToggle={(e) => {
          const open = (e.nativeEvent as ToggleEvent).newState === "open";
          const b = btn.current;
          const p = panel.current;
          if (open && b && p) {
            const r = b.getBoundingClientRect();
            p.style.top = `${r.bottom + 8}px`;
            if (align === "end") {
              p.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
              p.style.left = "auto";
            } else {
              p.style.left = `${Math.max(8, r.left)}px`;
              p.style.right = "auto";
            }
          }
          onOpenChange?.(open);
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-menu-item]")) panel.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="aurora-menu__label">{children}</div>;
}

export function MenuSeparator() {
  return <hr className="aurora-menu__sep" />;
}

export function MenuItem({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" data-menu-item="" className={clsx("aurora-menu__item", className)} {...rest}>
      {children}
    </button>
  );
}
