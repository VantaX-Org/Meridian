"use client";

import { useEffect } from "react";
import { Drawer } from "../primitives/Drawer";
import { isTypingTarget, shortcutSections, type ShortcutGroup } from "@/lib/shortcuts";

/** Calls `onTrigger` when `?` is pressed outside an input, textarea, select or editable element. */
export function useShortcutHotkey(onTrigger: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onTrigger]);
}

/**
 * Every keyboard shortcut, grouped. Reads `lib/shortcuts.ts`, the single
 * registry, so nothing here is hand-listed. `first` puts the current page's
 * group on top (the inbox passes "Inbox").
 */
export function ShortcutSheet({ open, onOpenChange, first }: { open: boolean; onOpenChange: (open: boolean) => void; first?: ShortcutGroup }) {
  const sections = shortcutSections(first);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" subtitle="Press ? any time to open this list">
      <div className="flex flex-col gap-6" data-testid="shortcut-sheet">
        {sections.map((section) => (
          <section key={section.group} aria-labelledby={`shortcuts-${section.group}`}>
            <h3 id={`shortcuts-${section.group}`} className="mb-2 m-text-body font-semibold" style={{ color: "var(--m-ink)" }}>{section.group}</h3>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 m-text-body">
              {section.items.map((s) => (
                <div key={`${s.group}-${s.keys}`} className="contents">
                  <dt><kbd className="m-kbd">{s.keys}</kbd></dt>
                  <dd style={{ color: "var(--m-ink-2)" }}>{s.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Drawer>
  );
}
