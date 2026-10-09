"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Button } from "../primitives/Button";

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
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label="Search">
        Search <kbd style={{ marginLeft: 6, color: "var(--m-ink-3)" }}>{isMac ? "⌘K" : "Ctrl+K"}</kbd>
      </Button>
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
