"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate, labelOf } from "@/lib/format";
import { createZRule, detectZ, feedbackZAnomaly } from "@/lib/api/v2/sys";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useRefreshV2, useZAnomalies, useZDormant, useZDrift, useZGhost, useZMapping, useZReport, useZRegistry, useZRules } from "@/lib/v2/sys-queries";
import { Fact, Facts } from "../../Inspector";
import { Field, Gate } from "../../forms";
import { ResultFrame, useOutcome } from "../../inspector/shared";
import { ScrollFrame } from "../object/ScrollFrame";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { t as tr } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

const PARTS = [
  { key: "registry", get label() { return tr("Registry"); } },
  { key: "anomalies", get label() { return tr("Anomalies"); } },
  { key: "ghost", get label() { return tr("Ghost"); } },
  { key: "dormant", get label() { return tr("Dormant"); } },
  { key: "drift", get label() { return tr("Drift"); } },
  { key: "rules", get label() { return tr("Rules"); } },
  { key: "mapping", get label() { return tr("Mapping"); } },
] as const;
type Part = (typeof PARTS)[number]["key"];

const day = (v: string | null | undefined) => (v ? formatDate(v, "date") : <Dash />);

interface Q {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** One list's loading, "no analysis yet" (404) and error states, then its body. */
function Feed({ q, empty, children }: { q: Q; empty: string; children: ReactNode }) {
  if (q.isLoading) return <Skeleton width="100%" height={140} />;
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isError && status === 404) return <EmptyFrame>{empty}</EmptyFrame>;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("This list could not be read.")}</ErrorFrame>;
  return <>{children}</>;
}

