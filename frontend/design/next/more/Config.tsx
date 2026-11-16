"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  downloadConfigMatches,
  getConfigAlignment,
  getConfigDrift,
  getConfigHealth,
  getConfigInventory,
  getConfigLicence,
  getConfigMatchSummary,
  getConfigMatches,
  getConfigProcesses,
  rediscoverConfig,
  type AlignmentFinding,
  type ConfigMatchClass,
  type ProcessHealth,
} from "@/lib/api/v2/config";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";
import { DASH, f1, int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, useToast, type ChipTone, type Column } from "../kit";
import { ExportTable } from "./ExportTable";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";

/**
 * Configuration: the SAP configuration Meridian reads back out of the transactions of the latest run. The process
 * chains show each end-to-end flow step by step, sized by volume, with the step that raises the most exceptions marked;
 * under them the health score of each area, the settings in use, the findings with what they cost, the failing records
 * judged data error or configuration choice, and the settings changed since the last reading.
 */

const notFound = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status === 404 || (e as { status?: number } | null)?.status === 404;
const retry = (n: number, e: unknown) => !notFound(e) && n < 2;

/** The configuration areas by their SAP short code, and the processes by their id. */
const AREA: Record<string, () => string> = {
  FI: () => t("Finance"),
  CO: () => t("Controlling"),
  MM: () => t("Materials management"),
  SD: () => t("Sales and distribution"),
  PM: () => t("Plant maintenance"),
  PP: () => t("Production planning"),
  QM: () => t("Quality management"),
  HCM: () => t("Human capital"),
  PS: () => t("Project system"),
  OTC: () => t("Order-to-cash"),
  PTP: () => t("Procure-to-pay"),
  RTR: () => t("Record-to-report"),
  PTP_MFG: () => t("Plan-to-produce"),
  MTO: () => t("Maintain-to-operate"),
  HTR: () => t("Hire-to-retire"),
  STC: () => t("Source-to-contract"),
};
const Area = ({ code }: { code: string }) => <Code code={code} text={AREA[code]?.() ?? labelText(code)} />;

const SEVERITY: Record<AlignmentFinding["severity"], { word: () => string; tone: ChipTone }> = {
  critical: { word: () => t("Critical"), tone: "bad" },
  high: { word: () => t("High"), tone: "bad" },
  medium: { word: () => t("Medium"), tone: "warn" },
  low: { word: () => t("Low"), tone: "neutral" },
};
const RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** The kinds of finding the alignment validator raises, as api/services/config_intelligence/serializers.py names them. */
const KIND: Record<string, () => string> = {
  ghost: () => t("Ghost configuration"),
  shadow: () => t("Shadow process"),
  drift: () => t("Drift"),
  bottleneck: () => t("Bottleneck"),
  licence_waste: () => t("Unused licence"),
  conflict: () => t("Conflict"),
  org_gap: () => t("Organisation gap"),
  mismatch: () => t("Mismatch"),
  number_range: () => t("Number range"),
  integration_gap: () => t("Integration gap"),
};
const KIND_HINT: Record<string, () => string> = {
  ghost: () => t("Settings that exist but no transaction uses."),
  shadow: () => t("Processes found in the data that the configuration does not describe."),
};

const CHANGE: Record<string, () => string> = { added: () => t("Added"), removed: () => t("Removed"), modified: () => t("Changed"), changed: () => t("Changed") };

function useConfig<T>(name: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["config", fixture, name], queryFn: fn, staleTime: 60_000, retry });
}

