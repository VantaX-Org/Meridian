"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { moduleText } from "@/lib/v2/labels";
import { useFixture } from "@/lib/api/v2/fixture";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { getConfigAlignment, getConfigGhost, getConfigRootCauseV2, getConfigShadow, type AlignmentFinding, type RootCauseType } from "@/lib/api/v2/config";
import type { ImpactResult } from "@/lib/api/v2/object";
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
 * never used) and shadow processes (used, never configured), each with its root cause on open. The inventory, process,
 * alignment, health and drift views stay on the Configuration screen this links to.
 */
export function ConfigImpact() {
  const fx = useFixture();
  const [kind, setKind] = useState<Kind>("ghost");
  const [open, setOpen] = useState<AlignmentFinding | null>(null);
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
      <RootCausePanel finding={open} onClose={() => setOpen(null)} />
    </div>
  );
}
