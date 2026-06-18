/**
 * Aurora WS8 — Admin surface gallery.
 *
 * Exercises `<Admin>`, `<AdminDoctorCard>`, `<AdminAuditLogTable>`, and
 * `<AdminDestructiveConfirm>` with fixtures so the configuration
 * workspace can be reviewed without wiring the live meridianctl output,
 * licence worker, or audit log.
 *
 * Fixtures live in this file only — never imported into production bundles.
 */

"use client";

import { useState } from "react";
import {
  Admin,
  AdminAuditLogTable,
  AdminDestructiveConfirm,
  AdminDoctorCard,
  Button,
  Stack,
  Text,
  type AdminAuditLogEntry,
  type AdminDoctorItem,
  type AdminTabId,
} from "@/components/aurora";

/* --- fixtures --- */

const DOCTOR_ITEMS: ReadonlyArray<AdminDoctorItem> = [
  { id: "pg", label: "Postgres reachable (RLS enforced)", status: "ok", detail: "p50 4ms · p99 21ms" },
  { id: "redis", label: "Redis reachable (Celery + cache)", status: "ok", detail: "queue depth 3" },
  { id: "minio", label: "MinIO reachable (uploads bucket)", status: "ok", detail: "quota 42% used" },
  { id: "ollama", label: "Ollama LLM responsive", status: "warn", detail: "p95 4.2s (target < 2.5s) — consider warm-up" },
  { id: "licence", label: "Licence server reachable", status: "ok", detail: "expires 2026-11-14" },
  { id: "sap", label: "SAP connectors (ECC, S/4HC, SF)", status: "fail", detail: "ECC-PRD: RFC timeout after 60s — credential rotation suspected" },
  { id: "migrations", label: "Alembic migrations at head", status: "ok", detail: "latest: 033" },
];

const AUDIT_ENTRIES: ReadonlyArray<AdminAuditLogEntry> = [
  {
    id: "a-1",
    timestamp: "2026-04-23T14:02:00Z",
    displayTime: "14 min ago",
    actor: "R. Govender",
    action: "Updated role for Sarah Chen (steward → admin)",
    context: "IP 102.65.12.4 · users/update",
  },
  {
    id: "a-2",
    timestamp: "2026-04-23T13:41:00Z",
    displayTime: "35 min ago",
    actor: "system",
    action: "Ran analysis v0.0.21 — 47 findings across BP, MM",
    context: "worker.tasks.run_checks",
  },
  {
    id: "a-3",
    timestamp: "2026-04-23T11:18:00Z",
    displayTime: "2h ago",
    actor: "K. Chen",
    action: "Published Material Master rule set (rev 12)",
    context: "rules/publish · pre-prod",
  },
  {
    id: "a-4",
    timestamp: "2026-04-22T21:05:00Z",
    displayTime: "Yesterday",
    actor: "M. Oyelowo",
    action: "Rotated Ariba connector credentials",
    context: "connectivity/ariba · rotate",
  },
];

/* --- page --- */

export default function AdminPlaygroundPage() {
  const [tab, setTab] = useState<AdminTabId>("settings");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <main className="aurora-theme" data-theme="dark" style={{ minHeight: "100vh" }}>
      <Admin
        activeTab={tab}
        onActiveTabChange={setTab}
        actions={
          <>
            <Button variant="ghost" size="sm">Export config</Button>
            <Button variant="primary" size="sm">Invite user</Button>
          </>
        }
        tabs={[
          {
            id: "users",
            label: "Users & Roles",
            count: 14,
            body: (
              <Stack direction="column" gap={6}>
                <Text variant="text-body" tone="secondary">
                  14 users across 3 roles (admin, steward, viewer). Audit log below covers all
                  state changes for the last 30 days; full retention 730 days.
                </Text>
                <AdminAuditLogTable entries={AUDIT_ENTRIES} />
                {!confirmOpen ? (
                  <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                    Delete user Sarah Chen
                  </Button>
                ) : (
                  <AdminDestructiveConfirm
                    title="Delete user Sarah Chen"
                    body="This removes Sarah's access to every module and archives her assigned findings. The audit log retains a record of this change; the user cannot be restored."
                    onCancel={() => setConfirmOpen(false)}
                    onConfirm={() => {
                      setConfirmOpen(false);
                    }}
                  />
                )}
              </Stack>
            ),
          },
          {
            id: "connections",
            label: "Connections",
            count: 3,
            body: (
              <Text variant="text-body" tone="secondary">
                3 SAP connectors configured (ECC-PRD, S/4HC-QAS, SF-PRD). Doctor card on Settings
                is the canonical health view; per-connector diagnostics move here in WS8 pass 2.
              </Text>
            ),
          },
          { id: "sync", label: "Sync Monitor" },
          { id: "rules", label: "Rules", count: 541 },
          { id: "licence", label: "Licence" },
          {
            id: "settings",
            label: "Settings",
            body: (
              <Stack direction="column" gap={6}>
                <AdminDoctorCard
                  items={DOCTOR_ITEMS}
                  lastChecked="12s ago"
                  onRefresh={() => undefined}
                />
                <Text variant="text-body" tone="secondary">
                  Retention, backup, alerts, field mapping, contracts, general — one scrollable
                  surface (spec §10). Full settings body wires in WS8 pass 2.
                </Text>
              </Stack>
            ),
          },
        ]}
      />
    </main>
  );
}