export function ConfigScreen() {
  const health = useConfig("health", getConfigHealth);
  const inventory = useConfig("inventory", getConfigInventory);
  const processes = useConfig("processes", getConfigProcesses);
  const alignment = useConfig("alignment", getConfigAlignment);
  const licence = useConfig("licence", getConfigLicence);
  const drift = useConfig("drift", getConfigDrift);
  const [kind, setKind] = useState<string | null>(null);
  const session = useV2Session();
  const live = !session.shared && !session.viewAs;
  const toast = useToast();
  const rerun = useMutation({
    mutationFn: rediscoverConfig,
    onSuccess: () => toast({ text: t("The configuration is being read again. The figures change when the run ends."), tone: "good" }),
    onError: (e) => toast({ text: errorSentence(e, t("The configuration could not be read again.")), tone: "bad" }),
  });

  if (alignment.isPending || inventory.isPending) return <div className="nx-body"><Skeleton lines={8} label={t("Configuration")} /></div>;
  if (notFound(alignment.error) || notFound(inventory.error)) {
    return <div className="nx-body"><EmptyState heading={t("Configuration")}>{t("Run an analysis on an SAP system to read its configuration.")}</EmptyState></div>;
  }
  if (alignment.isError || inventory.isError) {
    return (
      <div className="nx-body">
        <ErrorState sentence={t("The configuration could not be read.")} onRetry={() => { void alignment.refetch(); void inventory.refetch(); }} />
      </div>
    );
  }

  const findings = [...alignment.data.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.estimated_impact_zar - a.estimated_impact_zar);
  const currency = alignment.data.currency ?? "ZAR";
  const cost = findings.reduce((s, f) => s + f.estimated_impact_zar, 0);
  const kinds = [...new Set(findings.map((f) => f.category))].sort((a, b) => (KIND[a]?.() ?? a).localeCompare(KIND[b]?.() ?? b));
  const filtered = kind !== null && kinds.includes(kind);
  const shown = filtered ? findings.filter((f) => f.category === kind) : findings;
  const urgent = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const elements = inventory.data.elements;
  const used = elements.filter((e) => e.transaction_count > 0).length;
  const scores = health.data?.scores ?? [];
  const avg = scores.length ? scores.reduce((s, x) => s + x.chs, 0) / scores.length : null;

  const findingCols: Column<AlignmentFinding>[] = [
    { id: "severity", label: t("Severity"), cell: (f) => <Chip tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].word()}</Chip>, compare: (a, b) => RANK[a.severity] - RANK[b.severity] },
    {
      id: "finding",
      label: t("Finding"),
      cell: (f) => (
        <span className="nx-cell-stack">
          <strong>{f.title}</strong>
          <span className="nx-sub">{f.description}</span>
          {f.remediation ? <span className="nx-sub">{t("Fix: {what}", { what: f.remediation })}</span> : null}
        </span>
      ),
    },
    { id: "kind", label: t("Kind"), cell: (f) => <Code code={f.category} text={KIND[f.category]?.() ?? labelText(f.category)} /> },
    { id: "area", label: t("Area"), cell: (f) => <Area code={f.module} /> },
    { id: "affected", label: t("Affected"), cell: (f) => <Affected values={f.affected_elements} /> },
    { id: "stake", label: t("At stake"), align: "end", cell: (f) => moneyCompactText(f.estimated_impact_zar, currency), compare: (a, b) => a.estimated_impact_zar - b.estimated_impact_zar },
  ];

  type Drift = NonNullable<typeof drift.data>["drift_entries"][number];
  const driftCols: Column<Drift>[] = [
    { id: "change", label: t("Change"), cell: (d) => CHANGE[d.change_type]?.() ?? labelText(d.change_type) },
    { id: "setting", label: t("Setting"), cell: (d) => <Code code={d.element_value} text={labelText(d.element_type)} /> },
    { id: "area", label: t("Area"), cell: (d) => <Area code={d.module} /> },
    { id: "before", label: t("Before"), cell: (d) => d.previous_value ?? DASH },
    { id: "now", label: t("Now"), cell: (d) => d.current_value ?? DASH },
  ];

  return (
    <div className="nx-body" data-testid="config-page">
      <About
        shows={t("Reads how the SAP system is configured, which settings carry transactions and the health of each area.")}
        next={{ href: "/s4", label: t("Open S/4HANA readiness") }}
        why={t("Reading again asks SAP for its settings. Nothing in SAP is changed.")}
        means={[
          [t("Average health"), t("Each area starts at 100 and loses points for its findings; this is the average.")],
          [t("Critical and high"), t("Findings to act on first.")],
          [t("Settings in use"), t("The share of configured settings that carry at least one transaction.")],
        ]}
      />

      <Banner
        testId="config-banner"
        label={t("Configuration")}
        meta={t("Configuration read from the transactions")}
        title={t("{n} configuration findings, {money} at stake", { n: int(findings.length), money: moneyCompactText(cost, currency) })}
        why={t("{used} of {total} settings carry transactions; {idle} were never used in the period read.", { used: int(used), total: int(elements.length), idle: int(elements.length - used) })}
        figs={[
          { label: t("Average health"), value: avg == null ? DASH : f1(avg), note: t("of 100, across {n} areas", { n: int(scores.length) }) },
          { label: t("Critical and high"), value: int(urgent), note: t("findings to act on first") },
          { label: t("Settings in use"), value: elements.length ? `${f1((used / elements.length) * 100)}%` : DASH, note: t("{n} unused", { n: int(elements.length - used) }) },
        ]}
      >
        <div className="nx-row nx-wrap">
          {session.can("analyse") && live ? (
            <Button variant="primary" icon="refresh" loading={rerun.isPending} disabled={rerun.isSuccess} onClick={() => rerun.mutate()} data-testid="config-rerun">
              {t("Read the configuration again")}
            </Button>
          ) : (
            <p className="nx-sub" data-testid="config-rerun-gate">{t("Reading the configuration again needs the analyse permission.")}</p>
          )}
        </div>
      </Banner>

      <Panel title={t("Findings")} meta={t("{n} findings, worst first", { n: int(shown.length) })} testId="config-findings">
        {kinds.length > 1 ? (
          <div className="nx-row nx-wrap" role="group" aria-label={t("Kind of finding")}>
            <Chip onClick={() => setKind(null)} pressed={!filtered} count={findings.length}>{t("All")}</Chip>
            {kinds.map((k) => (
              <span key={k} title={KIND_HINT[k]?.()}>
                <Chip onClick={() => setKind(k)} pressed={kind === k} count={findings.filter((f) => f.category === k).length}>
                  {KIND[k]?.() ?? labelText(k)}
                </Chip>
              </span>
            ))}
          </div>
        ) : null}
        {filtered && kind && KIND_HINT[kind] ? <p className="nx-sub">{KIND_HINT[kind]()}</p> : null}
        <ExportTable><DataTable
          rows={shown}
          columns={findingCols}
          rowKey={(f) => f.check_id}
          rowLabel={(f) => f.title}
          caption={t("Findings")}
          total={findings.length}
          empty={{ heading: t("The configuration matches how the system is used.") }}
        /></ExportTable>
      </Panel>

      <Fold title={t("How the system is used")} hint={t("Processes, health by area and settings in use.")}>
        <Panel
          title={t("Processes")}
          meta={t("Each step sized by the documents that reached it. The step with the most exceptions is marked; the days are the wait before the next step.")}
          testId="config-processes"
        >
          {processes.isPending ? <Skeleton lines={5} label={t("Processes")} /> : processes.isError ? <ErrorState sentence={t("The processes could not be read.")} onRetry={() => void processes.refetch()} /> : (
            <div className="nx-cfg-flows">
              {processes.data.processes.map((p) => <Flow key={p.process_id} p={p} />)}
            </div>
          )}
        </Panel>

        <div className="nx-cfg-split">
          <Panel title={t("Health by area")} meta={t("100 less 3 per critical, 2 per high, 1 per medium and half per low finding.")} testId="config-health">
            {health.isPending ? <Skeleton lines={4} label={t("Health by area")} /> : health.isError ? <ErrorState sentence={t("The health scores could not be read.")} onRetry={() => void health.refetch()} /> : (
              <HBars
                label={t("Health by area")}
                rows={[...scores].sort((a, b) => a.chs - b.chs).map((s) => ({
                  key: s.module,
                  label: <Area code={s.module} />,
                  value: s.chs,
                  text: t("{score}, {n} findings", { score: int(s.chs), n: int(s.critical_count + s.high_count + s.medium_count + s.low_count) }),
                  tone: s.critical_count + s.high_count > 0 ? "bad" : s.medium_count > 0 ? "warn" : "good",
                }))}
              />
            )}
          </Panel>
          <Panel title={t("Settings in use")} meta={t("The share of each area's configured values that carry at least one transaction.")} testId="config-licence">
            {licence.isPending ? <Skeleton lines={4} label={t("Settings in use")} /> : licence.isError ? <ErrorState sentence={t("The usage could not be read.")} onRetry={() => void licence.refetch()} /> : (
              <HBars
                label={t("Settings in use")}
                rows={(licence.data?.modules ?? []).map((m) => ({
                  key: m.module,
                  label: <Area code={m.module} />,
                  value: m.utilisation_pct,
                  text: t("{pct}% of {n}, {txn} transactions", { pct: f1(m.utilisation_pct), n: int(m.total_config_elements), txn: int(m.total_transactions) }),
                  tone: m.status === "active" ? "good" : m.status === "underutilised" ? "warn" : "bad",
                }))}
              />
            )}
          </Panel>
        </div>
      </Fold>

      <Fold title={t("Data errors or configuration choices")} hint={t("Failing records, split into mistakes in the data and values the configuration allows.")}>
        <ConfigMatches versionId={alignment.data.run_id} live={live} />
      </Fold>

      <Fold title={t("Changes since the last run")} hint={t("Settings that differ from the previous reading.")}>
        <Panel title={t("Changes since the last run")} meta={drift.data ? t("{n} settings changed", { n: int(drift.data.drift_entries.length) }) : undefined} testId="config-changes">
          {drift.isPending ? <Skeleton lines={3} label={t("Changes since the last run")} /> : notFound(drift.error) ? (
            <EmptyState heading={t("Changes since the last run")}>{t("Changes show once the configuration has been read twice.")}</EmptyState>
          ) : drift.isError ? <ErrorState sentence={t("The changes could not be read.")} onRetry={() => void drift.refetch()} /> : (
            <ExportTable><DataTable
              rows={drift.data.drift_entries}
              columns={driftCols}
              rowKey={(d) => `${d.module}-${d.element_type}-${d.element_value}`}
              rowLabel={(d) => d.element_value}
              caption={t("Changes since the last run")}
              empty={{ heading: t("No setting changed since the last run.") }}
            /></ExportTable>
          )}
        </Panel>
      </Fold>
    </div>
  );
}

