"use client";

/**
 * Process → Readiness: the L1–L5 process readiness document on the Aurora
 * ProcessReport surface. Every level's score is the share of its L5 fields
 * whose data-quality status is green; blocking findings are the red fields,
 * each linking to the failing records; config alignment comes from the 52
 * feature-impact rules for the same version. Recommendations are derived
 * from the red L3 gates — no LLM.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { EmptyState, FilterBar, TableSkeleton, Tally } from "@/components/ui-core";
import { FeaturesTable } from "@/components/process/features";
import { useFindingHref } from "@/components/process/shared";
import {
  ProcessReport, Select, type ProcessReportBlockingFinding, type ProcessReportHierarchyNode,
  type ProcessReportReadiness, type ProcessReportRecommendation,
} from "@/components/aurora";
import { getBusinessProcess, getConfigImpact } from "@/lib/api/connectivity";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";
import type { BusinessProcessL1, BusinessProcessL5Field, Version } from "@/types/api";

const COMPLETE = new Set(["complete", "agents_running", "agents_complete", "agents_failed", "ai_enriching", "ai_enriched"]);
const isComplete = (v: Version) => COMPLETE.has(v.status) && !!v.dqs_summary && Object.keys(v.dqs_summary).length > 0;

function fields(l1: BusinessProcessL1): BusinessProcessL5Field[] {
  return l1.l2_groups.flatMap((l2) => l2.l3_processes.flatMap((l3) => l3.l4_steps.flatMap((l4) => l4.l5_fields)));
}
const score = (fs: BusinessProcessL5Field[]) => (fs.length ? Math.round((fs.filter((f) => f.dq_status === "green").length / fs.length) * 100) : 100);
const red = (fs: BusinessProcessL5Field[]) => fs.filter((f) => f.dq_status === "red").length;
const semantic = (pct: number, blocking: number): ProcessReportReadiness => (blocking ? "blocked" : pct >= 90 ? "ready" : "at-risk");
const sev = (f: BusinessProcessL5Field): "critical" | "high" | "medium" => (f.mandatory ? "critical" : (f.pass_rate ?? 100) < 50 ? "high" : "medium");

export function ProcessReadiness() {
  const versions = useQuery({ queryKey: ["versions.list", { limit: 20 }], queryFn: () => getVersions({ limit: 20 }) });
  const latest = useMemo(() => versions.data?.versions.find(isComplete), [versions.data]);
  const modules = useMemo(() => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []), [latest]);
  const [objectChoice, setObject] = useState<string>("");
  const object = objectChoice || modules[0] || "";
  const bp = useQuery({ queryKey: ["business-process", latest?.id, object], enabled: !!latest && !!object,
    queryFn: () => getBusinessProcess(latest!.id, object) });
  const impact = useQuery({ queryKey: ["config-impact", latest?.id], enabled: !!latest, retry: false,
    queryFn: () => getConfigImpact(latest!.id), meta: { ignoreError: true } });
  const findingHref = useFindingHref(latest?.id);
  const [l1Choice, setL1] = useState<string>("");
  const processes = bp.data ?? [];
  const l1 = processes.find((p) => p.l1_id === l1Choice) ?? processes[0];

  if (versions.isLoading || bp.isLoading) return <div className="ui-page"><TableSkeleton rows={8} label="Loading process readiness" /></div>;
  if (!latest) {
    return (
      <div className="ui-page">
        <EmptyState action={<Link className="ui-link" href="/sync">Open sync</Link>}>
          Readiness is read from the latest completed analysis. Download an object or import a file and run the checks.
        </EmptyState>
      </div>
    );
  }

  const objectPicker = (
    <Select aria-label="Object" value={object} options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))}
      onValueChange={(m) => { setObject(m); setL1(""); }} />
  );
  const versionNote = <span className="ui-micro">Version {latest.label ?? latest.id.slice(0, 8)}, run {new Date(latest.run_at).toLocaleString()}</span>;
  if (!l1) {
    return (
      <div className="ui-page">
        <FilterBar actions={versionNote}>{objectPicker}</FilterBar>
        <EmptyState>
          {formatModuleName(object)} has no process definition. Readiness covers the objects with an L1 to L5 definition, such as procure to pay and order to cash.
        </EmptyState>
      </div>
    );
  }

  const all = fields(l1);
  const pct = score(all);
  const blocking = red(all);
  const checkIds = new Set(all.filter((f) => f.check_id).map((f) => f.check_id as string));

  const hierarchy: ProcessReportHierarchyNode[] = [{
    level: 1, id: l1.l1_id, label: l1.l1_name, module: l1.system, score: pct, blocking,
    children: l1.l2_groups.map((l2) => {
      const f2 = l2.l3_processes.flatMap((l3) => l3.l4_steps.flatMap((l4) => l4.l5_fields));
      return {
        level: 2 as const, id: l2.l2_id, label: l2.l2_name, score: score(f2), blocking: red(f2),
        children: l2.l3_processes.map((l3) => {
          const f3 = l3.l4_steps.flatMap((l4) => l4.l5_fields);
          return {
            level: 3 as const, id: l3.l3_id, label: `${l3.l3_name} (${l3.tcode})`, score: score(f3), blocking: red(f3),
            children: l3.l4_steps.map((l4) => ({
              level: 4 as const, id: l4.l4_id, label: l4.l4_name, score: score(l4.l5_fields), blocking: red(l4.l5_fields),
              children: l4.l5_fields.map((f) => ({
                level: 5 as const, id: `${l4.l4_id}-${f.field}`, label: `${f.field}${f.mandatory ? ", mandatory" : ""}`,
                module: f.config_source, score: f.pass_rate ?? (f.dq_status === "green" ? 100 : 0), blocking: f.dq_status === "red" ? 1 : 0,
              })),
            })),
          };
        }),
      };
    }),
  }];

  const blockingFindings: ProcessReportBlockingFinding[] = l1.l2_groups.flatMap((l2) => l2.l3_processes.flatMap((l3) =>
    l3.l4_steps.flatMap((l4) => l4.l5_fields.filter((f) => f.dq_status === "red").map((f) => ({
      id: `${l3.l3_id}-${l4.l4_id}-${f.field}`, severity: sev(f), checkId: f.check_id ?? f.field,
      title: f.finding_message || f.description, gate: `${l3.l3_name} (${l3.tcode})`, affected: f.affected_count,
      href: f.check_id ? findingHref(object, f.check_id) : undefined,
    })))));

  const configAlignment = (impact.data?.results ?? [])
    .filter((r) => r.blocking_findings.some((b) => checkIds.has(b.check_id)) || r.status === "ok")
    .slice(0, 40)
    .map((r) => ({ id: `${r.system}-${r.feature}`, spro: r.blocked_transactions.join(", ") || r.system, feature: r.feature,
      status: (r.status === "ok" ? "aligned" : r.status) as "blocked" | "degraded" | "aligned",
      findings: r.blocking_findings.filter((b) => checkIds.has(b.check_id)).length }));

  const recommendations: ProcessReportRecommendation[] = l1.l2_groups.flatMap((l2) => l2.l3_processes
    .filter((l3) => l3.overall_readiness !== "green")
    .map((l3) => {
      const f3 = l3.l4_steps.flatMap((l4) => l4.l5_fields);
      const reds = f3.filter((f) => f.dq_status === "red");
      const records = reds.reduce((a, f) => a + f.affected_count, 0);
      return {
        id: l3.l3_id,
        label: reds.length ? `Clear ${reds.length} failing field${reds.length === 1 ? "" : "s"} in ${l3.l3_name} (${l3.tcode})`
          : `Review the amber fields in ${l3.l3_name} (${l3.tcode})`,
        effort: (records > 500 ? "high" : records > 50 ? "medium" : "low") as "low" | "medium" | "high",
        rationale: reds.length ? `${records.toLocaleString()} records fail ${Array.from(new Set(reds.map((f) => f.check_id).filter(Boolean))).join(", ")}` : "No field is red; amber fields have partial pass rates.",
      };
    }));

  const gates = new Set(blockingFindings.map((b) => b.gate)).size;
  const failing = blockingFindings.reduce((a, b) => a + (b.affected ?? 0), 0);
  const verdict = blocking
    ? `${l1.l1_name} is ${pct}% ready; ${blocking} field${blocking === 1 ? "" : "s"} block${blocking === 1 ? "s" : ""} ${gates} gate${gates === 1 ? "" : "s"}.`
    : pct >= 90 ? `${l1.l1_name} is ready: ${pct}% of its fields pass.` : `${l1.l1_name} is ${pct}% ready with no blocking fields.`;

  return (
    <div className="ui-page">
      <FilterBar actions={versionNote}>
        {objectPicker}
        {processes.length > 1 ? (
          <Select aria-label="Process" value={l1.l1_id} options={processes.map((p) => ({ value: p.l1_id, label: p.l1_name }))} onValueChange={setL1} />
        ) : null}
      </FilterBar>
      <Tally level={2} label={`${l1.l1_name} readiness`} figures={[
        { label: "Ready", value: pct, unit: "%", href: "/process?tab=readiness", tone: blocking ? "danger" : pct >= 90 ? "success" : "warning",
          verdict: pct >= 90 ? "Share of fields that pass." : "Below the go-live line of 90%." },
        { label: "Blocking fields", value: blocking, href: "/process?tab=readiness", tone: blocking ? "danger" : undefined,
          verdict: blocking ? "Fields failing a mandatory check." : "Nothing blocks go-live." },
        { label: "Gates blocked", value: gates, href: "/process?tab=readiness", tone: gates ? "danger" : undefined,
          verdict: gates ? "Transactions that cannot run clean." : "Every gate is clear." },
        { label: "Records failing", value: failing, href: "/process?tab=readiness",
          verdict: failing ? "Behind the blocking fields." : "No records fail these fields." },
      ]} />
      <ProcessReport
        processName={l1.l1_name}
        verdict={verdict}
        support={l1.l1_description}
        readiness={pct}
        readinessSemantic={semantic(pct, blocking)}
        lastUpdated={new Date(latest.run_at).toLocaleDateString("en-GB")}
        hierarchy={hierarchy}
        configAlignment={configAlignment}
        blockingFindings={blockingFindings}
        recommendations={recommendations}
      />
      {impact.data ? <FeaturesTable results={impact.data.results} versionId={latest.id} /> : null}
    </div>
  );
}
