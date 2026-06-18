"use client";

/**
 * Shared interactive controls for the Meridian surfaces.
 *
 *  - `SearchField`    — a Filter button that expands into a live search
 *                       input. Filtering is client-side over already-loaded
 *                       rows, so it works on every list page without a
 *                       dedicated backend endpoint.
 *  - `matchesSearch`  — generic case-insensitive match used by SearchField
 *                       consumers to filter their row arrays.
 *  - `ConfirmDialog`  — a styled replacement for `window.confirm`, used to
 *                       gate destructive bulk actions.
 */

import { useState, type ReactNode } from "react";
import { FilterIcon } from "@/components/meridian/icons";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** True when every whitespace-separated term in `query` appears somewhere in
 *  the row. Searching the row's serialised form keeps callers from having to
 *  enumerate fields — good enough for a list filter box. */
export function matchesSearch(row: unknown, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = JSON.stringify(row ?? "").toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function SearchField({
  value,
  onChange,
  placeholder = "Filter…",
  label = "Filter",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(value.trim().length > 0);

  if (!open) {
    return (
      <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setOpen(true)}>
        <FilterIcon /> {label}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className="mn-input"
      style={{ width: 220 }}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (value.trim().length === 0) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onChange("");
          setOpen(false);
        }
      }}
    />
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div style={{ fontSize: 13, color: "var(--mn-ink-500)", lineHeight: 1.55, marginTop: 4 }}>
          {body}
        </div>
        <DialogFooter>
          <button type="button" className="mn-btn mn-btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "mn-btn mn-btn-danger" : "mn-btn mn-btn-primary"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