const MATCH_CLASS: Record<ConfigMatchClass, () => string> = {
  data_error: () => t("Data error"),
  config_deviation: () => t("Configuration choice"),
  ambiguous: () => t("Cannot tell"),
};

/** Failing records of the analysed version, each judged a data error, a configuration choice or ambiguous. */
function ConfigMatches({ versionId, live }: { versionId: string; live: boolean }) {
  const fixture = useFixture();
  const toast = useToast();
  const session = useV2Session();
  const [cls, setCls] = useState<ConfigMatchClass | null>(null);
  const summary = useQuery({ queryKey: ["config-matches-summary", fixture, versionId], queryFn: () => getConfigMatchSummary(versionId), staleTime: 60_000, retry });
  const list = useQuery({ queryKey: ["config-matches", fixture, versionId, cls], queryFn: () => getConfigMatches(versionId, cls ?? undefined), staleTime: 60_000, retry });
  const save = useMutation({ mutationFn: () => downloadConfigMatches(versionId), onError: (e) => toast({ text: errorSentence(e, t("The workbook could not be saved.")), tone: "bad" }) });
  const counts = summary.data && "data_errors" in summary.data ? summary.data : null;
  const filters: [ConfigMatchClass | null, string, number | undefined][] = [
    [null, t("All"), counts ? counts.data_errors + counts.config_deviations + counts.ambiguous : undefined],
    ["data_error", MATCH_CLASS.data_error(), counts?.data_errors],
    ["config_deviation", MATCH_CLASS.config_deviation(), counts?.config_deviations],
    ["ambiguous", MATCH_CLASS.ambiguous(), counts?.ambiguous],
  ];
  type Match = NonNullable<typeof list.data>["items"][number];
  const cols: Column<Match>[] = [
    { id: "record", label: t("Record"), cell: (m) => <span className="nx-mono">{m.record_key ?? DASH}</span> },
    { id: "area", label: t("Area"), cell: (m) => <Code code={m.module} text={AREA[m.module]?.() ?? labelText(m.module)} /> },
    { id: "field", label: t("Field"), cell: (m) => (m.field ? <span className="nx-mono">{m.field}</span> : DASH) },
    { id: "value", label: t("Value"), cell: (m) => (m.actual_value ? <span className="nx-mono">{m.actual_value}</span> : DASH) },
    { id: "kind", label: t("Kind of record"), cell: (m) => MATCH_CLASS[m.classification]?.() ?? labelText(m.classification) },
    { id: "evidence", label: t("What the configuration shows"), cell: (m) => m.config_evidence ?? DASH },
    { id: "action", label: t("What to do"), cell: (m) => <>{m.recommended_action ?? DASH}{m.sap_tcode ? <> <span className="nx-mono">{m.sap_tcode}</span></> : null}</> },
  ];
  return (
    <Panel title={t("Data errors or configuration choices")} meta={list.data ? t("{n} records", { n: int(list.data.total) }) : undefined} testId="config-matches">
      {list.isPending ? <Skeleton lines={3} label={t("Data errors or configuration choices")} /> : notFound(list.error) || (list.data && list.data.total === 0 && cls === null) ? (
        <EmptyState heading={t("Data errors or configuration choices")}>{t("No failing record has been matched against the configuration yet.")}</EmptyState>
      ) : list.isError ? <ErrorState sentence={t("The records could not be read.")} onRetry={() => void list.refetch()} /> : (
        <>
          <div className="nx-row nx-wrap">
            <div className="nx-row nx-wrap" role="group" aria-label={t("Kind of record")}>
              {filters.map(([k, label, n]) => (
                <Chip key={label} onClick={() => setCls(k)} pressed={cls === k} count={n}>{label}</Chip>
              ))}
            </div>
            {session.can("export") && live ? (
              <Button variant="secondary" size={32} icon="download" loading={save.isPending} onClick={() => save.mutate()} data-testid="config-matches-export">
                {t("Save as workbook")}
              </Button>
            ) : null}
          </div>
          <DataTable
            rows={list.data.items}
            columns={cols}
            rowKey={(m) => `${m.check_id}-${m.record_key}-${m.field}`}
            rowLabel={(m) => m.record_key ?? m.check_id}
            caption={t("Data errors or configuration choices")}
            total={list.data.total}
            empty={{ heading: t("No record of this kind.") }}
          />
        </>
      )}
    </Panel>
  );
}

