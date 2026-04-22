/**
 * Aurora WS4 shell-primitive gallery.
 *
 * Renders AppShell, WorkspaceSwitcher, CommandPalette, Tabs, Breadcrumb,
 * and Drawer against realistic scenarios. Opens the palette on ⌘K, drops
 * a record Drawer on row click, and binds the drawer state to the URL via
 * `useDrawerParam`.
 */

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AppShell,
  Breadcrumb,
  Button,
  CommandPalette,
  type CommandPaletteCommand,
  Chip,
  DataTable,
  Drawer,
  KpiRail,
  Stack,
  Stat,
  Tabs,
  Text,
  useDrawerParam,
  WorkspaceSwitcher,
  type WorkspaceId,
  type WorkspaceSwitcherItem,
} from "@/components/aurora";
import { auroraSapIcons } from "@/lib/aurora/icons";
import type { ColumnDef } from "@tanstack/react-table";

const WORKSPACES: WorkspaceSwitcherItem[] = [
  {
    id: "command-centre",
    label: "Command Centre",
    shortcut: "⌘1",
    href: "/_design-playground/shell?ws=command-centre",
    icon: <auroraSapIcons.financeLedger />,
  },
  {
    id: "workbench",
    label: "Workbench",
    shortcut: "⌘2",
    href: "/_design-playground/shell?ws=workbench",
    icon: <auroraSapIcons.businessPartner />,
  },
  {
    id: "process",
    label: "Process",
    shortcut: "⌘3",
    href: "/_design-playground/shell?ws=process",
    icon: <auroraSapIcons.workflowNode />,
  },
  {
    id: "admin",
    label: "Admin",
    shortcut: "⌘4",
    href: "/_design-playground/shell?ws=admin",
    icon: <auroraSapIcons.companyCode />,
  },
];

interface TriageRow {
  id: string;
  name: string;
  module: string;
  severity: "critical" | "high" | "medium";
  dqs: number;
}

const ROWS: TriageRow[] = Array.from({ length: 24 }, (_, i) => ({
  id: `r-${String(1000 + i)}`,
  name: `Record ${1000 + i}`,
  module: ["BP", "MM", "FI", "SD", "HR"][i % 5],
  severity: (["critical", "high", "medium"] as const)[i % 3],
  dqs: 92 - (i % 20),
}));

