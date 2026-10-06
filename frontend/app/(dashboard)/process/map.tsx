"use client";

/**
 * Process map: the mined activity graph for one module of the latest complete
 * version. Each step carries the worst state of the checks on its fields
 * (red: a critical or high finding, or under 70% pass; amber: medium, or
 * under 95%; green otherwise), so colour on the map is defect state only.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery } from "@tanstack/react-query";
import {
  Banner, DetailDrawer, EmptyState, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, Tabs, Tally, useDrawerParam, type Status,
} from "@/components/ui-core";
import { ProcessGraph, ProcessGraphEmergence } from "@/components/aurora";
import { useFindingHref, useLatestVersion } from "@/components/process/shared";
import { getMiningGraph, type MiningActivity, type MiningVariant } from "@/lib/api/process-mining";
import { getBusinessProcess } from "@/lib/api/connectivity";
import { formatModuleName } from "@/lib/format";


const STEP: Record<MiningActivity["step_status"], { status: Status; label: string }> = {
  green: { status: "ok", label: "Passing" },
  amber: { status: "medium", label: "Some fields failing" },
  red: { status: "critical", label: "Blocking failures" },
};

const READINESS: Record<MiningVariant["readiness"], string> = { green: "Ready", amber: "At risk", red: "Blocked" };

const ALIGN = { green: "aligned", amber: "drifting", red: "blocked" } as const;
const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n * 100)}%`);
const plural = (n: number, w: string, many = `${w}s`) => `${n.toLocaleString()} ${n === 1 ? w : many}`;


/* Objects with a process definition (Procure to Pay, Order to Cash) in api/services/process_writer.py. */
const MAPPED = new Set(["accounts_payable", "accounts_receivable", "fi_gl", "material_master", "mm_purchasing", "sd_customer_master", "sd_sales_orders"]);

