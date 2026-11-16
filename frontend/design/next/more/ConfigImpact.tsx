"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { moduleText } from "@/lib/v2/labels";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { getConfigAlignment, getConfigProcess, getConfigProcesses, getConfigGhost, getConfigRootCauseV2, getConfigShadow, type AlignmentFinding, type RootCauseType } from "@/lib/api/v2/config";
import type { ImpactResult } from "@/lib/api/v2/object";
import type { ProcessHealth, ProcessStep } from "@/lib/api/config-intelligence";
import { describeTable } from "@/lib/v2/sap-fields";
import { V2Link } from "@/design/v2/parts";
import { Chip, Code, DataTable, PartBar, SegmentedControl, SidePanel, type ChipTone, type Column } from "../kit";
import { ChartCard, cardState, compact } from "./ChartCard";
import { QueryView } from "./states";

const IMPACT_LABEL: Record<ImpactResult["status"], () => string> = { blocked: () => t("Blocked"), degraded: () => t("Degraded"), ok: () => t("Working") };
const IMPACT_TONE: Record<ImpactResult["status"], ChipTone> = { blocked: "bad", degraded: "warn", ok: "good" };
const SEV_LABEL: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };
const SEV_TONE: Record<string, ChipTone> = { critical: "bad", high: "bad", medium: "warn", low: "neutral" };
const CAUSE_LABEL: Record<RootCauseType, () => string> = {
  bad_data: () => t("Bad data"),
  bad_config: () => t("Bad configuration"),
  bad_data_and_config: () => t("Bad data and configuration"),
  process_gap: () => t("Process gap"),
};
const RANK = { blocked: 0, degraded: 1, ok: 2 } as const;

type Kind = "ghost" | "shadow";

const PROC_LABEL: Record<ProcessHealth["status"], () => string> = { active: () => t("Running"), partial: () => t("Partly running"), inactive: () => t("Not running") };
const PROC_TONE: Record<ProcessHealth["status"], ChipTone> = { active: "good", partial: "warn", inactive: "bad" };
const days = (n: number | null) => (n == null ? t("Not measured") : t("{n} days", { n: n.toFixed(1) }));

/** One business process step by step (GET /config/processes/{id}): which steps the data shows, their volume and delays. */
function ProcessPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["config", fx, "process", id], queryFn: () => getConfigProcess(id as string), enabled: !!id, retry: false });
  const p = q.data;
  const cols: Column<ProcessStep>[] = [
    { id: "n", label: t("Step"), align: "end", cell: (r) => int(r.step_number) },
    { id: "name", label: t("Name"), cell: (r) => r.step_name },
    { id: "table", label: t("Table"), cell: (r) => <Code code={r.sap_table} text={describeTable(r.sap_table) ?? undefined} /> },
    { id: "seen", label: t("Seen in the data"), cell: (r) => (r.detected ? <Chip tone="good">{t("Observed")}</Chip> : <Chip tone="warn">{t("Not observed")}</Chip>) },
    { id: "volume", label: t("Volume"), align: "end", cell: (r) => int(r.volume) },
    { id: "exceptions", label: t("Exceptions"), align: "end", cell: (r) => int(r.exception_count) },
    { id: "next", label: t("Days to next step"), align: "end", cell: (r) => days(r.avg_days_to_next_step) },
  ];
  return (
    <SidePanel open={!!id} onClose={onClose} title={p?.process_name ?? t("Business process")}>
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Loading the process")}>
        {p ? (
          <div className="nx-cell-stack" data-testid="config-process">
            <div className="nx-row nx-wrap"><Code code={p.process_id} text={p.process_name} /><Chip tone={PROC_TONE[p.status]}>{PROC_LABEL[p.status]()}</Chip></div>
            <p className="nx-sub">{t("{pct} complete, {rate} exceptions, cycle time {days}.", { pct: `${Math.round(p.completeness_score)}%`, rate: `${Math.round(p.exception_rate)}%`, days: days(p.avg_cycle_days) })}</p>
            {p.bottleneck_step ? <p>{t("Slowest step: {step}", { step: p.bottleneck_step })}</p> : null}
            <DataTable rows={p.steps} columns={cols} rowKey={(r) => String(r.step_number)} rowLabel={(r) => r.step_name} caption={t("Process steps")} />
          </div>
        ) : null}
      </QueryView>
    </SidePanel>
  );
}

