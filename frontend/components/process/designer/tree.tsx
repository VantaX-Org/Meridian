"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Button, Input, Mono } from "@/components/ui-core";
import type { DqColour } from "@/types/process-model";
import { childrenOf, type Doc, type Level, type TreeItem } from "./doc";

export interface TreeActions {
  rename: (id: string, name: string) => void;
  add: (parentId: string | null) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
}

interface Row { item: TreeItem; level: Level; index: number; count: number }

const WORD: Record<DqColour, string> = { red: "Blocked activities below", amber: "Degraded activities below", green: "" };

export function ProcessTree({ doc, selected, colour, actions, onSelect, onBlocked, editable }: {
  doc: Doc;
  selected: string | null;
  colour: (item: TreeItem, level: Level) => DqColour | null;
  actions: TreeActions;
  onSelect: (id: string) => void;
  onBlocked: () => void;
  editable: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const out = new Set(doc.l1.map((x) => x.id));
    // Open the ancestors of the selected item so a deep link shows where it sits.
    const walk = (item: TreeItem, level: Level): boolean => {
      if (item.id === selected) return true;
      const hit = level < 4 && childrenOf(item, level).some((c) => walk(c, (level + 1) as Level));
      if (hit) out.add(item.id);
      return hit;
    };
    doc.l1.forEach((x) => walk(x, 1));
    return out;
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const root = useRef<HTMLUListElement>(null);

  const rows: Row[] = [];
  const walk = (list: TreeItem[], level: Level) => list.forEach((item, index) => {
    rows.push({ item, level, index, count: list.length });
    if (level < 4 && open.has(item.id)) walk(childrenOf(item, level), (level + 1) as Level);
  });
  walk(doc.l1, 1);

  const toggle = (id: string, on?: boolean) => setOpen((s) => {
    const n = new Set(s);
    if (on ?? !n.has(id)) n.add(id); else n.delete(id);
    return n;
  });
  const focusRow = (id: string) => root.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus();
  const guard = (fn: () => void) => (editable ? fn() : onBlocked());

  const onKey = (e: KeyboardEvent, r: Row, i: number) => {
    if ((e.target as HTMLElement).closest("input")) return;
    const kids = r.level < 4 ? childrenOf(r.item, r.level) : [];
    if (e.key === "ArrowDown" && rows[i + 1]) focusRow(rows[i + 1].item.id);
    else if (e.key === "ArrowUp" && rows[i - 1]) focusRow(rows[i - 1].item.id);
    else if (e.key === "ArrowRight" && kids.length) { if (!open.has(r.item.id)) toggle(r.item.id, true); else focusRow(kids[0].id); }
    else if (e.key === "ArrowLeft" && open.has(r.item.id)) toggle(r.item.id, false);
    else if (e.key === "Enter") onSelect(r.item.id);
    else if (e.key === "F2") guard(() => setRenaming(r.item.id));
    else return;
    e.preventDefault();
  };

  const focusable = rows.find((r) => r.item.id === selected)?.item.id ?? rows[0]?.item.id;

  return (
    <div className="aurora-designer__tree">
      <ul ref={root} role="tree" aria-label="Process hierarchy">
        {rows.map((r, i) => {
          const id = r.item.id;
          const dot = colour(r.item, r.level);
          const kids = r.level < 4 ? childrenOf(r.item, r.level) : [];
          return (
            <li key={id} role="treeitem" aria-level={r.level} aria-selected={id === selected}
              aria-expanded={kids.length ? open.has(id) : undefined} className="aurora-designer__item">
              <div className="aurora-designer__row" data-level={r.level} data-selected={id === selected || undefined}>
                {renaming === id ? (
                  <Input autoFocus defaultValue={r.item.name} aria-label="Name" maxLength={200}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.item.name) actions.rename(id, v); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} />
                ) : (
                  <button type="button" data-row={id} tabIndex={id === focusable ? 0 : -1}
                    className="aurora-designer__label aurora-focus-ring"
                    onClick={() => { onSelect(id); if (kids.length) toggle(id); }} onKeyDown={(e) => onKey(e, r, i)}>
                    <span className="aurora-designer__level"><Mono>{`L${r.level}`}</Mono></span>
                    <span className="aurora-designer__name">{r.item.name}</span>
                    {dot && dot !== "green" ? (
                      <span className="aurora-designer__dot" data-tone={dot === "red" ? "danger" : "warning"} role="img" aria-label={WORD[dot]} />
                    ) : null}
                  </button>
                )}
                {confirm === id ? (
                  <span className="aurora-designer__actions" data-open>
                    <span className="ui-note">Delete with everything below?</span>
                    <Button size="sm" variant="secondary" onClick={() => { actions.remove(id); setConfirm(null); }}>Delete</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
                  </span>
                ) : renaming === id ? null : (
                  <span className="aurora-designer__actions">
                    <Button size="sm" variant="ghost" aria-label={`Rename ${r.item.name}`} onClick={() => guard(() => setRenaming(id))}>Rename</Button>
                    {r.level < 4 ? <Button size="sm" variant="ghost" aria-label={`Add child to ${r.item.name}`} onClick={() => guard(() => { actions.add(id); toggle(id, true); })}>Add</Button> : null}
                    <Button size="sm" variant="ghost" aria-label={`Move ${r.item.name} up`} disabled={r.index === 0} onClick={() => guard(() => actions.move(id, -1))}>Up</Button>
                    <Button size="sm" variant="ghost" aria-label={`Move ${r.item.name} down`} disabled={r.index === r.count - 1} onClick={() => guard(() => actions.move(id, 1))}>Down</Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${r.item.name}`} onClick={() => guard(() => setConfirm(id))}>Delete</Button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="ghost" onClick={() => guard(() => actions.add(null))}>Add L1 process</Button>
    </div>
  );
}