export function ProcessMapPage() {
  const { latest, isLoading, error } = useLatestVersion();
  const versionsQ = { isLoading, error };
  const analysed = useMemo(() => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []), [latest]);
  const modules = useMemo(() => analysed.filter((m) => MAPPED.has(m)), [analysed]);
  const unmapped = analysed.filter((m) => !MAPPED.has(m));
  const [module, setModule] = useUrlState("module");
  const active = module || modules[0] || null;

  const graphQ = useQuery({
    queryKey: ["process.mining-graph", latest?.id, active],
    queryFn: () => getMiningGraph(latest!.id, active!),
    enabled: !!latest && !!active,
  });

  const activities = useMemo(() => graphQ.data?.activities ?? [], [graphQ.data]);
  const transitions = useMemo(() => graphQ.data?.transitions ?? [], [graphQ.data]);
  const variants = graphQ.data?.variants ?? [];
  const bottlenecks = activities.filter((a) => a.step_status !== "green").sort((a, b) => b.affected_records - a.affected_records);
  const blocked = activities.filter((a) => a.step_status === "red").length;
  const degraded = activities.filter((a) => a.step_status === "amber").length;
  const drawer = useDrawerParam("node");
  const findingHref = useFindingHref(latest?.id);
  const bpQ = useQuery({
    queryKey: ["business-process", latest?.id, active], enabled: !!latest && !!active && !!drawer.value, retry: false,
    queryFn: () => getBusinessProcess(latest!.id, active!), meta: { ignoreError: true },
  });
  const picked = drawer.value ? activities.find((a) => a.id === drawer.value) ?? null : null;
  const pickedFields = useMemo(() => (bpQ.data ?? []).flatMap((p) => p.l2_groups.flatMap((g) => g.l3_processes.flatMap((l3) =>
    l3.l4_steps.filter((s) => s.l4_id === drawer.value).flatMap((s) => s.l5_fields)))).filter((f) => f.dq_status !== "green"),
  [bpQ.data, drawer.value]);
  const graphNodes = useMemo(() => activities.map((a) => ({
    id: a.id,
    data: { label: a.label, kind: "transform" as const, alignment: ALIGN[a.step_status] ?? "unknown", stepId: a.tcode ?? undefined, secondary: plural(a.affected_records, "record") },
  })), [activities]);
  const graphEdges = useMemo(() => transitions.map((t, i) => ({ id: `${t.from}-${t.to}-${i}`, source: t.from, target: t.to, label: t.weight.toLocaleString() })), [transitions]);

  if (versionsQ.isLoading) {
    return <div className="ui-page"><PageHeader title="Process map" /><TableSkeleton rows={8} label="Loading process map" /></div>;
  }
  if (versionsQ.error) {
    return (
      <div className="ui-page">
        <PageHeader title="Process map" />
        <Banner tone="danger" title="Versions could not be read">{(versionsQ.error as Error).message}</Banner>
      </div>
    );
  }
  if (!latest) {
    return (
      <div className="ui-page">
        <PageHeader title="Process map" />
        <EmptyState action={<Link className="ui-link" href="/sync">Open sync</Link>}>
          The map is mined from a completed analysis. Sync a system and run an analysis to see its process.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="ui-page">
      <PageHeader
        title="Process map"
        summary={`Mined from ${latest.label ?? "the latest complete version"}. ${bottlenecks.length ? `${plural(bottlenecks.length, "step")} in ${formatModuleName(active ?? "")} carry failing checks.` : "Every step passes its checks."}`}
      />

      {unmapped.length ? <p className="ui-note">No process map yet for {unmapped.map(formatModuleName).join(", ")}. Maps cover Procure to Pay and Order to Cash objects.</p> : null}
      {!modules.length ? <EmptyState>This analysis has no object with a process map. Analyse a purchasing, sales, vendor, customer, material or G/L object to see one.</EmptyState> : null}
      {modules.length > 1 ? (
        <Tabs ariaLabel="Module" items={modules.map((m) => ({ id: m, label: formatModuleName(m) }))} value={active ?? ""} onValueChange={setModule} />
      ) : null}

      {!modules.length ? null : graphQ.isLoading ? <TableSkeleton rows={8} label="Loading process graph" />
        : graphQ.error ? <Banner tone="danger" title="Process graph could not be read">{(graphQ.error as Error).message}</Banner>
        : (
          <>
            <Tally level={2} label="Process figures" figures={[
              { label: "Steps mapped", value: activities.length, href: "/process?tab=map", verdict: `${plural(transitions.length, "transition")} between them.` },
              { label: "Blocked", value: blocked, href: "/process?tab=readiness", tone: blocked ? "danger" : undefined, verdict: blocked ? "Critical or high findings stop these steps." : "Nothing blocked." },
              { label: "Degraded", value: degraded, href: "/process?tab=readiness", tone: degraded ? "warning" : undefined, verdict: degraded ? "Medium findings, or a partial pass rate." : "Nothing degraded." },
              { label: "Variants", value: variants.length, href: "/process?tab=map", verdict: variants.length ? "Mined paths through the steps." : "No variants mined." },
            ]} />

            <SectionCard title={formatModuleName(active ?? "")} meta={`${plural(activities.length, "activity", "activities")}, ${plural(transitions.length, "transition")}. Select a step for its failing fields.`} flush>
              {activities.length ? (
                <>
                  <ProcessGraphEmergence remountKey={`${latest.id}-${active}`}>
                    <ProcessGraph nodes={graphNodes} edges={graphEdges} height={480} onNodeClick={(n) => drawer.open(n.id)} />
                  </ProcessGraphEmergence>
                  <ul className="ui-legend" aria-label="Step state">
                    <li><StatusBadge status={STEP.green.status}>95% pass or better</StatusBadge></li>
                    <li><StatusBadge status={STEP.amber.status}>Medium finding, or 70 to 95% pass</StatusBadge></li>
                    <li><StatusBadge status={STEP.red.status}>Critical or high finding, or under 70% pass</StatusBadge></li>
                  </ul>
                </>
              ) : <EmptyState>No mined activities for this module. Its checks may not map to process steps yet.</EmptyState>}
            </SectionCard>

            <div className="ui-columns">
              <SectionCard title="Failing steps" meta="Ranked by affected records" flush>
                {bottlenecks.length ? (
                  <ol className="ui-ranked">
                    {bottlenecks.slice(0, 8).map((b) => (
                      <li key={b.id}>
                        <div className="ui-ranked__row">
                          <StatusBadge status={STEP[b.step_status].status}>{b.step_status === "red" ? "Blocking" : "Failing"}</StatusBadge>
                          <span className="ui-ranked__title">{b.label}</span>
                          <span className="ui-ranked__num">{plural(b.affected_records, "record")}</span>
                          <span className="ui-ranked__meta">
                            {b.tcode ? <><Mono>{b.tcode}</Mono>, </> : null}{plural(b.finding_count, "finding")}
                            {b.avg_pass_rate != null ? `, ${Math.round(b.avg_pass_rate)}% pass rate` : ""}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : <EmptyState>Every step passes its checks.</EmptyState>}
              </SectionCard>

              <SectionCard title="Variants" meta={`${plural(variants.length, "variant")} found`} flush>
                {variants.length ? (
                  <ul className="ui-ranked">
                    {variants.slice(0, 8).map((v) => (
                      <li key={v.id}>
                        <div className="ui-ranked__row">
                          <StatusBadge status={STEP[v.readiness]?.status ?? "idle"}>{READINESS[v.readiness] ?? v.readiness}</StatusBadge>
                          <span className="ui-ranked__title">{v.label}</span>
                          <span className="ui-ranked__num">{pct(v.coverage)} coverage</span>
                          <span className="ui-ranked__meta">{plural(v.activity_count, "step")}, quality {pct(v.quality)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState>No variants found for this module.</EmptyState>}
              </SectionCard>
            </div>
          </>
        )}

      <DetailDrawer open={!!picked} onClose={drawer.close} ariaLabel="Step detail"
        header={picked ? <div className="ui-drawer-head"><StatusBadge status={STEP[picked.step_status].status}>{STEP[picked.step_status].label}</StatusBadge>
          <h2 className="ui-drawer-head__title">{picked.label}</h2></div> : null}>
        {picked ? (
          <div className="ui-detail">
            <p className="ui-note">
              {picked.tcode ? <><Mono>{picked.tcode}</Mono>, </> : null}{plural(picked.affected_records, "affected record")}, {plural(picked.finding_count, "finding")}
              {picked.avg_pass_rate != null ? `, ${Math.round(picked.avg_pass_rate)}% pass rate` : ""}.
            </p>
            {bpQ.isLoading ? <TableSkeleton rows={4} label="Loading fields" />
              : pickedFields.length ? (
                <ul className="ui-ranked">
                  {pickedFields.map((f) => {
                    const href = f.check_id ? findingHref(active ?? "", f.check_id) : undefined;
                    return (
                      <li key={f.field}>
                        <div className="ui-ranked__row">
                          <StatusBadge status={f.dq_status === "red" ? "critical" : "medium"}>{f.dq_status === "red" ? "Blocking" : "Failing"}</StatusBadge>
                          <span className="ui-ranked__title"><Mono>{f.field}</Mono></span>
                          <span className="ui-ranked__num">{plural(f.affected_count, "record")}</span>
                          <span className="ui-ranked__meta">
                            {f.finding_message || f.description}
                            {f.check_id ? <>{" "}{href ? <Link className="ui-link" href={href}>{f.check_id}</Link> : <Mono>{f.check_id}</Mono>}</> : null}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <EmptyState>No failing fields are recorded for this step.</EmptyState>}
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
