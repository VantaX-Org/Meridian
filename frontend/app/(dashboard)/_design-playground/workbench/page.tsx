/**
 * Aurora WS7 — Workbench surface gallery.
 *
 * Exercises `<Workbench>` with realistic fixtures so the triage table,
 * drawer, and tabs can be reviewed without a populated backend. Fixtures
 * live inside this page so they cannot drift into production bundles.
 *
 * Keyboard contract exercised in-page:
 *   • Click / Enter on a row → drawer opens.
 *   • J / ↓, K / ↑ inside the drawer steps through the triage list.
 *   • Esc closes the drawer.
 *
 * No `"Use live data"` toggle yet — live wiring arrives in pass 2 once
 * the aggregator contracts stabilise.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  FixPlaybook,
  Stack,
  Text,
  Workbench,
  WorkbenchDrawerHeader,
  type WorkbenchFilter,
  type WorkbenchRow,
  type WorkbenchSavedView,
  type WorkbenchTabId,
  type WorkbenchTabState,
} from "@/components/aurora";

/* -------------------------------------------------------------- Fixtures */

const FIXTURE_ROWS: ReadonlyArray<WorkbenchRow> = [
  {
    id: "f-1",
    recordId: "BP-1203187",
    headline: "Vendor account group references unconfigured value 0099",
    module: "Business Partner",
    severity: "critical",
    status: "open",
    age: "14m",
    assignee: null,
    blocking: 4,
    // Demonstrates PR F root_cause surfaced as a config-origin mark
    origin: { rootCauseType: "bad_config" },
  },
  {
    id: "f-2",
    recordId: "EKKO-4500028",
    headline: "PO payment terms drift from vendor master (XP2P001)",
    module: "Procure-to-Pay",
    severity: "high",
    status: "in_progress",
    age: "1h",
    assignee: "R. Sato",
    blocking: 2,
    // Demonstrates PR D cross-module surfaced in the triage row
    origin: { crossModule: true, rootCauseType: "bad_data" },
  },
  {
    id: "f-3",
    recordId: "MM-55221",
    headline: "Base unit of measure missing — blocks inventory valuation",
    module: "Material Master",
    severity: "critical",
    status: "open",
    age: "3h",
    assignee: null,
    blocking: 5,
  },
  {
    id: "f-4",
    recordId: "LFA1-V104512",
    headline: "Supplier risk score out of range on Z-field",
    module: "Vendor Master",
    severity: "medium",
    status: "open",
    age: "4h",
    assignee: "K. Chen",
    blocking: 1,
    // Demonstrates PR E customer namespace (Z-table) marker
    origin: { customerNamespace: true },
  },
  {
    id: "f-5",
    recordId: "CU-9017",
    headline: "Customer credit limit exceeds VaR threshold by 18%",
    module: "Customer Master",
    severity: "high",
    status: "escalated",
    age: "2d",
    assignee: "M. Oyelowo",
    blocking: 3,
  },
  {
    id: "f-6",
    recordId: "GL-104400",
    headline: "G/L account description in English missing",
    module: "FI-G/L",
    severity: "low",
    status: "open",
    age: "2d",
    assignee: null,
    blocking: 1,
  },
  {
    id: "f-7",
    recordId: "AP-72118",
    headline: "Vendor bank IBAN check digit invalid",
    module: "Accounts Payable",
    severity: "critical",
    status: "in_progress",
    age: "3d",
    assignee: "R. Sato",
    blocking: 2,
  },
  {
    id: "f-8",
    recordId: "BP-1203088",
    headline: "Address country mismatch with tax jurisdiction",
    module: "Business Partner",
    severity: "medium",
    status: "resolved",
    age: "4d",
    assignee: "K. Chen",
    blocking: 0,
  },
];

const FIXTURE_SAVED_VIEWS: ReadonlyArray<WorkbenchSavedView> = [
  { id: "v-mine", label: "Mine", count: 14, active: true },
  { id: "v-critical", label: "Critical", count: 4 },
  { id: "v-de", label: "Germany · Tax gaps", count: 27 },
];

const FIXTURE_TABS: ReadonlyArray<WorkbenchTabState> = [
  { id: "triage", label: "Triage", count: FIXTURE_ROWS.length },
  { id: "golden-records", label: "Golden records", count: 1208 },
  { id: "glossary", label: "Glossary", count: 412 },
  { id: "analyses", label: "Analyses", count: 32 },
  { id: "reports", label: "Reports", count: 18 },
];

/* ------------------------------------------------------------------ Page */

