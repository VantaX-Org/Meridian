"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useV2Href } from "@/lib/v2/hooks";
import { IconCheck } from "./marks";

export type MenuEntry =
  | { kind: "heading"; label: string }
  | { kind: "separator" }
  | {
      kind: "item";
      id: string;
      label: string;
      sub?: string;
      /** Marks the current choice (a radio) or the switched-on column (a checkbox). */
      checked?: boolean;
      variant?: "radio" | "checkbox";
      /** Keeps the menu open after the choice, for a list of switches. */
      keepOpen?: boolean;
      /** Navigates (v2 links keep fixture mode). */
      href?: string;
      /** A link that leaves the v2 interface: no fixture suffix. */
      external?: boolean;
      onSelect?: () => void;
      kbd?: string;
      disabled?: boolean;
    };

export interface MenuButtonProps {
  /** Accessible name of the menu. */
  label: string;
  /** Accessible name of the button when its visible text is not enough: it must contain that text. */
  buttonLabel?: string;
  entries: MenuEntry[];
  /** The button's visible content. */
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  /** Fires when the menu opens: lets a caller load the entries lazily. */
  onOpen?: () => void;
}

/**
 * A button that opens a menu: role menu, arrow keys move, Home and End jump, Esc closes and returns focus to the
 * button, Tab and a click outside close. Positioned fixed from the button, so no ancestor clips it.
 */
export function MenuButton({ label, buttonLabel, entries, children, className, align = "start", onOpen }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const href = useV2Href();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);

  const toggle = () => {
    if (open) return close(false);
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos(align === "end" ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 4, left: Math.max(8, r.left) });
    onOpen?.();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    const first = items().find((el) => el.getAttribute("aria-checked") === "true") ?? items()[0];
    first?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key === "Tab") return setOpen(false);
      const els = items();
      if (!els.length) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      const go = (n: number) => {
        e.preventDefault();
        els[(n + els.length) % els.length].focus();
      };
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i < 0 ? els.length - 1 : i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(els.length - 1);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={buttonLabel}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {children}
      </button>
      {open ? (
        <div ref={list} id={id} className="m2-menu" role="menu" aria-label={label} style={pos}>
          {entries.map((e, i) => {
            if (e.kind === "heading") return <div key={`h${i}`} className="m2-menu-h" role="presentation">{e.label}</div>;
            if (e.kind === "separator") return <hr key={`s${i}`} className="m2-menu-hr" role="separator" />;
            const role = e.checked === undefined ? "menuitem" : e.variant === "checkbox" ? "menuitemcheckbox" : "menuitemradio";
            const body = (
              <>
                <span className="m2-menu-l">
                  {e.label}
                  {e.sub ? <span className="m2-menu-s">{e.sub}</span> : null}
                </span>
                {e.checked ? <IconCheck /> : e.kbd ? <kbd className="m2-kb">{e.kbd}</kbd> : null}
              </>
            );
            const common = { role, "aria-checked": e.checked === undefined ? undefined : e.checked, "aria-disabled": e.disabled ? true : undefined, tabIndex: -1, className: "m2-menu-i" } as const;
            if (e.href) {
              return (
                <Link key={e.id} {...common} href={e.external ? e.href : href(e.href)} onClick={() => { e.onSelect?.(); setOpen(false); }}>
                  {body}
                </Link>
              );
            }
            return (
              <button
                key={e.id}
                type="button"
                {...common}
                onClick={() => {
                  if (e.disabled) return;
                  if (!e.keepOpen) {
                    setOpen(false);
                    btn.current?.focus();
                  }
                  e.onSelect?.();
                }}
              >
                {body}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
