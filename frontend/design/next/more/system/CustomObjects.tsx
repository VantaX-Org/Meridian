"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate, labelOf } from "@/lib/format";
import { createZRule, detectZ, feedbackZAnomaly } from "@/lib/api/v2/sys";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useRefreshV2, useZAnomalies, useZDormant, useZDrift, useZGhost, useZMapping, useZReport, useZRegistry, useZRules } from "@/lib/v2/sys-queries";
import { describeField, describeTable } from "@/lib/v2/sap-fields";
import { DASH, int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { useOutcome } from "@/design/v2/inspector/shared";
import { Button, Code, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton, type Column } from "../../kit";
import { ExportTable } from "../ExportTable";
import { Figs, Panel } from "../cfg-parts";
import { Result } from "./Result";

type Part = "registry" | "anomalies" | "ghost" | "dormant" | "drift" | "rules" | "mapping";
const PARTS: Part[] = ["registry", "anomalies", "ghost", "dormant", "drift", "rules", "mapping"];

const day = (v: string | null | undefined) => (v ? formatDate(v, "date") : DASH);
const obj = (name: string) => <Code code={name} text={describeTable(name) ?? undefined} />;
const fld = (name: string) => <Code code={name} text={describeField(name) ?? undefined} />;

interface Q {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** One list's loading, "no analysis yet" (404) and error states, then its body. */
function Feed({ q, empty, label, children }: { q: Q; empty: string; label: string; children: ReactNode }) {
  if (q.isLoading) return <Skeleton lines={4} label={label} />;
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isError && status === 404) return <EmptyState heading={empty} />;
  if (q.isError) return <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
  return <>{children}</>;
}

/** A list in the kit table, with the export and the test id the system views are found by. */
function List<R>({ testId, caption, rows, columns, rowKey, rowLabel }: { testId?: string; caption: string; rows: R[]; columns: Column<R>[]; rowKey: (r: R) => string; rowLabel: (r: R) => string }) {
  return (
    <ExportTable>
      <div data-testid={testId}>
        <DataTable rows={rows} columns={columns} rowKey={rowKey} rowLabel={rowLabel} caption={caption} />
      </div>
    </ExportTable>
  );
}

function Registry() {
  const q = useZRegistry();
  const { hrefFor } = useOpenItem();
  type E = NonNullable<typeof q.data>["entries"][number];
  const entries = [...(q.data?.entries ?? [])].sort((a, b) => b.transaction_count_total - a.transaction_count_total);
  const columns: Column<E>[] = [
    { id: "object", label: t("Object"), cell: (e) => <V2Link className="nx-link" href={hrefFor({ kind: "zobject", id: e.id })}>{obj(e.object_name)}</V2Link> },
    { id: "category", label: t("Category"), cell: (e) => labelOf(e.category) },
    { id: "module", label: t("Module"), cell: (e) => labelOf(e.module) },
    { id: "standard", label: t("Standard equivalent"), cell: (e) => (e.standard_equivalent ? obj(e.standard_equivalent) : DASH) },
    { id: "tx", label: t("Transactions"), align: "end", cell: (e) => int(e.transaction_count_total) },
    { id: "last", label: t("Last active"), cell: (e) => day(e.last_active_date) },
    { id: "status", label: t("Status"), cell: (e) => labelOf(e.status) },
  ];
  return (
    <Feed q={q} label={t("Registry")} empty={t("No custom object has been detected yet. Detect now reads them from the latest stored data.")}>
      {entries.length === 0 ? (
        <EmptyState heading={t("No custom objects are registered. Custom Z objects appear once an analysis finds them.")} />
      ) : (
        <List testId="z-registry" caption={t("Registry")} rows={entries} columns={columns} rowKey={(e) => e.id} rowLabel={(e) => e.object_name} />
      )}
    </Feed>
  );
}

const RANK = ["critical", "high", "medium", "low"];

function Anomalies() {
  const q = useZAnomalies();
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  type A = NonNullable<typeof q.data>["anomalies"][number];
  const rows = [...(q.data?.anomalies ?? [])].sort((a, b) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity) || b.deviation_pct - a.deviation_pct);
  const decide = (id: string, verdict: "dismissed" | "confirmed") =>
    void run(`${verdict}:${id}`, async () => {
      await feedbackZAnomaly(id, verdict);
      refresh();
      return { tone: "ok", title: verdict === "dismissed" ? t("Marked as expected") : t("Marked to investigate") };
    });
  const columns: Column<A>[] = [
    { id: "object", label: t("Object"), cell: (a) => obj(a.object_name) },
    { id: "type", label: t("Anomaly"), cell: (a) => labelOf(a.anomaly_type) },
    { id: "severity", label: t("Severity"), cell: (a) => labelOf(a.severity) },
    { id: "what", label: t("What changed"), cell: (a) => a.description },
    { id: "dev", label: t("Deviation"), align: "end", cell: (a) => `${a.deviation_pct.toFixed(1)}%` },
    { id: "status", label: t("Status"), cell: (a) => (a.status === "dismissed" ? t("Expected") : a.status === "confirmed" ? t("To investigate") : labelOf(a.status)) },
    {
      id: "decision", label: t("Decision"), hidden: !can("ai_feedback"),
      cell: (a) => (a.id && a.status === "active" ? (
        <span className="nx-row">
          <Button size={32} variant="quiet" disabled={pending !== null} onClick={() => decide(a.id as string, "dismissed")} aria-label={t("Mark {object_name} {anomaly_type} as expected", { object_name: a.object_name, anomaly_type: a.anomaly_type })}>{t("Expected")}</Button>
          <Button size={32} variant="quiet" disabled={pending !== null} onClick={() => decide(a.id as string, "confirmed")} aria-label={t("Investigate {object_name} {anomaly_type}", { object_name: a.object_name, anomaly_type: a.anomaly_type })}>{t("Investigate")}</Button>
        </span>
      ) : null),
    },
  ];
  return (
    <Feed q={q} label={t("Anomalies")} empty={t("No custom object analysis yet. Detect now reads the latest stored data.")}>
      {rows.length === 0 ? (
        <EmptyState heading={t("No anomalies were detected on the custom objects in the latest analysis.")} />
      ) : (
        <List testId="z-anomalies" caption={t("Anomalies")} rows={rows} columns={columns} rowKey={(a) => a.id ?? `${a.object_name}/${a.anomaly_type}`} rowLabel={(a) => a.object_name} />
      )}
      {!can("ai_feedback") ? <p className="nx-sub">{t("Marking an anomaly as expected or to investigate needs the AI feedback permission.")}</p> : null}
      {outcome ? <Result outcome={outcome} /> : null}
    </Feed>
  );
}