function Registry() {
  const q = useZRegistry();
  const { hrefFor, open } = useOpenItem();
  const entries = [...(q.data?.entries ?? [])].sort((a, b) => b.transaction_count_total - a.transaction_count_total);
  return (
    <Feed q={q} empty={tr("No custom object has been detected yet. Detect now reads them from the latest stored data.")}>
      {entries.length === 0 ? (
        <EmptyFrame>{tr("No custom objects are registered. Custom Z objects appear once an analysis finds them.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 1, scrollable")}>
          <table className="m2-tbl" data-testid="z-registry">
            <thead>
              <tr>
                <th scope="col">{tr("Object")}</th>
                <th scope="col">{tr("Category")}</th>
                <th scope="col">{tr("Module")}</th>
                <th scope="col">{tr("Standard equivalent")}</th>
                <th scope="col" className="m2-r">{tr("Transactions")}</th>
                <th scope="col">{tr("Last active")}</th>
                <th scope="col">{tr("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} data-current={open?.kind === "zobject" && open.id === e.id ? "true" : undefined}>
                  <th scope="row">
                    <V2Link href={hrefFor({ kind: "zobject", id: e.id })} className="m2-mono">{e.object_name}</V2Link>
                  </th>
                  <td>{labelOf(e.category)}</td>
                  <td>{labelOf(e.module)}</td>
                  <td>{e.standard_equivalent ? <Mono>{e.standard_equivalent}</Mono> : <Dash />}</td>
                  <td className="m2-r">{int(e.transaction_count_total)}</td>
                  <td>{day(e.last_active_date)}</td>
                  <td>{labelOf(e.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Feed>
  );
}

function Anomalies() {
  const q = useZAnomalies();
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const rank = ["critical", "high", "medium", "low"];
  const rows = [...(q.data?.anomalies ?? [])].sort((a, b) => rank.indexOf(a.severity) - rank.indexOf(b.severity) || b.deviation_pct - a.deviation_pct);
  const decide = (id: string, verdict: "dismissed" | "confirmed") =>
    void run(`${verdict}:${id}`, async () => {
      await feedbackZAnomaly(id, verdict);
      refresh();
      return { tone: "ok", title: verdict === "dismissed" ? tr("Marked as expected") : tr("Marked to investigate") };
    });
  return (
    <Feed q={q} empty={tr("No custom object analysis yet. Detect now reads the latest stored data.")}>
      {rows.length === 0 ? (
        <EmptyFrame>{tr("No anomalies were detected on the custom objects in the latest analysis.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 2, scrollable")}>
          <table className="m2-tbl" data-testid="z-anomalies">
            <thead>
              <tr>
                <th scope="col">{tr("Object")}</th>
                <th scope="col">{tr("Anomaly")}</th>
                <th scope="col">{tr("Severity")}</th>
                <th scope="col">{tr("What changed")}</th>
                <th scope="col" className="m2-r">{tr("Deviation")}</th>
                <th scope="col">{tr("Status")}</th>
                <th scope="col"><span className="m2-sr">{tr("Decision")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id ?? `${a.object_name}/${a.anomaly_type}`}>
                  <th scope="row"><Mono>{a.object_name}</Mono></th>
                  <td>{labelOf(a.anomaly_type)}</td>
                  <td>{labelOf(a.severity)}</td>
                  <td>{a.description}</td>
                  <td className="m2-r">{`${a.deviation_pct.toFixed(1)}%`}</td>
                  <td>{a.status === "dismissed" ? tr("Expected") : a.status === "confirmed" ? tr("To investigate") : labelOf(a.status)}</td>
                  <td>
                    {a.id && a.status === "active" && can("ai_feedback") ? (
                      <span className="m2-rowacts">
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => decide(a.id as string, "dismissed")} aria-label={tr("Mark {object_name} {anomaly_type} as expected", { object_name: a.object_name, anomaly_type: a.anomaly_type })}>{tr("Expected")}</button>
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => decide(a.id as string, "confirmed")} aria-label={tr("Investigate {object_name} {anomaly_type}", { object_name: a.object_name, anomaly_type: a.anomaly_type })}>{tr("Investigate")}</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      {!can("ai_feedback") ? <Gate>{tr("Marking an anomaly as expected or to investigate needs the AI feedback permission.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </Feed>
  );
}

function Ghost() {
  const q = useZGhost();
  const rows = q.data ?? [];
  return (
    <Feed q={q} empty={tr("No custom object analysis yet.")}>
      {rows.length === 0 ? (
        <EmptyFrame>{tr("No ghost objects: every custom object in the latest analysis is used.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 3, scrollable")}>
          <table className="m2-tbl" data-testid="z-ghost">
            <thead>
              <tr><th scope="col">{tr("Object")}</th><th scope="col">{tr("Category")}</th><th scope="col">{tr("Module")}</th><th scope="col">{tr("Source field")}</th><th scope="col">{tr("Last active")}</th></tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={`${g.object_name}/${g.source_field}`}>
                  <th scope="row"><Mono>{g.object_name}</Mono></th>
                  <td>{labelOf(g.category)}</td>
                  <td>{labelOf(g.module)}</td>
                  <td><Mono>{g.source_field}</Mono></td>
                  <td>{day(g.last_active_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Feed>
  );
}

function Dormant() {
  const q = useZDormant();
  const rows = q.data ?? [];
  return (
    <Feed q={q} empty={tr("No custom object analysis yet.")}>
      {rows.length === 0 ? (
        <EmptyFrame>{tr("No dormant objects or fields in the latest analysis.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 4, scrollable")}>
          <table className="m2-tbl" data-testid="z-dormant">
            <thead>
              <tr><th scope="col">{tr("Object")}</th><th scope="col">{tr("Category")}</th><th scope="col">{tr("Module")}</th><th scope="col">{tr("Last active")}</th><th scope="col" className="m2-r">{tr("Months inactive")}</th></tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.object_name}>
                  <th scope="row"><Mono>{g.object_name}</Mono></th>
                  <td>{labelOf(g.category)}</td>
                  <td>{labelOf(g.module)}</td>
                  <td>{day(g.last_active_date)}</td>
                  <td className="m2-r">{g.months_inactive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Feed>
  );
}

function DriftList() {
  const q = useZDrift();
  const rows = q.data ?? [];
  return (
    <Feed q={q} empty={tr("No custom object analysis yet.")}>
      {rows.length === 0 ? (
        <EmptyFrame>{tr("The custom objects are unchanged since the previous run.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 5, scrollable")}>
          <table className="m2-tbl" data-testid="z-drift">
            <thead>
              <tr><th scope="col">{tr("Object")}</th><th scope="col">{tr("Module")}</th><th scope="col">{tr("Source field")}</th><th scope="col">{tr("Change")}</th><th scope="col">{tr("First detected")}</th></tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={`${g.object_name}/${g.source_field}/${g.change_type}`}>
                  <th scope="row"><Mono>{g.object_name}</Mono></th>
                  <td>{labelOf(g.module)}</td>
                  <td><Mono>{g.source_field}</Mono></td>
                  <td>{labelOf(g.change_type)}</td>
                  <td>{day(g.first_detected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Feed>
  );
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** The form that creates a custom Z rule: a name, the condition, the severity and the object it applies to. */
export function NewZRule({ objectId, onDone }: { objectId?: string; onDone?: () => void }) {
  const entries = useZRegistry().data?.entries ?? [];
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [target, setTarget] = useState(objectId ?? "any");
  const [shown, setShown] = useState(false);
  if (!can("manage_rules")) return <Gate>{tr("Creating a Z rule needs the manage rules permission.")}</Gate>;
  const nameErr = shown && !name.trim() ? tr("Enter a rule name") : undefined;
  const condErr = shown && !condition.trim() ? tr("Enter the condition") : undefined;
  return (
    <form
      className="m2-form6"
      aria-label={tr("New Z rule")}
      onSubmit={(e) => {
        e.preventDefault();
        setShown(true);
        if (!name.trim() || !condition.trim()) return;
        void run("create", async () => {
          await createZRule({ rule_name: name.trim(), custom_condition: condition.trim(), severity, ...(target !== "any" ? { z_object_id: target } : {}) });
          setName("");
          setCondition("");
          setShown(false);
          refresh();
          onDone?.();
          return { tone: "ok", title: tr("Z rule created"), detail: tr("It runs from the next analysis.") };
        });
      }}
    >
      <Field label={tr("Rule name")} error={nameErr}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={tr("Condition")} error={condErr} hint={tr("For example ZZFIELD is not blank")}>{(p) => <input {...p} className="m2-mono" value={condition} onChange={(e) => setCondition(e.target.value)} />}</Field>
      <div className="m2-grid2">
        <Field label={tr("Severity")}>
          {(p) => (
            <select {...p} value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{labelOf(s)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={tr("Applies to")}>
          {(p) => (
            <select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="any">{tr("Any custom object")}</option>
              {entries.map((e) => (
                <option key={e.id} value={e.id}>{e.object_name}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="m2-acts">
        <button type="submit" className="m2-btn m2-strong" disabled={pending !== null}>{pending === "create" ? tr("Creating…") : tr("Create Z rule")}</button>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </form>
  );
}

function Rules() {
  const q = useZRules();
  const entries = useZRegistry().data?.entries ?? [];
  const name = new Map(entries.map((e) => [e.id, e.object_name]));
  return (
    <Feed q={q} empty={tr("No rules read.")}>
      <h3>{tr("Custom Z rules")}</h3>
      {(q.data?.custom_rules ?? []).length === 0 ? (
        <EmptyFrame>{tr("No custom Z rules yet. The templates below cover the common checks.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 6, scrollable")}>
          <table className="m2-tbl" data-testid="z-rules">
            <thead><tr><th scope="col">{tr("Rule")}</th><th scope="col">{tr("Condition")}</th><th scope="col">{tr("Applies to")}</th><th scope="col">{tr("Severity")}</th><th scope="col">{tr("State")}</th></tr></thead>
            <tbody>
              {(q.data?.custom_rules ?? []).map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.rule_name}</th>
                  <td><Mono>{r.custom_condition ?? "—"}</Mono></td>
                  <td>{r.z_object_id ? name.get(r.z_object_id) ?? "—" : tr("Any custom object")}</td>
                  <td>{labelOf(r.severity)}</td>
                  <td>{r.is_active ? tr("Active") : tr("Inactive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      <h3 style={{ marginTop: 16 }}>{tr("New Z rule")}</h3>
      <NewZRule />
      <h3 style={{ marginTop: 16 }}>{tr("Rule templates")}</h3>
      <ScrollFrame label={tr("Table 7, scrollable")}>
        <table className="m2-tbl">
          <thead><tr><th scope="col">{tr("Template")}</th><th scope="col">{tr("What it checks")}</th><th scope="col">{tr("Default severity")}</th></tr></thead>
          <tbody>
            {(q.data?.templates ?? []).map((t) => (
              <tr key={t.template_id}><th scope="row">{t.name}</th><td>{t.description}</td><td>{labelOf(t.default_severity)}</td></tr>
            ))}
          </tbody>
        </table>
      </ScrollFrame>
    </Feed>
  );
}

function Mapping() {
  const q = useZMapping();
  const rows = q.data?.mappings ?? [];
  return (
    <Feed q={q} empty={tr("No custom object analysis yet.")}>
      {rows.length === 0 ? (
        <EmptyFrame>{tr("No mappings yet. They appear once custom objects are detected.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 8, scrollable")}>
          <table className="m2-tbl" data-testid="z-mapping">
            <thead><tr><th scope="col">{tr("Custom field")}</th><th scope="col">{tr("Module")}</th><th scope="col">{tr("Standard field")}</th><th scope="col" className="m2-r">{tr("Confidence")}</th><th scope="col">{tr("Source")}</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={`${m.module}/${m.object_name}`}>
                  <th scope="row"><Mono>{m.object_name}</Mono></th>
                  <td>{labelOf(m.module)}</td>
                  <td>{m.standard_equivalent ? <Mono>{m.standard_equivalent}</Mono> : tr("Not mapped")}</td>
                  <td className="m2-r">{`${Math.round(m.confidence * 100)}%`}</td>
                  <td>{labelOf(m.mapping_source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Feed>
  );
}

/**
 * System › Custom objects: the Z objects found across the connected systems. The registry (open one for its profile and
 * to edit it), anomalies with the expected or investigate decision, ghost and dormant objects, drift, the Z rules with
 * a form to create one, and the mapping to standard fields. The analysis is tenant-wide, so the page says so.
 */
export function CustomObjects({ id }: { id: string }) {
  const params = useSearchParams();
  const part: Part = PARTS.find((p) => p.key === params.get("part"))?.key ?? "registry";
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const report = useZReport();
  const { outcome, pending, run } = useOutcome();
  const href = (key: Part) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "custom-objects");
    next.delete("open");
    if (key === "registry") next.delete("part");
    else next.set("part", key);
    return `/v2/s/${id}?${next.toString()}`;
  };
  const detect = () =>
    void run("detect", async () => {
      await detectZ(id);
      refresh();
      return { tone: "ok", title: tr("Detection started"), detail: tr("It reruns custom object detection on the latest stored data of this system.") };
    });
  const r = report.data;
  return (
    <>
      <p className="m2-note">{tr("Custom (Z) objects found across every connected system in this workspace, from the latest analysis.")}</p>
      {r ? (
        <Facts>
          <Fact label={tr("Custom objects")}>{r.total_z_objects}</Fact>
          <Fact label={tr("Active anomalies")}>{r.active_anomalies}</Fact>
          <Fact label={tr("Ghost and dormant")}>{tr("{ghost_objects} ghost, {dormant_objects} dormant", { ghost_objects: r.ghost_objects, dormant_objects: r.dormant_objects })}</Fact>
          <Fact label={tr("Mapped to standard")}>{tr("{mapped_to_standard} of {total_z_objects}", { mapped_to_standard: r.mapped_to_standard, total_z_objects: r.total_z_objects })}</Fact>
        </Facts>
      ) : null}
      <div className="m2-acts" style={{ marginTop: 12 }}>
        <button type="button" className="m2-btn" disabled={!can("analyse") || pending !== null} onClick={detect}>
          {pending === "detect" ? tr("Starting…") : tr("Detect now")}
        </button>
      </div>
      {!can("analyse") ? <Gate>{tr("Detecting custom objects needs the analyse permission.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <nav className="m2-subtabs" aria-label={tr("Custom object views")}>
        {PARTS.map((p) => (
          <V2Link key={p.key} href={href(p.key)} className="m2-seg" aria-current={p.key === part ? "page" : undefined}>
            {p.label}
          </V2Link>
        ))}
      </nav>
      {part === "registry" ? <Registry /> : part === "anomalies" ? <Anomalies /> : part === "ghost" ? <Ghost /> : part === "dormant" ? <Dormant /> : part === "drift" ? <DriftList /> : part === "rules" ? <Rules /> : <Mapping />}
    </>
  );
}
