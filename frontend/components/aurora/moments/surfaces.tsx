/**
 * Aurora signature moments — surface-level primitives.
 *
 * §12 moments covered:
 *   • moment 04 — BulkActionPanel (multi-row selection action bar)
 *   • moment 05 — ArrivalBanner (first-run welcome strip)
 *   • moment 10 — SavedViewChip (recall a saved filter)
 *   • moment 11 — EmptyState (per-surface empty with SAP icon)
 */

"use client";

import type { ReactNode } from "react";
import { clsx } from "../primitives/internal";
import { Button, Stack, Text } from "../primitives";

/* ------------------------------------------------------ BulkActionPanel --- */

export interface BulkActionPanelProps {
  selectedCount: number;
  onClear: () => void;
  actions: ReactNode;
  /** Renders when `selectedCount > 0`. */
  className?: string;
}

export function BulkActionPanel({
  selectedCount,
  onClear,
  actions,
  className,
}: BulkActionPanelProps) {
  if (selectedCount <= 0) return null;
  return (
    <div
      className={clsx("aurora-bulk-action-panel", className)}
      role="region"
      aria-label={`${selectedCount} selected`}
    >
      <Stack direction="row" gap={3} align="center">
        <Text variant="text-body" className="aurora-bulk-action-panel__count">
          <Text as="span" numeric variant="text-body">
            {selectedCount.toLocaleString()}
          </Text>{" "}
          selected
        </Text>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </Stack>
      <Stack direction="row" gap={2} align="center">
        {actions}
      </Stack>
    </div>
  );
}

/* --------------------------------------------------------- ArrivalBanner --- */

export interface ArrivalBannerProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function ArrivalBanner({
  eyebrow,
  title,
  body,
  actions,
  onDismiss,
  className,
}: ArrivalBannerProps) {
  return (
    <section className={clsx("aurora-arrival-banner", className)}>
      <div className="aurora-arrival-banner__body">
        {eyebrow ? (
          <Text variant="text-micro" tone="accent">
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="display-sm">{title}</Text>
        {body ? (
          <Text variant="text-lead" tone="secondary">
            {body}
          </Text>
        ) : null}
      </div>
      <Stack direction="row" gap={2} align="center">
        {actions}
        {onDismiss ? (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </Stack>
    </section>
  );
}

/* --------------------------------------------------------- SavedViewChip --- */

export interface SavedViewChipProps {
  label: ReactNode;
  /** Count badge, e.g. row count matched by the view. */
  count?: number;
  active?: boolean;
  onClick?: () => void;
  /** Render an X to delete the saved view. */
  onDelete?: () => void;
  className?: string;
}

export function SavedViewChip({
  label,
  count,
  active,
  onClick,
  onDelete,
  className,
}: SavedViewChipProps) {
  return (
    <span
      className={clsx("aurora-saved-view-chip", className)}
      data-active={active ? "true" : undefined}
    >
      {/*
        aurora-focus-ring lives on each focusable <button>, not the
        outer <span>. The span has no tabIndex, so :focus-visible on it
        never fires — a focus ring here would be invisible to keyboard
        users. Matches Button / Input / Tabs / Combobox.
      */}
      <button
        type="button"
        onClick={onClick}
        className={clsx("aurora-saved-view-chip__body", "aurora-focus-ring")}
      >
        <span className="aurora-saved-view-chip__glyph" aria-hidden>
          <BookmarkGlyph filled={active} />
        </span>
        <span>{label}</span>
        {typeof count === "number" ? (
          <span className="aurora-saved-view-chip__count" data-numeric="true">
            {count.toLocaleString()}
          </span>
        ) : null}
      </button>
      {onDelete ? (
        <button
          type="button"
          aria-label="Delete saved view"
          onClick={onDelete}
          className={clsx("aurora-saved-view-chip__delete", "aurora-focus-ring")}
        >
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

function BookmarkGlyph({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M4 2.5h8v11L8 11l-4 2.5v-11z" />
    </svg>
  );
}

/* ------------------------------------------------------------ EmptyState --- */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx("aurora-empty-state", className)}
      role="status"
      aria-live="polite"
    >
      {icon ? <div className="aurora-empty-state__icon">{icon}</div> : null}
      <Text variant="text-lead">{title}</Text>
      {body ? (
        <Text variant="text-body" tone="secondary">
          {body}
        </Text>
      ) : null}
      {actions ? <div className="aurora-empty-state__actions">{actions}</div> : null}
    </div>
  );
}