function Ghost() {
  const q = useZGhost();
  type G = NonNullable<typeof q.data>[number];
  const columns: Column<G>[] = [
    { id: "object", label: t("Object"), cell: (g) => obj(g.object_name) },
    { id: "category", label: t("Category"), cell: (g) => labelOf(g.category) },
    { id: "module", label: t("Module"), cell: (g) => labelOf(g.module) },
    { id: "field", label: t("Source field"), cell: (g) => fld(g.source_field) },
    { id: "last", label: t("Last active"), cell: (g) => day(g.last_active_date) },
  ];
  const rows = q.data ?? [];
  return (
    <Feed q={q} label={t("Ghost")} empty={t("No custom object analysis yet.")}>
      {rows.length === 0 ? <EmptyState heading={t("No ghost objects: every custom object in the latest analysis is used.")} /> : (
        <List testId="z-ghost" caption={t("Ghost")} rows={rows} columns={columns} rowKey={(g) => `${g.object_name}/${g.source_field}`} rowLabel={(g) => g.object_name} />
      )}
    </Feed>
  );
}

function Dormant() {
  const q = useZDormant();
  type G = NonNullable<typeof q.data>[number];
  const columns: Column<G>[] = [
    { id: "object", label: t("Object"), cell: (g) => obj(g.object_name) },
    { id: "category", label: t("Category"), cell: (g) => labelOf(g.category) },
    { id: "module", label: t("Module"), cell: (g) => labelOf(g.module) },
    { id: "last", label: t("Last active"), cell: (g) => day(g.last_active_date) },
    { id: "months", label: t("Months inactive"), align: "end", cell: (g) => g.months_inactive },
  ];
  const rows = q.data ?? [];
  return (
    <Feed q={q} label={t("Dormant")} empty={t("No custom object analysis yet.")}>
      {rows.length === 0 ? <EmptyState heading={t("No dormant objects or fields in the latest analysis.")} /> : (
        <List testId="z-dormant" caption={t("Dormant")} rows={rows} columns={columns} rowKey={(g) => g.object_name} rowLabel={(g) => g.object_name} />
      )}
    </Feed>
  );
}

