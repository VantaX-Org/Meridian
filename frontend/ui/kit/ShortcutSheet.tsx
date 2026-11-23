"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

export interface Shortcut { keys: string; label: string }

/** Opens on ? and lists the shortcuts the current screen registered. `?` is ignored while typing in a field. */
export function ShortcutSheet({ items, triggerLabel }: { items: Shortcut[]; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target;
      if (e.key !== "?" || (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  return (
    <>
    {triggerLabel ? <Button variant="ghost" onClick={() => setOpen(true)}>{triggerLabel} <kbd className="mx-kbd">?</kbd></Button> : null}
    <Sheet open={open} onClose={() => setOpen(false)} label={t("Keyboard shortcuts")} closeLabel={t("Close")}>
      <h2 className="mx-state-h">{t("Keyboard shortcuts")}</h2>
      <dl className="mx-shortcuts">
        {items.map((i) => <div key={i.keys + i.label}><dt><kbd className="mx-kbd">{i.keys}</kbd></dt><dd>{i.label}</dd></div>)}
      </dl>
    </Sheet>
    </>
  );
}