export default function WorkbenchPlayground() {
  const [activeTab, setActiveTab] = useState<WorkbenchTabId>("triage");
  const [selected, setSelected] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());

  const filters: ReadonlyArray<WorkbenchFilter> = useMemo(
    () =>
      ["critical", "high", "medium", "low"].map((sev) => ({
        id: sev,
        label: `${sev[0].toUpperCase()}${sev.slice(1)}`,
        count: FIXTURE_ROWS.filter((r) => r.severity === sev).length,
        active: severityFilter.has(sev),
        onToggle: () =>
          setSeverityFilter((prev) => {
            const next = new Set(prev);
            if (next.has(sev)) {
              next.delete(sev);
            } else {
              next.add(sev);
            }
            return next;
          }),
      })),
    [severityFilter],
  );

  const filteredRows = useMemo(() => {
    if (severityFilter.size === 0) return FIXTURE_ROWS;
    return FIXTURE_ROWS.filter((row) => severityFilter.has(row.severity));
  }, [severityFilter]);

  const selectedRow = useMemo(
    () =>
      selected ? FIXTURE_ROWS.find((r) => r.id === selected) ?? null : null,
    [selected],
  );

  const selectedIndex = useMemo(
    () =>
      selected
        ? filteredRows.findIndex((r) => r.id === selected)
        : -1,
    [filteredRows, selected],
  );

  const onSelectedStep = useCallback(
    (delta: 1 | -1) => {
      if (filteredRows.length === 0 || selectedIndex < 0) return;
      const next =
        (selectedIndex + delta + filteredRows.length) % filteredRows.length;
      setSelected(filteredRows[next]!.id);
    },
    [filteredRows, selectedIndex],
  );

  const critical = FIXTURE_ROWS.filter((r) => r.severity === "critical").length;
  const high = FIXTURE_ROWS.filter((r) => r.severity === "high").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Stack direction="column" gap={2}>
        <Text variant="text-micro" tone="tertiary">
          AURORA · WS7 · WORKBENCH
        </Text>
        <Text variant="display-sm">
          Triage queue, record drawer, and the four Workbench tabs.
        </Text>
        <Text variant="text-small" tone="secondary">
          Filter by severity using the chip row, then press Enter on a row to
          open the drawer. J / ↓ and K / ↑ walk the list while the drawer is
          open.
        </Text>
      </Stack>

      <Workbench
        verdict={{
          eyebrow: `OPEN · ${FIXTURE_ROWS.length}`,
          sentence: `${critical} critical ${
            critical === 1 ? "finding is" : "findings are"
          } blocking master-data operations; ${high} high-severity ${
            high === 1 ? "finding needs" : "findings need"
          } a steward.`,
          support: "Business Partner and Material Master carry the backlog.",
          semantic: critical > 0 ? "danger" : high > 0 ? "warning" : "success",
          actions: (
            <>
              <Button variant="primary" size="sm">
                Approve safe fixes
              </Button>
              <Button variant="ghost" size="sm">
                Escalate selection
              </Button>
            </>
          ),
        }}
        tabs={FIXTURE_TABS}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        filters={filters}
        savedViews={FIXTURE_SAVED_VIEWS}
        onSavedViewActivate={(view) => {
          setSeverityFilter(
            view.id === "v-critical" ? new Set(["critical"]) : new Set(),
          );
        }}
        rows={filteredRows}
        onRowActivate={(row) => setSelected(row.id)}
        selected={selected}
        onSelectedChange={setSelected}
        onSelectedStep={onSelectedStep}
        drawerHeader={
          selectedRow ? (
            <WorkbenchDrawerHeader
              recordId={selectedRow.recordId}
              title={selectedRow.headline}
              severity={selectedRow.severity}
              status={selectedRow.status}
              support={`${selectedRow.module} · ${selectedRow.age} ago`}
            />
          ) : null
        }
        drawer={
          selectedRow ? (
            <Stack direction="column" gap={4}>
              <Stack direction="column" gap={2}>
                <Text variant="text-micro" tone="tertiary">
                  Record summary
                </Text>
                <Text variant="text-body">
                  Pass-rate on{" "}
                  <Text variant="text-body" numeric as="span">
                    {selectedRow.blocking}
                  </Text>{" "}
                  blocking checks is below the policy floor for this module.
                </Text>
              </Stack>

              <FixPlaybook
                title="Three-step remediation"
                steps={[
                  {
                    id: "s1",
                    label: "Pull canonical value from SAP SPRO reference",
                    status: "done",
                  },
                  {
                    id: "s2",
                    label: "Apply to the affected record and ten siblings",
                    status: "running",
                  },
                  {
                    id: "s3",
                    label: "Re-score and notify downstream consumers",
                    status: "pending",
                  },
                ]}
              />
            </Stack>
          ) : null
        }
        drawerFooter={
          selectedRow ? (
            <Stack direction="row" gap={2}>
              <Button variant="primary" size="sm">
                Approve
              </Button>
              <Button variant="ghost" size="sm">
                Escalate
              </Button>
              <Button variant="ghost" size="sm">
                Reject
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                Close
              </Button>
            </Stack>
          ) : null
        }
      />
    </div>
  );
}
