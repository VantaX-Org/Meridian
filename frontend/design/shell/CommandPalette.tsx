"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DomainChip } from "../primitives/DomainChip";
import { parsePalette, type GrammarContext } from "@/lib/palette-grammar";

const noSubscribe = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const DEFAULT_GROUP = "Pages";
// SAP identifiers (check IDs like MM-001, TABLE.FIELD, run IDs like run_ab12) render in the mono face, spec 5.5.
const SAP_ID = /\b([A-Z]{2,}-\d+|[A-Z][A-Z0-9_]+\.[A-Z][A-Z0-9_]+|run_[a-z0-9]+)\b/g;
function withMono(label: string): ReactNode[] {
  return label.split(SAP_ID).map((part, i) => (i % 2 ? <span key={i} className="m-mono">{part}</span> : part));
}

export interface CommandItem {
  label: string;
  href: string;
  /** Group heading; items without one fall under "Pages". */
  group?: string;
  /** Leading 16px icon. */
  icon?: ReactNode;
  /** Module id of an object result; shows its domain chip. Pages and actions leave it unset. */
  moduleId?: string;
  /** Right-aligned key hint. */
  shortcut?: string;
}

export function CommandPalette({ items, grammar }: { items: CommandItem[]; grammar?: GrammarContext }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const parsed = grammar && query.trim() ? parsePalette(query, grammar) : null;
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
        className="m-motion-colors inline-flex w-8 xl:w-[220px] items-center justify-center xl:justify-between gap-2 border px-2 m-text-body hover:!border-[var(--m-ink-3)]"
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
        onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}
        label="Command palette"
        overlayClassName="m-scrim"
        contentClassName="m-motion-scale-in"
      >
        <Command.Input placeholder="Type a page, object, check ID or record key" value={query} onValueChange={setQuery} />
        {parsed && parsed.chips.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 py-2" aria-label="Parsed filters">
            {parsed.chips.map((c) => (
              <span key={`${c.kind}:${c.value}`} className="rounded-full px-2 m-text-meta" style={{ background: "var(--m-accent-soft)", color: "var(--m-accent-ink)" }}>{c.label}</span>
            ))}
          </div>
        )}
        <Command.List>
          {parsed?.href && (
            <Command.Item
              forceMount
              value={`__grammar__ ${query}`}
              onSelect={() => {
                router.push(parsed.href as string);
                setOpen(false);
              }}
            >
              {parsed.chips.length > 0 ? "Open filtered view" : `Search for "${query.trim()}"`}
            </Command.Item>
          )}
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
                    <span className="flex-1 truncate">{withMono(item.label)}</span>
                    {item.moduleId && <DomainChip moduleId={item.moduleId} />}
                    {item.shortcut && <kbd className="m-kbd">{item.shortcut}</kbd>}
                  </Command.Item>
                ))}
              </Command.Group>
          ))}
        </Command.List>
        <div
          className="flex items-center gap-4 px-4 m-text-label"
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
