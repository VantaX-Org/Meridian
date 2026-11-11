"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { getConfigAlignment, getConfigDrift, getConfigHealth, getConfigInventory, getConfigLicence, getConfigProcesses, rediscoverConfig, type AlignmentFinding, type ProcessHealth } from "@/lib/api/v2/config";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";
import { DASH, f1, int } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { Disclose, Guide } from "./Guide";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { ScrollFrame } from "./object/ScrollFrame";
import { TableExport } from "@/design/v2/TableExport";

/**
 * Configuration: the SAP configuration Meridian reads back out of the transactions of the latest run. The process
 * chains show each end-to-end flow step by step, sized by volume, with the slowest hand-off and the step that raises
 * the most exceptions marked; under them the health score of each module, the settings in use, and the findings with
 * what they cost. Every figure is the stored config run; nothing is computed here beyond sums and shares.
 */

const notFound = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status === 404 || (e as { status?: number } | null)?.status === 404;

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
const Area = ({ code }: { code: string }) => (
  <span>
    {AREA[code]?.() ?? labelText(code)} <Mono>{code}</Mono>
  </span>
);

const SEVERITY: Record<AlignmentFinding["severity"], { word: () => string; tone: "crit" | "warn" | "data" }> = {
  critical: { word: () => t("Critical"), tone: "crit" },
  high: { word: () => t("High"), tone: "crit" },
  medium: { word: () => t("Medium"), tone: "warn" },
  low: { word: () => t("Low"), tone: "data" },
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
  return useQuery({ queryKey: ["config", fixture, name], queryFn: fn, staleTime: 60_000, retry: (n, e) => !notFound(e) && n < 2 });
}

