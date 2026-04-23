/**
 * Aurora · Command Centre — the verse home of Meridian.
 *
 * §11 of the spec. One sentence → inbox → trends → ask. Answers the
 * five-second CIO test the moment the operator lands.
 *
 * Data sources:
 *   • `/api/v1/mdm/dashboard`     — headline DQS + trend history.
 *   • `/api/v1/findings`          — critical + high rows for the inbox.
 *   • `/api/v1/metrics/llm-savings` — Tier-0 win strip (shown only when
 *     `isSavingsNonTrivial` holds, per spec §11 guidance).
 *
 * The surface itself is pure view — we compose the view-model via
 * `composeCommandCentre` and hand it off to <CommandCentre />.
 */

"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  Banner,
  Button,
  CommandCentre,
  EmptyState,
  isSavingsNonTrivial,
  Stack,
  Text,
} from "@/components/aurora";
import { composeCommandCentre } from "@/lib/api/command-centre";
import { getFindings } from "@/lib/api/findings";
import { getLlmSavingsSummary } from "@/lib/api/llm-savings";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";

export default function CommandCentrePage() {
  const router = useRouter();
  const mdmQuery = useQuery({
    queryKey: ["aurora.command-centre.mdm-dashboard"],
    queryFn: getMdmDashboard,
    retry: (count, err) => !(err instanceof AxiosError) || count < 1,
  });
  const savingsQuery = useQuery({
    queryKey: ["aurora.command-centre.llm-savings", 30],
    queryFn: () => getLlmSavingsSummary(30),
    retry: false,
  });
  const findingsQuery = useQuery({
    queryKey: ["aurora.command-centre.findings"],
    queryFn: () => getFindings({ limit: 200 }),
    retry: (count, err) => !(err instanceof AxiosError) || count < 1,
  });

  const vm = useMemo(
    () =>
      composeCommandCentre({
        mdm: mdmQuery.data,
        findings: findingsQuery.data,
        savings: savingsQuery.data,
      }),
    [mdmQuery.data, findingsQuery.data, savingsQuery.data],
  );

  const isLoading =
    mdmQuery.isLoading || findingsQuery.isLoading || savingsQuery.isLoading;
  const hasMdm = Boolean(mdmQuery.data?.latest);

  // First-run: no MDM snapshot exists yet. The spec insists on a
  // directional empty state — a verdict-sentence stand-in that teaches
  // what to do, never a spinner or a "No data" string.
  if (!isLoading && !hasMdm) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--aurora-space-5)",
          background: "var(--aurora-canvas-base)",
        }}
      >
        <EmptyState
          title={
            <Stack direction="column" gap={1}>
              <Text variant="text-micro" tone="tertiary">
                Aurora · Command Centre
              </Text>
              <Text variant="display-sm">Connect a system to see your verdict.</Text>
            </Stack>
          }
          body="Meridian needs one SAP system to produce the first analysis version. Three minutes — OAuth client credentials, module selection, run."
          actions={
            <Stack direction="row" gap={2} align="center">
              <Button
                size="md"
                variant="primary"
                onClick={() => router.push("/connectivity")}
              >
                Connect a system
              </Button>
              <Button
                size="md"
                variant="ghost"
                onClick={() => router.push("/upload")}
              >
                Upload a sample
              </Button>
            </Stack>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--aurora-canvas-base)" }}>
      {savingsQuery.isError ? (
        <div style={{ padding: "var(--aurora-space-3) var(--aurora-space-5) 0" }}>
          <Banner tone="warning" title="LLM-savings endpoint unreachable">
            Command Centre rendered without the savings strip — verdict, inbox, and trends are unaffected.
          </Banner>
        </div>
      ) : null}

      <CommandCentre
        verdict={vm.verdict}
        kpis={vm.kpis}
        verdictActions={
          <Stack direction="row" gap={2} align="center">
            <Button
              size="md"
              variant="primary"
              onClick={() => router.push("/findings")}
            >
              Open inbox
            </Button>
            <Button
              size="md"
              variant="ghost"
              onClick={() => router.push("/versions")}
            >
              Compare versions
            </Button>
          </Stack>
        }
        inbox={vm.inbox}
        onInboxActivate={(item) => {
          // Legacy /findings takes id via query-string; Aurora WS7 will
          // wire the record-drawer drill-through. Both share this
          // activation surface so J/K + Enter lands on the same deep
          // link regardless of which workspace the user is in.
          router.push(`/findings?finding=${encodeURIComponent(item.id)}`);
        }}
        trend={vm.trend}
        issues={vm.issues}
        ask={{
          // Ask wiring lands in WS7 alongside the Workbench drawer; the
          // playground page demonstrates the streaming contract.
          question: "Ask Meridian about this verdict",
          answer:
            'Ask is coming online with the Workbench drawer in WS7. The streaming contract is wired — try the gallery ("Why did DQS dip this week?") to see how answers land in < 1 s with inline citations.',
          status: "idle",
        }}
        llmSavings={isSavingsNonTrivial(vm.llmSavings) ? vm.llmSavings : undefined}
      />
    </div>
  );
}
