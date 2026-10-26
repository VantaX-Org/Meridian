"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { DomainChip } from "../primitives/DomainChip";
import { parsePalette, type GrammarContext } from "@/lib/palette-grammar";
import { isTypingTarget, shortcutLabel, useIsMac } from "@/lib/shortcuts";
import { IconSearch } from "../icons";

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
  const isMac = useIsMac();
  const router = useRouter();
  // The latest items for the global key handler, so it subscribes once.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Read by the key handler, so it subscribes once.
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      // ⌘K is the one global key: it opens the palette from anywhere, even while typing.
      if (e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // Item key hints such as "⌘1" (lib/nav.ts `shortcut`, href already resolved for the viewer) are live only while
      // the palette is open, so ⌘/Ctrl + digit keeps switching browser tabs everywhere else; and never while typing
      // in a box outside the palette.
      if (!openRef.current) return;
      if (isTypingTarget(e.target) && !(e.target instanceof Element && e.target.closest("[cmdk-root]"))) return;
      const hit = itemsRef.current.find((i) => i.shortcut === `⌘${e.key}`);
      if (hit) {
        e.preventDefault();
        setOpen(false);
        router.push(hit.href);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

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
          <IconSearch size={14} />
          <span className="hidden xl:inline">Search or jump to…</span>
        </span>
        <kbd className="m-kbd hidden xl:inline-flex">{shortcutLabel("⌘K", isMac)}</kbd>
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
          <Command.Empty>Nothing matches. Try a rule ID like <span style={{ fontFamily: "var(--m-font-mono)" }}>MM003</span> or a material number.</Command.Empty>
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
                    {item.shortcut && <kbd className="m-kbd">{shortcutLabel(item.shortcut, isMac)}</kbd>}
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