export function Config() {
  const health = useConfig("health", getConfigHealth);
  const inventory = useConfig("inventory", getConfigInventory);
  const processes = useConfig("processes", getConfigProcesses);
  const alignment = useConfig("alignment", getConfigAlignment);
  const licence = useConfig("licence", getConfigLicence);
  const drift = useConfig("drift", getConfigDrift);
  const [kind, setKind] = useState<string | null>(null);
  const { can } = useV2Session();
  const toast = useToast();
  const rerun = useMutation({
    mutationFn: rediscoverConfig,
    onSuccess: () => toast.show(t("The configuration is being read again. The figures change when the run ends.")),
    onError: (e) => toast.show(errorSentence(e, t("The configuration could not be read again.")), "error"),
  });

  if (alignment.isPending || inventory.isPending) return <CcPage title={t("Configuration")}><Skeleton width="100%" height={320} /></CcPage>;
  if (notFound(alignment.error) || notFound(inventory.error)) return <CcPage title={t("Configuration")}><EmptyFrame>{t("Run an analysis on an SAP system to read its configuration.")}</EmptyFrame></CcPage>;
  if (alignment.isError || inventory.isError) return <CcPage title={t("Configuration")}><ErrorFrame onRetry={() => { void alignment.refetch(); void inventory.refetch(); }}>{t("The configuration could not be read.")}</ErrorFrame></CcPage>;

  const findings = [...alignment.data.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.estimated_impact_zar - a.estimated_impact_zar);
  const currency = alignment.data.currency ?? "ZAR";
  const cost = findings.reduce((s, f) => s + f.estimated_impact_zar, 0);
  const kinds = [...new Set(findings.map((f) => f.category))].sort((a, b) => (KIND[a]?.() ?? a).localeCompare(KIND[b]?.() ?? b));
  const shown = kind && kinds.includes(kind) ? findings.filter((f) => f.category === kind) : findings;
  const urgent = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const elements = inventory.data.elements;
  const used = elements.filter((e) => e.transaction_count > 0).length;
  const scores = health.data?.scores ?? [];
  const avg = scores.length ? scores.reduce((s, x) => s + x.chs, 0) / scores.length : null;

  return (
    <CcPage title={t("Configuration")}>
      <Guide
        shows={t("Reads how the SAP system is configured, which settings carry transactions and the health of each area.")}
        next={{ href: "/s4", label: t("Open S/4HANA readiness") }}
        why={t("Reading again asks SAP for its settings. Nothing in SAP is changed.")}
        means={[
          [t("Average health"), t("Each area starts at 100 and loses points for its findings; this is the average.")],
          [t("Critical and high"), t("Findings to act on first.")],
          [t("Settings in use"), t("The share of configured settings that carry at least one transaction.")],
        ]}
      />
      <CcBanner
        testId="config"
        label={t("Configuration")}
        eyebrow={t("Configuration read from the transactions")}
        headline={t("{n} configuration findings, {money} at stake", { n: int(findings.length), money: moneyCompactText(cost, currency) })}
        why={t("{used} of {total} settings carry transactions; {idle} were never used in the period read.", { used: int(used), total: int(elements.length), idle: int(elements.length - used) })}
        figs={[
          { label: t("Average health"), value: avg == null ? DASH : f1(avg), note: t("of 100, across {n} areas", { n: int(scores.length) }) },
          { label: t("Critical and high"), value: int(urgent), note: t("findings to act on first") },
          { label: t("Settings in use"), value: elements.length ? `${f1((used / elements.length) * 100)}%` : DASH, note: t("{n} unused", { n: int(elements.length - used) }) },
        ]}
        action={
          can("analyse") ? (
            <button type="button" className="m2-btn m2-next" disabled={rerun.isPending || rerun.isSuccess} onClick={() => rerun.mutate()} data-testid="config-rerun">
              {t("Read the configuration again")}
            </button>
          ) : null
        }
      />

      <Panel title={t("Findings")} meta={t("{n} findings, worst first", { n: int(shown.length) })} testId="config-findings">
        {kinds.length > 1 ? (
          <div className="m2-segs" role="group" aria-label={t("Kind of finding")}>
            <button type="button" className="m2-seg" aria-pressed={shown === findings} onClick={() => setKind(null)}>
              {t("All {n}", { n: int(findings.length) })}
            </button>
            {kinds.map((k) => (
              <button key={k} type="button" className="m2-seg" aria-pressed={kind === k} title={KIND_HINT[k]?.()} onClick={() => setKind(k)}>
                {KIND[k]?.() ?? labelText(k)} {int(findings.filter((f) => f.category === k).length)}
              </button>
            ))}
          </div>
        ) : null}
        {kind && KIND_HINT[kind] && shown !== findings ? <p className="m2-meta">{KIND_HINT[kind]()}</p> : null}
        {findings.length === 0 ? <EmptyFrame>{t("The configuration matches how the system is used.")}</EmptyFrame> : (
          <ScrollFrame label={t("Findings table, scrollable")}>
            <TableExport><table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col">{t("Finding")}</th>
                  <th scope="col">{t("Kind")}</th>
                  <th scope="col">{t("Area")}</th>
                  <th scope="col">{t("Affected")}</th>
                  <th scope="col" className="m2-r">{t("At stake")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.check_id}>
                    <td data-label={t("Severity")}><span className="m2-cf-sev" data-tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].word()}</span></td>
                    <th scope="row" className="m2-card-lead">
                      <span className="m2-cf-title">{f.title}</span>
                      <span className="m2-meta">{f.description}</span>
                      {f.remediation ? <span className="m2-meta">{t("Fix: {what}", { what: f.remediation })}</span> : null}
                    </th>
                    <td data-label={t("Kind")}>{KIND[f.category]?.() ?? labelText(f.category)}</td>
                    <td data-label={t("Area")}><Area code={f.module} /></td>
                    <td data-label={t("Affected")}><Affected values={f.affected_elements} /></td>
                    <td className="m2-r" data-label={t("At stake")}>{moneyCompactText(f.estimated_impact_zar, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table></TableExport>
          </ScrollFrame>
        )}
      </Panel>

      <Disclose title={t("How the system is used")} hint={t("Processes, health by area and settings in use.")}>
      <Panel title={t("Processes")} meta={t("Each step sized by the documents that reached it. The step with the most exceptions is marked; the days are the wait before the next step.")} testId="config-processes">
        {processes.isPending ? <Skeleton width="100%" height={200} /> : processes.isError ? <Dash why={t("The processes could not be read.")} /> : (
          <div className="m2-cf-flows">
            {processes.data.processes.map((p) => <Flow key={p.process_id} p={p} />)}
          </div>
        )}
      </Panel>

      <div className="m2-cc-split">
        <Panel title={t("Health by area")} meta={t("100 less 3 per critical, 2 per high, 1 per medium and half per low finding.")} testId="config-health">
          {health.isError ? <Dash why={t("The health scores could not be read.")} /> : (
            <CcHBars
              label={t("Health by area")}
              rows={[...scores].sort((a, b) => a.chs - b.chs).map((s) => ({
                key: s.module,
                label: <Area code={s.module} />,
                value: s.chs,
                text: t("{score}, {n} findings", { score: int(s.chs), n: int(s.critical_count + s.high_count + s.medium_count + s.low_count) }),
                tone: s.critical_count + s.high_count > 0 ? "crit" : s.medium_count > 0 ? "warn" : "pass",
              }))}
            />
          )}
        </Panel>
        <Panel title={t("Settings in use")} meta={t("The share of each area's configured values that carry at least one transaction.")} testId="config-licence">
          {licence.isError ? <Dash why={t("The usage could not be read.")} /> : (
            <CcHBars
              label={t("Settings in use")}
              rows={(licence.data?.modules ?? []).map((m) => ({
                key: m.module,
                label: <Area code={m.module} />,
                value: m.utilisation_pct,
                text: t("{pct}% of {n}, {txn} transactions", { pct: f1(m.utilisation_pct), n: int(m.total_config_elements), txn: int(m.total_transactions) }),
                tone: m.status === "active" ? "pass" : m.status === "underutilised" ? "warn" : "crit",
              }))}
            />
          )}
        </Panel>
      </div>
      </Disclose>
      <Disclose title={t("Changes since the last run")} hint={t("Settings that differ from the previous reading.")}>
      <Panel title={t("Changes since the last run")} meta={drift.data ? t("{n} settings changed", { n: int(drift.data.drift_entries.length) }) : undefined} testId="config-changes">
        {drift.isPending ? <Skeleton width="100%" height={80} /> : notFound(drift.error) ? (
          <EmptyFrame>{t("Changes show once the configuration has been read twice.")}</EmptyFrame>
        ) : drift.isError ? <Dash why={t("The changes could not be read.")} /> : drift.data.drift_entries.length === 0 ? (
          <EmptyFrame>{t("No setting changed since the last run.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Changes table, scrollable")}>
            <TableExport><table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Change")}</th>
                  <th scope="col">{t("Setting")}</th>
                  <th scope="col">{t("Area")}</th>
                  <th scope="col">{t("Before")}</th>
                  <th scope="col">{t("Now")}</th>
                </tr>
              </thead>
              <tbody>
                {drift.data.drift_entries.map((d) => (
                  <tr key={`${d.module}-${d.element_type}-${d.element_value}`}>
                    <td data-label={t("Change")}>{CHANGE[d.change_type]?.() ?? labelText(d.change_type)}</td>
                    <th scope="row" className="m2-card-lead">{labelText(d.element_type)} <Mono>{d.element_value}</Mono></th>
                    <td data-label={t("Area")}><Area code={d.module} /></td>
                    <td data-label={t("Before")}>{d.previous_value ?? <Dash />}</td>
                    <td data-label={t("Now")}>{d.current_value ?? <Dash />}</td>
                  </tr>
                ))}
              </tbody>
            </table></TableExport>
          </ScrollFrame>
        )}
      </Panel>
      </Disclose>
    </CcPage>
  );
}

