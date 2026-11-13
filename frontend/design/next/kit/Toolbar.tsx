"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { cx } from "./cx";

export interface ToolbarAction {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

const VISIBLE = 3;

/** Sticky bar under the shell. The title shows only while the large title is collapsed (CSS, via [data-collapsed]). */
export function Toolbar({ title, segments, actions = [], trailing, className, ...rest }: {
  title: string;
  segments?: ReactNode;
  actions?: ToolbarAction[];
  trailing?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const shown = actions.slice(0, VISIBLE);
  const more = actions.slice(VISIBLE);
  return (
    <div role="toolbar" aria-label={title} className={cx("nx-toolbar", className)} {...rest}>
      <span className="nx-toolbar-title">{title}</span>
      {segments ? <div className="nx-toolbar-seg">{segments}</div> : null}
      <div className="nx-toolbar-end">
        {shown.map((a) => (
          <Button key={a.id} variant="quiet" size={32} disabled={a.disabled} onClick={a.onClick}>{a.label}</Button>
        ))}
        {more.length ? <Overflow actions={more} /> : null}
        {trailing}
      </div>
    </div>
  );
}

function Overflow({ actions }: { actions: ToolbarAction[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };
  return (
    <span className="nx-toolbar-more">
      <Button ref={btn} variant="quiet" size={32} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        {t("More actions")}
      </Button>
      {open ? (
        <div ref={menu} id={id} role="menu" aria-label={t("More actions")} className="nx-toolbar-menu" onKeyDown={onKey}>
          {actions.map((a) => (
            <button key={a.id} type="button" role="menuitem" className="nx-toolbar-item" disabled={a.disabled} onClick={() => { close(); a.onClick(); }}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