function DriftList() {
  const q = useZDrift();
  type G = NonNullable<typeof q.data>[number];
  const columns: Column<G>[] = [
    { id: "object", label: t("Object"), cell: (g) => obj(g.object_name) },
    { id: "module", label: t("Module"), cell: (g) => labelOf(g.module) },
    { id: "field", label: t("Source field"), cell: (g) => fld(g.source_field) },
    { id: "change", label: t("Change"), cell: (g) => labelOf(g.change_type) },
    { id: "first", label: t("First detected"), cell: (g) => day(g.first_detected) },
  ];
  const rows = q.data ?? [];
  return (
    <Feed q={q} label={t("Drift")} empty={t("No custom object analysis yet.")}>
      {rows.length === 0 ? <EmptyState heading={t("The custom objects are unchanged since the previous run.")} /> : (
        <List testId="z-drift" caption={t("Drift")} rows={rows} columns={columns} rowKey={(g) => `${g.object_name}/${g.source_field}/${g.change_type}`} rowLabel={(g) => g.object_name} />
      )}
    </Feed>
  );
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** The form that creates a custom Z rule: a name, the condition, the severity and the object it applies to. */
function NewZRule() {
  const entries = useZRegistry().data?.entries ?? [];
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [ruleSeverity, setRuleSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [target, setTarget] = useState("any");
  const [shown, setShown] = useState(false);
  if (!can("manage_rules")) return <p className="nx-sub">{t("Creating a Z rule needs the manage rules permission.")}</p>;
  const nameErr = shown && !name.trim() ? t("Enter a rule name") : undefined;
  const condErr = shown && !condition.trim() ? t("Enter the condition") : undefined;
  return (
    <form
      className="nx-body"
      aria-label={t("New Z rule")}
      onSubmit={(e) => {
        e.preventDefault();
        setShown(true);
        if (!name.trim() || !condition.trim()) return;
        void run("create", async () => {
          await createZRule({ rule_name: name.trim(), custom_condition: condition.trim(), severity: ruleSeverity, ...(target !== "any" ? { z_object_id: target } : {}) });
          setName("");
          setCondition("");
          setShown(false);
          refresh();
          return { tone: "ok", title: t("Z rule created"), detail: t("It runs from the next analysis.") };
        });
      }}
    >
      <label className="nx-field">
        {t("Rule name")}
        <input className="nx-input" value={name} aria-invalid={nameErr ? true : undefined} onChange={(e) => setName(e.target.value)} />
        {nameErr ? <span role="alert" className="nx-error-line">{nameErr}</span> : null}
      </label>
      <label className="nx-field">
        {t("Condition")}
        <input className="nx-input" value={condition} aria-invalid={condErr ? true : undefined} onChange={(e) => setCondition(e.target.value)} />
        <span className="nx-sub">{t("For example ZZFIELD is not blank")}</span>
        {condErr ? <span role="alert" className="nx-error-line">{condErr}</span> : null}
      </label>
      <div className="nx-row nx-wrap">
        <label className="nx-field">
          {t("Severity")}
          <select className="nx-input" value={ruleSeverity} onChange={(e) => setRuleSeverity(e.target.value as (typeof SEVERITIES)[number])}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{labelOf(s)}</option>)}
          </select>
        </label>
        <label className="nx-field">
          {t("Applies to")}
          <select className="nx-input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="any">{t("Any custom object")}</option>
            {entries.map((x) => <option key={x.id} value={x.id}>{x.object_name}</option>)}
          </select>
        </label>
      </div>
      <div className="nx-row">
        <Button type="submit" size={32} variant="primary" loading={pending === "create"} disabled={pending !== null}>{t("Create Z rule")}</Button>
      </div>
      {outcome ? <Result outcome={outcome} /> : null}
    </form>
  );
}

function Rules() {
  const q = useZRules();
  const entries = useZRegistry().data?.entries ?? [];
  const name = new Map(entries.map((e) => [e.id, e.object_name]));
  type R = NonNullable<typeof q.data>["custom_rules"][number];
  type T = NonNullable<typeof q.data>["templates"][number];
  const ruleColumns: Column<R>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => r.rule_name },
    { id: "cond", label: t("Condition"), cell: (r) => (r.custom_condition ? <Code code={r.custom_condition} /> : DASH) },
    { id: "applies", label: t("Applies to"), cell: (r) => (r.z_object_id ? name.get(r.z_object_id) ?? DASH : t("Any custom object")) },
    { id: "severity", label: t("Severity"), cell: (r) => labelOf(r.severity) },
    { id: "state", label: t("State"), cell: (r) => (r.is_active ? t("Active") : t("Inactive")) },
  ];
  const tplColumns: Column<T>[] = [
    { id: "name", label: t("Template"), cell: (x) => x.name },
    { id: "what", label: t("What it checks"), cell: (x) => x.description },
    { id: "sev", label: t("Default severity"), cell: (x) => labelOf(x.default_severity) },
  ];
  const rules = q.data?.custom_rules ?? [];
  return (
    <Feed q={q} label={t("Rules")} empty={t("No rules read.")}>
      <Panel title={t("Custom Z rules")} testId="z-rules-panel">
        {rules.length === 0 ? <EmptyState heading={t("No custom Z rules yet. The templates below cover the common checks.")} /> : (
          <List testId="z-rules" caption={t("Custom Z rules")} rows={rules} columns={ruleColumns} rowKey={(r) => r.id} rowLabel={(r) => r.rule_name} />
        )}
      </Panel>
      <Panel title={t("New Z rule")} testId="z-new-rule"><NewZRule /></Panel>
      <Panel title={t("Rule templates")} testId="z-templates">
        <List caption={t("Rule templates")} rows={q.data?.templates ?? []} columns={tplColumns} rowKey={(x) => x.template_id} rowLabel={(x) => x.name} />
      </Panel>
    </Feed>
  );
}

