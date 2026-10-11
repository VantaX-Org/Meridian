"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const noSubscribe = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const DEFAULT_GROUP = "Pages";

export interface CommandItem {
  label: string;
  href: string;
  /** Group heading; items without one fall under "Pages". */
  group?: string;
  /** Leading 16px icon. */
  icon?: ReactNode;
  /** Right-aligned key hint. */
  shortcut?: string;
}

export function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false);
  // Server snapshot is "not Mac", so SSR and hydration agree; the client reads the real platform.
  const isMac = useSyncExternalStore(noSubscribe, readIsMac, () => false);
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = new Map<string, CommandItem[]>();
  for (const item of items) {
    const g = item.group ?? DEFAULT_GROUP;
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="m-motion-colors inline-flex w-8 xl:w-[220px] items-center justify-center xl:justify-between gap-2 border px-2 text-[13px] leading-[18px] hover:!border-[var(--m-ink-3)]"
        style={{ height: "var(--m-control-h)", borderColor: "var(--m-line-strong)", background: "var(--m-sheet)", color: "var(--m-ink-3)", borderRadius: "var(--m-radius-control)" }}
      >
        <span className="flex items-center gap-2">
          <Search size={14} aria-hidden />
          <span className="hidden xl:inline">Search or jump to…</span>
        </span>
        <kbd className="m-kbd hidden xl:inline-flex">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        overlayClassName="m-scrim-glass"
        contentClassName="m-motion-scale-in"
      >
        <Command.Input placeholder="Type a page, object, check ID or record key" />
        <Command.List>
          <Command.Empty>Nothing matches. Try a check ID like <span style={{ fontFamily: "var(--m-font-mono)" }}>MM-001</span> or a material number.</Command.Empty>
          {[...groups].map(([group, list]) => (
              <Command.Group key={group} heading={group}>
                {list.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`${item.label} ${item.href}`}
                    onSelect={() => {
                      router.push(item.href);
                      setOpen(false);
                    }}
                  >
                    {item.icon}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.shortcut && <kbd className="m-kbd">{item.shortcut}</kbd>}
                  </Command.Item>
                ))}
              </Command.Group>
          ))}
        </Command.List>
        <div
          className="flex items-center gap-4 px-4 text-[11px] leading-[14px]"
          style={{ height: 36, background: "var(--m-sheet-raised)", color: "var(--m-ink-3)", borderTop: "1px solid var(--m-line)" }}
        >
          <span className="flex items-center gap-1"><kbd className="m-kbd">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="m-kbd">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="m-kbd">esc</kbd> close</span>
        </div>
      </Command.Dialog>
    </>
  );
}