function Panel({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section className="m2-ck-panel" aria-label={title} data-testid={testId}>
      <header className="m2-ck-head">
        <h2 className="m2-h2">{title}</h2>
        {meta ? <span className="m2-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Affected({ values }: { values: string[] }) {
  if (!values.length) return <Dash />;
  const shown = values.slice(0, 3);
  return (
    <span className="m2-cf-aff">
      {shown.map((v) => <Mono key={v}>{v}</Mono>)}
      {values.length > shown.length ? <span className="m2-meta">{t("and {n} more", { n: int(values.length - shown.length) })}</span> : null}
    </span>
  );
}

/** One process as a chain of steps: width by volume, exceptions as a red share, the missing steps hollow. */
function Flow({ p }: { p: ProcessHealth }) {
  const max = Math.max(1, ...p.steps.map((s) => s.volume));
  const worst = p.bottleneck_step;
  return (
    <div className="m2-cf-flow" data-status={p.status}>
      <div className="m2-cf-flowhead">
        <strong>{AREA[p.process_id]?.() ?? p.process_name}</strong> <Mono>{p.process_id}</Mono>
        <span className="m2-meta">
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
      <ol className="m2-cf-steps">
        {p.steps.map((s) => (
          <li key={s.step_number} className="m2-cf-step" data-missing={!s.detected || undefined} data-worst={s.step_name === worst || undefined}>
            <span className="m2-cf-name">{s.step_name} <Mono>{s.sap_table}</Mono></span>
            <span className="m2-cf-vol" aria-hidden="true">
              <span style={{ width: `${(s.volume / max) * 100}%` }}>
                {s.volume ? <span className="m2-cf-exc" style={{ width: `${Math.min(100, (s.exception_count / s.volume) * 100)}%` }} /> : null}
              </span>
            </span>
            <span className="m2-cf-num">
              {s.detected ? t("{n} documents, {e} exceptions", { n: int(s.volume), e: int(s.exception_count) }) : t("Not found")}
            </span>
            {s.avg_days_to_next_step != null ? <span className="m2-cf-wait">{t("{n} days", { n: f1(s.avg_days_to_next_step) })}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
