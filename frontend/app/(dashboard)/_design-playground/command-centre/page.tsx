/**
 * Aurora WS6 — Command Centre surface gallery.
 *
 * Exercises <CommandCentre> with realistic fixtures so the surface can
 * be reviewed without a populated backend. Fixtures live inside this
 * page so they can never drift into production bundles.
 *
 * The "Use live data" toggle swaps fixtures for real react-query
 * fetches via `composeCommandCentre` — the same aggregator the live
 * `/command-centre` page consumes. Verdict sentence is composed by
 * `buildVerdict`.
 */

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  Button,
  buildVerdict,
  CommandCentre,
  type CommandCentreInboxItem,
  type CommandCentreIssueBucket,
  type CommandCentreKpi,
  type CommandCentreTrendPoint,
  Stack,
  Text,
} from "@/components/aurora";
import { composeCommandCentre } from "@/lib/api/command-centre";
import { getFindings } from "@/lib/api/findings";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";

/* -------------------------------------------------------------- Fixtures */

const FIXTURE_TREND: ReadonlyArray<CommandCentreTrendPoint> = [
  { date: "2026-03-23", dqs: 81.2 },
  { date: "2026-03-30", dqs: 80.4 },
  { date: "2026-04-06", dqs: 79.1 },
  { date: "2026-04-13", dqs: 78.9 },
  { date: "2026-04-20", dqs: 78.4 },
];

const FIXTURE_INBOX: ReadonlyArray<CommandCentreInboxItem> = [
  {
    id: "bp-001",
    headline: "Business Partner · tax_number missing for 312 records",
    module: "business_partner",
    severity: "critical",
    age: "3h",
    affected: 312,
  },
  {
    id: "mm-004",
    headline: "Material Master · UoM conversion missing — blocks MIGO",
    module: "material_master",
    severity: "critical",
    age: "5h",
    affected: 87,
  },
  {
    id: "ap-007",
    headline: "Accounts Payable · IBAN invalid for 48 vendors",
    module: "accounts_payable",
    severity: "high",
    age: "7h",
    affected: 48,
  },
  {
    id: "sd-012",
    headline: "Sales Orders · pricing condition stale > 90 days",
    module: "sd_sales_orders",
    severity: "high",
    age: "1d",
    affected: 1204,
  },
  {
    id: "fi-019",
    headline: "FI-GL · cost-centre mapping drifted from SPRO baseline",
    module: "fi_gl",
    severity: "medium",
    age: "1d",
    affected: 22,
  },
];

const FIXTURE_ISSUES: ReadonlyArray<CommandCentreIssueBucket> = [
  { severity: "critical", count: 2 },
  { severity: "high", count: 11 },
  { severity: "medium", count: 38 },
  { severity: "low", count: 142 },
];

const FIXTURE_VERDICT = buildVerdict({
  dqs: 78.4,
  previousDqs: 80.1,
  critical: 2,
  high: 11,
  topModule: "Business Partner",
});

const FIXTURE_KPIS: ReadonlyArray<CommandCentreKpi> = [
  {
    id: "dqs",
    label: "DQS",
    value: "78.4",
    delta: { value: -1.7, direction: "down", semantic: "danger" },
  },
  { id: "critical", label: "Critical", value: "2", tone: "danger" },
  { id: "high", label: "High", value: "11", tone: "warning" },
  { id: "records", label: "Golden records", value: "2,400,000" },
];

/* --------------------------------------------------------------- Page */

export default function CommandCentrePlaygroundPage() {
  const [useLive, setUseLive] = useState(false);
  const [arrivalShown, setArrivalShown] = useState(true);

  const mdmQuery = useQuery({
    queryKey: ["playground.mdm-dashboard"],
    queryFn: getMdmDashboard,
    enabled: useLive,
    retry: false,
  });
  const findingsQuery = useQuery({
    queryKey: ["playground.findings"],
    queryFn: () => getFindings({ limit: 200 }),
    enabled: useLive,
    retry: (count, err) => !(err instanceof AxiosError) || count < 1,
  });

  const live = useMemo(
    () =>
      composeCommandCentre({
        mdm: mdmQuery.data,
        findings: findingsQuery.data,
      }),
    [mdmQuery.data, findingsQuery.data],
  );

  const verdict = useLive ? live.verdict : FIXTURE_VERDICT;
  const kpis = useLive ? live.kpis : FIXTURE_KPIS;
  const inbox = useLive ? live.inbox : FIXTURE_INBOX;
  const trend = useLive && live.trend.length > 0 ? live.trend : FIXTURE_TREND;
  const issues = useLive ? live.issues : FIXTURE_ISSUES;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--aurora-canvas-base)" }}>
      <header
        style={{
          padding: "var(--aurora-space-4) var(--aurora-space-5)",
          borderBottom: "1px solid var(--aurora-canvas-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--aurora-space-4)",
        }}
      >
        <Stack direction="column" gap={1}>
          <Text variant="text-micro" tone="tertiary">
            Aurora · WS6 gallery
          </Text>
          <Text variant="text-lead">Command Centre — verdict → inbox → trends</Text>
        </Stack>
        <Stack direction="row" gap={2} align="center">
          <Text variant="text-small" tone="secondary" as="span">
            {useLive ? "Live data" : "Fixture data"}
          </Text>
          <Button
            size="sm"
            variant={useLive ? "primary" : "ghost"}
            onClick={() => setUseLive((prev) => !prev)}
          >
            {useLive ? "Switch to fixture" : "Use live data"}
          </Button>
        </Stack>
      </header>

      <CommandCentre
        arrival={
          arrivalShown
            ? {
                eyebrow: "Aurora",
                title: "Welcome back. Verdict first, decisions second.",
                body: "This is the Command Centre — one sentence tells you what's happening across every SAP system you connected.",
                onDismiss: () => setArrivalShown(false),
              }
            : undefined
        }
        verdict={verdict}
        kpis={kpis}
        verdictActions={
          <Stack direction="row" gap={2} align="center">
            <Button size="md" variant="primary">
              Open inbox
            </Button>
            <Button size="md" variant="ghost">
              Compare versions
            </Button>
          </Stack>
        }
        inbox={inbox}
        onInboxActivate={(item) => {
          // eslint-disable-next-line no-console -- playground affordance
          console.info("Command Centre · inbox activate", item.id, item.module);
        }}
        trend={trend}
        issues={issues}
      />
    </div>
  );
}
