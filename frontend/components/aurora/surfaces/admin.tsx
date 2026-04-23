/**
 * Aurora Admin surface — WS8.
 *
 * The configuration workspace: seven tabs (Users & Roles, Connections,
 * Sync Monitor, AI, Rules, Licence, Settings). Per the Aurora Operating
 * Manual §9, Admin is quiet by design — no verdict card, no bulk inbox —
 * and every destructive action is gated by a typed MERIDIAN-CONFIRM
 * prompt so one misclick never costs a customer their data.
 *
 * Shell + tab-bar + per-tab body slot. Hosts compose each tab's content;
 * the surface owns only the layout and the cross-tab affordances (Doctor
 * embed on the Settings tab, Audit Log inside Users & Roles).
 *
 * Per spec §9:
 *   - Flat layout: every setting on one scrollable surface per tab
 *   - Destructive-confirm component (typed MERIDIAN-CONFIRM)
 *   - Doctor card at top of Settings (live meridianctl output, 30s refresh)
 *   - Audit Log as a sub-tab / embedded table in Users & Roles
 */

"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useMemo, useState } from "react";
import { Button, Stack, Tabs, Text, type TabsItem } from "@/components/aurora";
import { clsx } from "../primitives/internal";

/* ---------------------------------------------------------------- Types --- */

export type AdminTabId =
  | "users"
  | "connections"
  | "sync"
  | "ai"
  | "rules"
  | "licence"
  | "settings";

export interface AdminTabState {
  id: AdminTabId;
  label: ReactNode;
  /** Optional count badge — e.g. "12 users", "3 alerts". */
  count?: number;
  body?: ReactNode;
  disabled?: boolean;
}

export interface AdminProps {
  /** Tab state. Host owns active-tab. */
  tabs: ReadonlyArray<AdminTabState>;
  activeTab: AdminTabId;
  onActiveTabChange: (id: AdminTabId) => void;
  /** Optional top-right action row — e.g. "Invite user", "Export config". */
  actions?: ReactNode;
  className?: string;
}

/* ----------------------------------------------------------- Constants --- */

const DEFAULT_TABS: ReadonlyArray<TabsItem<AdminTabId>> = [
  { id: "users", label: "Users & Roles" },
  { id: "connections", label: "Connections" },
  { id: "sync", label: "Sync Monitor" },
  { id: "ai", label: "AI" },
  { id: "rules", label: "Rules" },
  { id: "licence", label: "Licence" },
  { id: "settings", label: "Settings" },
];

/* --------------------------------------------------- Surface component --- */

export function Admin({
  tabs,
  activeTab,
  onActiveTabChange,
  actions,
  className,
}: AdminProps) {
  const tabItems: TabsItem<AdminTabId>[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    count: t.count,
    disabled: t.disabled,
  }));
  const resolvedTabs = tabItems.length > 0 ? tabItems : DEFAULT_TABS;
  const activeBody = tabs.find((t) => t.id === activeTab)?.body;

  return (
    <section
      className={clsx("aurora-admin", className)}
      aria-label="Admin workspace"
    >
      <header className="aurora-admin__head">
        <div className="aurora-admin__title">
          <Text variant="display-sm" as="h1">
            Administration
          </Text>
          <Text variant="text-body" tone="secondary">
            Configure Meridian — users, connections, sync, licence, rules.
          </Text>
        </div>
        {actions ? (
          <div className="aurora-admin__actions" role="toolbar" aria-label="Admin actions">
            {actions}
          </div>
        ) : null}
      </header>

      <Tabs
        items={resolvedTabs}
        value={activeTab}
        onValueChange={onActiveTabChange}
        ariaLabel="Admin tabs"
      />

      <div className="aurora-admin__body" role="region" aria-live="polite">
        {activeBody ?? <AdminTabEmpty id={activeTab} />}
      </div>
    </section>
  );
}

/** Fallback body when a tab has no content wired yet. */
function AdminTabEmpty({ id }: { id: AdminTabId }) {
  const label = DEFAULT_TABS.find((t) => t.id === id)?.label ?? id;
  return (
    <div className="aurora-admin__empty">
      <Text variant="text-body" tone="secondary">
        {label} — host has not supplied a body for this tab yet. Wire a
        body in AdminTabState to render content here.
      </Text>
    </div>
  );
}

/* ----------------------------------------------------- Doctor card --- */

export interface AdminDoctorItem {
  /** Check id, e.g. "postgres.reachable". */
  id: string;
  label: ReactNode;
  status: "ok" | "warn" | "fail";
  /** Optional line of detail shown under the status. */
  detail?: ReactNode;
}

export interface AdminDoctorCardProps {
  items: ReadonlyArray<AdminDoctorItem>;
  /** Human-readable last-check timestamp (host formats). */
  lastChecked: ReactNode;
  /** Invoked when the user clicks "Re-run now". */
  onRefresh?: () => void;
  className?: string;
}

/**
 * Live health summary. Hosts feed `items` from `meridianctl doctor`
 * every 30 seconds; the surface renders each item with a status dot
 * and optional detail. A failing item expands its detail inline so
 * admins never need to SSH for routine health checks.
 */
