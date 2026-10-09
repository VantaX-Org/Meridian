"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const noSubscribe = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

export interface CommandItem {
  label: string;
  href: string;
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="inline-flex h-8 w-8 xl:w-[220px] items-center justify-center xl:justify-between gap-2 rounded border px-2 xl:px-3 text-[13px] leading-[18px] transition-colors"
        style={{ borderColor: "var(--m-line)", background: "var(--m-sheet-raised)", color: "var(--m-ink-3)", borderRadius: "var(--m-radius-control)" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--m-sheet)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--m-sheet-raised)"; }}
      >
        <span className="flex items-center gap-2">
          <Search size={16} />
          <span className="hidden xl:inline">Search</span>
        </span>
        <kbd
          className="hidden xl:inline-flex items-center rounded border px-1 text-[12px] leading-[16px]"
          style={{ borderColor: "var(--m-line)", color: "var(--m-ink-3)" }}
        >
          {isMac ? "⌘K" : "Ctrl+K"}
        </kbd>
      </button>
      <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
        <Command.Input placeholder="Jump to..." />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          {items.map((item) => (
            <Command.Item
              key={item.href}
              onSelect={() => {
                router.push(item.href);
                setOpen(false);
              }}
            >
              {item.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command.Dialog>
    </>
  );
}