function Affected({ values }: { values: string[] }) {
  if (!values.length) return <>{DASH}</>;
  const shown = values.slice(0, 3);
  return (
    <span className="nx-row nx-wrap">
      {shown.map((v) => <span key={v} className="nx-mono">{v}</span>)}
      {values.length > shown.length ? <span className="nx-sub">{t("and {n} more", { n: int(values.length - shown.length) })}</span> : null}
    </span>
  );
}

/** One process as a chain of steps: width by volume, exceptions as a red share, the missing steps hollow. */
function Flow({ p }: { p: ProcessHealth }) {
  const max = Math.max(1, ...p.steps.map((s) => s.volume));
  const worst = p.bottleneck_step;
  return (
    <div className="nx-cfg-flow" data-status={p.status}>
      <div className="nx-cfg-head">
        <Code code={p.process_id} text={<strong>{AREA[p.process_id]?.() ?? p.process_name}</strong>} />
        <span className="nx-sub">
          {p.status === "inactive"
            ? t("Not run in this system")
            : t("{done}% of steps found, {docs} documents, {rate}% exceptions, {days}", {
                done: int(p.completeness_score),
                docs: int(p.total_volume),
                rate: f1(p.exception_rate),
                days: p.avg_cycle_days == null ? DASH : t("{n} days end to end", { n: f1(p.avg_cycle_days) }),
              })}
        </span>
      </div>
      <ol className="nx-cfg-steps">
        {p.steps.map((s) => (
          <li key={s.step_number} className="nx-cfg-step" data-missing={!s.detected || undefined} data-worst={s.step_name === worst || undefined}>
            <span className="nx-cfg-stepname"><Code code={s.sap_table} text={s.step_name} /></span>
            <span className="nx-cfg-track" aria-hidden="true">
              <span className="nx-cfg-vol" style={{ width: `${(s.volume / max) * 100}%` }}>
                {s.volume ? <span className="nx-cfg-exc" style={{ width: `${Math.min(100, (s.exception_count / s.volume) * 100)}%` }} /> : null}
              </span>
            </span>
            <span className="nx-sub">
              {s.detected ? t("{n} documents, {e} exceptions", { n: int(s.volume), e: int(s.exception_count) }) : t("Not found")}
              {s.avg_days_to_next_step != null ? ` ${t("{n} days", { n: f1(s.avg_days_to_next_step) })}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