function RootCausePanel({ finding, onClose }: { finding: AlignmentFinding | null; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({
    queryKey: ["config", fx, "root-cause", finding?.check_id ?? ""],
    queryFn: () => getConfigRootCauseV2(finding?.check_id as string),
    enabled: Boolean(finding), staleTime: 60_000, retry: false,
  });
  const rc = q.data;
  return (
    <SidePanel open={Boolean(finding)} onClose={onClose} title={finding?.title ?? ""}>
      {finding ? (
        <div className="nx-cell-stack" data-testid="config-root-cause">
          <span><Code code={finding.check_id} text={finding.title} /></span>
          <p>{finding.description}</p>
          {finding.affected_elements.length ? <p className="nx-sub">{t("Affected: {list}", { list: finding.affected_elements.join(", ") })}</p> : null}
          <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Loading the root cause")}>
            {rc ? (
              <>
                <h3 className="nx-rn-h3">{t("Root cause")}</h3>
                <Chip tone={rc.root_cause_type === "process_gap" ? "warn" : "bad"}>{CAUSE_LABEL[rc.root_cause_type]()}</Chip>
                {rc.data_issue ? <p>{t("Data: {text}", { text: rc.data_issue })}</p> : null}
                {rc.config_issue ? <p>{t("Configuration: {text}", { text: rc.config_issue })}</p> : null}
                {rc.process_issue ? <p>{t("Process: {text}", { text: rc.process_issue })}</p> : null}
                <h3 className="nx-rn-h3">{t("What to do")}</h3>
                <p>{rc.recommendation}</p>
              </>
            ) : null}
          </QueryView>
        </div>
      ) : null}
    </SidePanel>
  );
}

/**
 * Config impact: which SAP features a configuration finding blocks or degrades, then the ghost settings (configured,
 * never used) and shadow processes (used, never configured), each with its root cause on open, then the business
 * processes step by step. The inventory, alignment, health and drift views stay on the Configuration screen this links to.
 */
export function ConfigImpact() {
  const fx = useFixture();
  const [kind, setKind] = useState<Kind>("ghost");
  const [open, setOpen] = useState<AlignmentFinding | null>(null);
  const [proc, setProc] = useState<string | null>(null);
  const procs = useQuery({ queryKey: ["config", fx, "processes"], queryFn: getConfigProcesses, staleTime: 60_000, retry: false });
  const alignment = useQuery({ queryKey: ["config", fx, "alignment"], queryFn: getConfigAlignment, staleTime: 60_000, retry: false });
  const impact = useConfigImpact(alignment.data?.run_id);
  const list = useQuery({ queryKey: ["config", fx, kind], queryFn: kind === "ghost" ? getConfigGhost : getConfigShadow, staleTime: 60_000, retry: false });

  const titleOf = new Map((alignment.data?.findings ?? []).map((f) => [f.check_id, f.title]));
  const features = [...(impact.data ?? [])].sort((a, b) => RANK[a.status] - RANK[b.status] || a.feature.localeCompare(b.feature));
  const count = (s: ImpactResult["status"]) => features.filter((f) => f.status === s).length;
  const blocked = count("blocked");
  const findings = list.data?.findings ?? [];
  const bySev = (["critical", "high", "medium", "low"] as const).map((s) => ({ label: SEV_LABEL[s](), value: findings.filter((f) => f.severity === s).length }));

  const featureCols: Column<ImpactResult>[] = [
    { id: "feature", label: t("Feature"), cell: (r) => <span className="nx-cell-stack"><span>{r.feature}</span><span className="nx-sub">{r.system}</span></span> },
    { id: "status", label: t("Status"), compare: (a, b) => RANK[a.status] - RANK[b.status], cell: (r) => <Chip tone={IMPACT_TONE[r.status]}>{IMPACT_LABEL[r.status]()}</Chip> },
    {
      id: "why", label: t("Caused by"),
      cell: (r) => (r.blocking_findings.length ? (
        <span className="nx-cell-stack">
          {r.blocking_findings.map((b) => <Code key={b.check_id} code={b.check_id} text={titleOf.get(b.check_id) ?? (b.module ? moduleText(b.module) : b.check_id)} />)}
        </span>
      ) : t("Nothing")),
    },
    { id: "records", label: t("Records affected"), align: "end", compare: (a, b) => (a.total_affected_records ?? 0) - (b.total_affected_records ?? 0), cell: (r) => (r.total_affected_records == null ? t("Not counted") : int(r.total_affected_records)) },
    { id: "tx", label: t("Transactions stopped"), cell: (r) => (r.blocked_transactions.length ? r.blocked_transactions.join(", ") : t("None")) },
    { id: "cost", label: t("What it costs"), cell: (r) => r.opportunity_cost_summary || t("Not priced") },
  ];
  const findingCols: Column<AlignmentFinding>[] = [
    { id: "finding", label: t("Finding"), cell: (f) => <Code code={f.check_id} text={f.title} /> },
    { id: "module", label: t("Module"), cell: (f) => moduleText(f.module) },
    { id: "sev", label: t("Severity"), compare: (a, b) => a.severity.localeCompare(b.severity), cell: (f) => <Chip tone={SEV_TONE[f.severity] ?? "neutral"}>{(SEV_LABEL[f.severity] ?? (() => f.severity))()}</Chip> },
    { id: "elements", label: t("Affected"), cell: (f) => f.affected_elements.slice(0, 3).join(", ") + (f.affected_elements.length > 3 ? t(" and {n} more", { n: int(f.affected_elements.length - 3) }) : "") },
  ];

  const procCols: Column<ProcessHealth>[] = [
    { id: "process", label: t("Process"), cell: (r) => <Code code={r.process_id} text={r.process_name} /> },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={PROC_TONE[r.status]}>{PROC_LABEL[r.status]()}</Chip> },
    { id: "complete", label: t("Complete"), align: "end", compare: (a, b) => a.completeness_score - b.completeness_score, cell: (r) => `${Math.round(r.completeness_score)}%` },
    { id: "exceptions", label: t("Exception rate"), align: "end", compare: (a, b) => a.exception_rate - b.exception_rate, cell: (r) => `${Math.round(r.exception_rate)}%` },
    { id: "volume", label: t("Volume"), align: "end", compare: (a, b) => a.total_volume - b.total_volume, cell: (r) => int(r.total_volume) },
    { id: "cycle", label: t("Cycle time"), align: "end", cell: (r) => days(r.avg_cycle_days) },
  ];

  return (
    <div className="nx-body" data-testid="config-impact-page">
      <div className="nx-row nx-wrap">
        <V2Link href="/more/systems/config">{t("Inventory, processes, alignment, health and drift")}</V2Link>
      </div>
      <QueryView loading={alignment.isLoading} error={alignment.error} onRetry={() => void alignment.refetch()} empty={false} emptyHeading="" label={t("Loading configuration findings")}>
        <div className="nx-chartcards">
          <ChartCard
            title={t("SAP features by configuration impact")} state={cardState(impact, features.length === 0)} testId="config-impact-features"
            chart={<PartBar segments={(["blocked", "degraded", "ok"] as const).map((s) => ({ label: IMPACT_LABEL[s](), value: count(s) }))} label={t("SAP features by configuration impact")} format={compact} />}
            figure={int(blocked)} figureTitle={t("Blocked")}
            line={blocked ? t("{n} features cannot run as configured", { n: int(blocked) }) : t("No feature is blocked")}
            emptyLine={t("No configuration impact for this run.")} onRetry={() => void impact.refetch()}
          />
          <ChartCard
            title={kind === "ghost" ? t("Ghost settings by severity") : t("Shadow processes by severity")} state={cardState(list, findings.length === 0)} testId="config-impact-severity"
            chart={<PartBar segments={bySev} label={t("By severity")} format={compact} />}
            figure={int(findings.length)}
            emptyLine={kind === "ghost" ? t("No ghost setting found.") : t("No shadow process found.")} onRetry={() => void list.refetch()}
          />
        </div>
        <DataTable
          rows={features} columns={featureCols} rowKey={(r) => `${r.system}:${r.feature}`} rowLabel={(r) => r.feature} caption={t("Features blocked or degraded by configuration")}
          loading={impact.isLoading} empty={{ heading: t("No configuration impact for this run.") }}
        />
        <SegmentedControl<Kind>
          label={t("Finding type")} value={kind} onChange={setKind}
          items={[{ value: "ghost", label: t("Ghost settings") }, { value: "shadow", label: t("Shadow processes") }]}
        />
        <p className="nx-sub">{kind === "ghost" ? t("Configured in SAP but never used in the data.") : t("Happening in the data but not configured in SAP.")}</p>
        <DataTable
          rows={findings} columns={findingCols} rowKey={(f) => f.check_id} rowLabel={(f) => f.title} caption={kind === "ghost" ? t("Ghost settings") : t("Shadow processes")}
          loading={list.isLoading} onOpenRow={setOpen}
          empty={{ heading: kind === "ghost" ? t("No ghost setting found.") : t("No shadow process found.") }}
        />
      </QueryView>
      <h3 className="nx-rn-h3">{t("Business processes")}</h3>
      <p className="nx-sub">{t("How completely each business process runs in the data. Open one to see it step by step.")}</p>
      <DataTable
        rows={procs.data?.processes ?? []} columns={procCols} rowKey={(r) => r.process_id} rowLabel={(r) => r.process_name} caption={t("Business processes")}
        loading={procs.isLoading} error={procs.error ? { sentence: errorSentence(procs.error, t("The processes could not be loaded.")), onRetry: () => void procs.refetch() } : undefined} onOpenRow={(r) => setProc(r.process_id)}
        empty={{ heading: t("No business process found for this run.") }}
      />
      <RootCausePanel finding={open} onClose={() => setOpen(null)} />
      <ProcessPanel id={proc} onClose={() => setProc(null)} />
    </div>
  );
}