export function AdminDoctorCard({
  items,
  lastChecked,
  onRefresh,
  className,
}: AdminDoctorCardProps) {
  const summary = useMemo(() => {
    let ok = 0;
    let warn = 0;
    let fail = 0;
    for (const i of items) {
      if (i.status === "ok") ok++;
      else if (i.status === "warn") warn++;
      else fail++;
    }
    return { ok, warn, fail };
  }, [items]);

  return (
    <section
      className={clsx("aurora-admin-doctor", className)}
      aria-label="Doctor — live health checks"
    >
      <header className="aurora-admin-doctor__head">
        <Text variant="text-lead" as="h2">
          Doctor
        </Text>
        <Text variant="text-small" tone="tertiary">
          Last check {lastChecked}
        </Text>
        {onRefresh ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="aurora-admin-doctor__refresh"
          >
            Re-run now
          </Button>
        ) : null}
      </header>
      <div className="aurora-admin-doctor__summary" role="status">
        <Text variant="text-small" numeric as="span">
          {summary.ok} OK
        </Text>
        {summary.warn > 0 ? (
          <Text variant="text-small" numeric as="span">
            {summary.warn} warning
          </Text>
        ) : null}
        {summary.fail > 0 ? (
          <Text variant="text-small" numeric as="span">
            {summary.fail} failing
          </Text>
        ) : null}
      </div>
      <ul className="aurora-admin-doctor__items">
        {items.map((item) => (
          <li
            key={item.id}
            className="aurora-admin-doctor__item"
            data-status={item.status}
          >
            <span
              className="aurora-admin-doctor__dot"
              data-status={item.status}
              aria-label={`${item.status} — ${item.id}`}
            />
            <Text variant="text-body" as="span">
              {item.label}
            </Text>
            {item.detail ? (
              <Text
                variant="text-small"
                tone="secondary"
                className="aurora-admin-doctor__detail"
              >
                {item.detail}
              </Text>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------- Audit log table --- */

export interface AdminAuditLogEntry {
  id: string;
  /** ISO-8601 timestamp for <time dateTime>. */
  timestamp: string;
  /** Display label — e.g. "14m ago" or "Mar 12, 14:00". */
  displayTime: ReactNode;
  actor: ReactNode;
  /** Verb + object — e.g. "Updated role for Sarah Chen". */
  action: ReactNode;
  /** Optional IP / user-agent or structured context. */
  context?: ReactNode;
}

export interface AdminAuditLogTableProps {
  entries: ReadonlyArray<AdminAuditLogEntry>;
  /** Rendered when entries is empty. */
  emptyLabel?: ReactNode;
  className?: string;
}

/**
 * Dense audit log. Every state change in the product is logged with
 * actor / action / context / timestamp. Displayed inside Users & Roles
 * per spec §10.5. The table is read-only — host filters + paginates.
 */
export function AdminAuditLogTable({
  entries,
  emptyLabel = "No audit activity in the selected range.",
  className,
}: AdminAuditLogTableProps) {
  if (entries.length === 0) {
    return (
      <div className={clsx("aurora-admin-audit__empty", className)}>
        <Text variant="text-body" tone="secondary">
          {emptyLabel}
        </Text>
      </div>
    );
  }
  return (
    <table
      className={clsx("aurora-admin-audit", className)}
      aria-label="Audit log"
    >
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Actor</th>
          <th scope="col">Action</th>
          <th scope="col">Context</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td>
              <time dateTime={e.timestamp}>{e.displayTime}</time>
            </td>
            <td>{e.actor}</td>
            <td>{e.action}</td>
            <td>
              <Text variant="text-small" tone="tertiary" as="span">
                {e.context ?? "—"}
              </Text>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------- Destructive confirm --- */

export interface AdminDestructiveConfirmProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "title"> {
  /** Headline — verb + object. "Delete user Sarah Chen". */
  title: ReactNode;
  /** Body copy explaining the consequence. */
  body: ReactNode;
  /** Controlled text the user must type. Defaults to "MERIDIAN-CONFIRM". */
  expected?: string;
  /** Label on the confirm button. Defaults to "Confirm". */
  confirmLabel?: ReactNode;
  /** Label on the cancel button. Defaults to "Cancel". */
  cancelLabel?: ReactNode;
  /** Called when the user types the expected token and clicks confirm. */
  onConfirm: () => void;
  /** Called when the user cancels. */
  onCancel: () => void;
  className?: string;
}

/**
 * Inline destructive-confirm block — NOT a modal. Renders where the
 * action was triggered (e.g. beside the "Delete user" button). The
 * confirm button remains disabled until the user types the expected
 * token exactly — default MERIDIAN-CONFIRM.
 *
 * Per spec §10.3: "Any destructive action requires typing the string
 * MERIDIAN-CONFIRM before the action button enables. The button is
 * danger-coloured only while active."
 */
export function AdminDestructiveConfirm({
  title,
  body,
  expected = "MERIDIAN-CONFIRM",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  className,
  ...rest
}: AdminDestructiveConfirmProps) {
  const [typed, setTyped] = useState("");
  const ready = typed === expected;
  return (
    <div
      {...rest}
      className={clsx("aurora-admin-destructive", className)}
      role="alertdialog"
      aria-labelledby="aurora-admin-destructive-title"
      aria-describedby="aurora-admin-destructive-body"
    >
      <Text
        id="aurora-admin-destructive-title"
        variant="text-lead"
        as="h3"
      >
        {title}
      </Text>
      <Text
        id="aurora-admin-destructive-body"
        variant="text-body"
        tone="secondary"
        as="p"
      >
        {body}
      </Text>
      <label className="aurora-admin-destructive__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Type <span className="aurora-admin-destructive__token">{expected}</span> to confirm
        </Text>
        <input
          type="text"
          className="aurora-admin-destructive__input"
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Type ${expected} to confirm`}
        />
      </label>
      <Stack direction="row" gap={2} className="aurora-admin-destructive__actions">
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={!ready}
          aria-disabled={!ready}
        >
          {confirmLabel}
        </Button>
      </Stack>
    </div>
  );
}