function Mapping() {
  const q = useZMapping();
  type M = NonNullable<typeof q.data>["mappings"][number];
  const columns: Column<M>[] = [
    { id: "custom", label: t("Custom field"), cell: (m) => fld(m.object_name) },
    { id: "module", label: t("Module"), cell: (m) => labelOf(m.module) },
    { id: "standard", label: t("Standard field"), cell: (m) => (m.standard_equivalent ? fld(m.standard_equivalent) : t("Not mapped")) },
    { id: "conf", label: t("Confidence"), align: "end", cell: (m) => `${Math.round(m.confidence * 100)}%` },
    { id: "source", label: t("Source"), cell: (m) => labelOf(m.mapping_source) },
  ];
  const rows = q.data?.mappings ?? [];
  return (
    <Feed q={q} label={t("Mapping")} empty={t("No custom object analysis yet.")}>
      {rows.length === 0 ? <EmptyState heading={t("No mappings yet. They appear once custom objects are detected.")} /> : (
        <List testId="z-mapping" caption={t("Mapping")} rows={rows} columns={columns} rowKey={(m) => `${m.module}/${m.object_name}`} rowLabel={(m) => m.object_name} />
      )}
    </Feed>
  );
}

/**
 * System, Custom objects: the Z objects found across the connected systems. The registry (open one for its profile),
 * anomalies with the expected or investigate decision, ghost and dormant objects, drift, the Z rules with a form to
 * create one, and the mapping to standard fields. The analysis is tenant-wide, so the page says so.
 */
export function CustomObjects({ id }: { id: string }) {
  const params = useSearchParams();
  const [part, setPart] = useState<Part>(() => PARTS.find((p) => p === params.get("part")) ?? "registry");
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const report = useZReport();
  const { outcome, pending, run } = useOutcome();
  const detect = () =>
    void run("detect", async () => {
      await detectZ(id);
      refresh();
      return { tone: "ok", title: t("Detection started"), detail: t("It reruns custom object detection on the latest stored data of this system.") };
    });
  const r = report.data;
  return (
    <Panel title={t("Custom objects")} testId="n-custom-objects">
      <p className="nx-note">{t("Custom (Z) objects found across every connected system in this workspace, from the latest analysis.")}</p>
      {r ? (
        <Figs label={t("Custom objects")} figs={[
          { label: t("Custom objects"), value: int(r.total_z_objects) },
          { label: t("Active anomalies"), value: int(r.active_anomalies) },
          { label: t("Ghost and dormant"), value: t("{ghost_objects} ghost, {dormant_objects} dormant", { ghost_objects: r.ghost_objects, dormant_objects: r.dormant_objects }) },
          { label: t("Mapped to standard"), value: t("{mapped_to_standard} of {total_z_objects}", { mapped_to_standard: r.mapped_to_standard, total_z_objects: r.total_z_objects }) },
        ]} />
      ) : null}
      <div className="nx-row">
        <Button size={32} variant="secondary" disabled={!can("analyse") || pending !== null} loading={pending === "detect"} onClick={detect}>{t("Detect now")}</Button>
      </div>
      {!can("analyse") ? <p className="nx-sub">{t("Detecting custom objects needs the analyse permission.")}</p> : null}
      {outcome ? <Result outcome={outcome} /> : null}
      <SegmentedControl label={t("Custom object views")} value={part} onChange={setPart} items={[
        { value: "registry", label: t("Registry") },
        { value: "anomalies", label: t("Anomalies") },
        { value: "ghost", label: t("Ghost") },
        { value: "dormant", label: t("Dormant") },
        { value: "drift", label: t("Drift") },
        { value: "rules", label: t("Rules") },
        { value: "mapping", label: t("Mapping") },
      ]} />
      {part === "registry" ? <Registry /> : part === "anomalies" ? <Anomalies /> : part === "ghost" ? <Ghost /> : part === "dormant" ? <Dormant /> : part === "drift" ? <DriftList /> : part === "rules" ? <Rules /> : <Mapping />}
    </Panel>
  );
}