export default function ShellPlayground() {
  const [active] = useState<WorkspaceId>("workbench");
  const [tab, setTab] = useState("triage");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const drawer = useDrawerParam("record");
  const focusedRow = useMemo(
    () => ROWS.find((row) => row.id === drawer.value) ?? null,
    [drawer.value],
  );

  const commands: CommandPaletteCommand[] = useMemo(
    () => [
      {
        id: "go-inbox",
        group: "Go to",
        label: "Inbox",
        hint: "⌘1",
        onRun: () => undefined,
      },
      {
        id: "go-workbench",
        group: "Go to",
        label: "Workbench",
        hint: "⌘2",
        onRun: () => undefined,
      },
      {
        id: "go-process",
        group: "Go to",
        label: "Process",
        hint: "⌘3",
        onRun: () => undefined,
      },
      ...ROWS.slice(0, 8).map((row) => ({
        id: `open-${row.id}`,
        group: "Jump to record",
        label: `${row.id} · ${row.name}`,
        keywords: [row.module, row.severity],
        onRun: () => drawer.open(row.id),
      })),
    ],
    [drawer],
  );

  const columns = useMemo<ColumnDef<TriageRow, unknown>[]>(
    () => [
      {
        id: "id",
        header: "Record",
        accessorKey: "id",
        meta: { sticky: "start", width: 140 },
      },
      { id: "name", header: "Name", accessorKey: "name", meta: { width: 180 } },
      {
        id: "module",
        header: "Module",
        accessorKey: "module",
        meta: { width: 120 },
      },
      {
        id: "severity",
        header: "Severity",
        accessorKey: "severity",
        meta: { width: 120 },
      },
      {
        id: "dqs",
        header: "DQS",
        accessorKey: "dqs",
        meta: { width: 96, numeric: true, align: "end" },
      },
    ],
    [],
  );

  return (
    <div
      data-theme="dark"
      data-density="default"
      style={{ background: "var(--aurora-canvas-base)" }}
    >
      <AppShell
        rail={
          <WorkspaceSwitcher
            items={WORKSPACES}
            active={active}
            renderLink={({ href, children, className, ...rest }) => (
              <Link href={href} className={className} {...rest}>
                {children}
              </Link>
            )}
          />
        }
        topBar={
          <Stack direction="row" align="center" gap={4} justify="between" className="aurora-topbar__row" >
            <Breadcrumb
              items={[
                { label: "Workbench", href: "#" },
                { label: "Triage", href: "#" },
                { label: "All records" },
              ]}
            />
            <Stack direction="row" gap={2} align="center">
              <Chip tone="neutral">Prod · EMEA</Chip>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPaletteOpen(true)}
                trailingIcon={
                  <span className="aurora-command-palette__hint">
                    <kbd>⌘K</kbd>
                  </span>
                }
              >
                Search or jump
              </Button>
            </Stack>
          </Stack>
        }
      >
        <div style={{ padding: 32 }}>
          <Stack direction="column" gap={5}>
            <Stack direction="column" gap={1}>
              <Text variant="text-micro" tone="tertiary">
                §9 — shell gallery (WS4)
              </Text>
              <Text variant="display-lg">Workbench · Triage</Text>
              <Text variant="text-lead" tone="secondary">
                Shell frames the four workspaces. Press ⌘K for the palette,
                click a row to open the URL-routable drawer, use arrow keys in
                the tab bar.
              </Text>
            </Stack>

            <KpiRail>
              <Stat
                label="Open · workbench"
                value="428"
                delta={{ value: -2.1, direction: "down", semantic: "success" }}
              />
              <Stat
                label="Assigned to me"
                value="17"
                tone="info"
                delta={{ value: 3, direction: "up" }}
              />
              <Stat
                label="Aged > 48h"
                value="6"
                tone="warning"
                delta={{ value: 0, direction: "flat" }}
              />
              <Stat
                label="Readiness · area"
                value="81"
                unit="/ 100"
                delta={{ value: 1.2, direction: "up", semantic: "success" }}
              />
            </KpiRail>

            <Tabs
              ariaLabel="Workbench tabs"
              items={[
                { id: "triage", label: "Triage", count: ROWS.length },
                { id: "golden", label: "Golden records", count: 42 },
                { id: "glossary", label: "Glossary", count: 128 },
                { id: "reports", label: "Reports", count: 6 },
              ]}
              value={tab}
              onValueChange={setTab}
            />

            <DataTable
              data={ROWS}
              columns={columns}
              getRowId={(row) => row.id}
              onRowActivate={(row) => drawer.open(row.id)}
              onRowFocus={() => undefined}
              ariaLabel="Triage list"
              maxHeight={360}
            />
          </Stack>
        </div>
      </AppShell>

      <CommandPalette
        commands={commands}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />

      <Drawer
        open={Boolean(focusedRow)}
        onClose={drawer.close}
        header={
          focusedRow ? (
            <Stack direction="column" gap={1}>
              <Text variant="text-micro" tone="tertiary">
                {focusedRow.module}
              </Text>
              <Text variant="display-sm">{focusedRow.name}</Text>
              <Stack direction="row" gap={2}>
                <Chip tone="danger">{focusedRow.severity}</Chip>
                <Chip tone="neutral">DQS {focusedRow.dqs}</Chip>
              </Stack>
            </Stack>
          ) : null
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={drawer.close}>
              Close
            </Button>
            <Button variant="secondary" size="sm">
              Escalate
            </Button>
            <Button variant="primary" size="sm">
              Approve
            </Button>
          </>
        }
        ariaLabel="Record drawer"
      >
        <Text variant="text-body" tone="secondary">
          Full record context will be rendered by the Workbench drawer surface
          in WS7. This gallery exercises the URL-routable open/close contract
          only — use browser Back / Forward to reproduce the drawer state.
        </Text>
      </Drawer>
    </div>
  );
}
