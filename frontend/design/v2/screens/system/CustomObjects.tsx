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

const PARTS = [
  { key: "registry", label: "Registry" },
  { key: "anomalies", label: "Anomalies" },
  { key: "ghost", label: "Ghost" },
  { key: "dormant", label: "Dormant" },
  { key: "drift", label: "Drift" },
  { key: "rules", label: "Rules" },
  { key: "mapping", label: "Mapping" },
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
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>This list could not be read.</ErrorFrame>;
  return <>{children}</>;
}

function Registry() {
  const q = useZRegistry();
  const { hrefFor, open } = useOpenItem();
  const entries = [...(q.data?.entries ?? [])].sort((a, b) => b.transaction_count_total - a.transaction_count_total);
  return (
    <Feed q={q} empty="No custom object has been detected yet. Detect now reads them from the latest stored data.">
      {entries.length === 0 ? (
        <EmptyFrame>No custom objects are registered. Custom Z objects appear once an analysis finds them.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 1, scrollable">
          <table className="m2-tbl" data-testid="z-registry">
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">Category</th>
                <th scope="col">Module</th>
                <th scope="col">Standard equivalent</th>
                <th scope="col" className="m2-r">Transactions</th>
                <th scope="col">Last active</th>
                <th scope="col">Status</th>
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
                  <td className="m2-r">{e.transaction_count_total.toLocaleString("en-US")}</td>
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
      return { tone: "ok", title: verdict === "dismissed" ? "Marked as expected" : "Marked to investigate" };
    });
  return (
    <Feed q={q} empty="No custom object analysis yet. Detect now reads the latest stored data.">
      {rows.length === 0 ? (
        <EmptyFrame>No anomalies were detected on the custom objects in the latest analysis.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 2, scrollable">
          <table className="m2-tbl" data-testid="z-anomalies">
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">Anomaly</th>
                <th scope="col">Severity</th>
                <th scope="col">What changed</th>
                <th scope="col" className="m2-r">Deviation</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="m2-sr">Decision</span></th>
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
                  <td>{a.status === "dismissed" ? "Expected" : a.status === "confirmed" ? "To investigate" : labelOf(a.status)}</td>
                  <td>
                    {a.id && a.status === "active" && can("ai_feedback") ? (
                      <span className="m2-rowacts">
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => decide(a.id as string, "dismissed")} aria-label={`Mark ${a.object_name} ${a.anomaly_type} as expected`}>Expected</button>
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => decide(a.id as string, "confirmed")} aria-label={`Investigate ${a.object_name} ${a.anomaly_type}`}>Investigate</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      {!can("ai_feedback") ? <Gate>Marking an anomaly as expected or to investigate needs the AI feedback permission.</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </Feed>
  );
}

function Ghost() {
  const q = useZGhost();
  const rows = q.data ?? [];
  return (
    <Feed q={q} empty="No custom object analysis yet.">
      {rows.length === 0 ? (
        <EmptyFrame>No ghost objects: every custom object in the latest analysis is used.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 3, scrollable">
          <table className="m2-tbl" data-testid="z-ghost">
            <thead>
              <tr><th scope="col">Object</th><th scope="col">Category</th><th scope="col">Module</th><th scope="col">Source field</th><th scope="col">Last active</th></tr>
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
    <Feed q={q} empty="No custom object analysis yet.">
      {rows.length === 0 ? (
        <EmptyFrame>No dormant objects or fields in the latest analysis.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 4, scrollable">
          <table className="m2-tbl" data-testid="z-dormant">
            <thead>
              <tr><th scope="col">Object</th><th scope="col">Category</th><th scope="col">Module</th><th scope="col">Last active</th><th scope="col" className="m2-r">Months inactive</th></tr>
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
    <Feed q={q} empty="No custom object analysis yet.">
      {rows.length === 0 ? (
        <EmptyFrame>The custom objects are unchanged since the previous run.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 5, scrollable">
          <table className="m2-tbl" data-testid="z-drift">
            <thead>
              <tr><th scope="col">Object</th><th scope="col">Module</th><th scope="col">Source field</th><th scope="col">Change</th><th scope="col">First detected</th></tr>
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
  if (!can("manage_rules")) return <Gate>Creating a Z rule needs the manage rules permission.</Gate>;
  const nameErr = shown && !name.trim() ? "Enter a rule name" : undefined;
  const condErr = shown && !condition.trim() ? "Enter the condition" : undefined;
  return (
    <form
      className="m2-form6"
      aria-label="New Z rule"
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
          return { tone: "ok", title: "Z rule created", detail: "It runs from the next analysis." };
        });
      }}
    >
      <Field label="Rule name" error={nameErr}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Condition" error={condErr} hint="For example ZZFIELD is not blank">{(p) => <input {...p} className="m2-mono" value={condition} onChange={(e) => setCondition(e.target.value)} />}</Field>
      <div className="m2-grid2">
        <Field label="Severity">
          {(p) => (
            <select {...p} value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{labelOf(s)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Applies to">
          {(p) => (
            <select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="any">Any custom object</option>
              {entries.map((e) => (
                <option key={e.id} value={e.id}>{e.object_name}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="m2-acts">
        <button type="submit" className="m2-btn m2-strong" disabled={pending !== null}>{pending === "create" ? "Creating…" : "Create Z rule"}</button>
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
    <Feed q={q} empty="No rules read.">
      <h3>Custom Z rules</h3>
      {(q.data?.custom_rules ?? []).length === 0 ? (
        <EmptyFrame>No custom Z rules yet. The templates below cover the common checks.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 6, scrollable">
          <table className="m2-tbl" data-testid="z-rules">
            <thead><tr><th scope="col">Rule</th><th scope="col">Condition</th><th scope="col">Applies to</th><th scope="col">Severity</th><th scope="col">State</th></tr></thead>
            <tbody>
              {(q.data?.custom_rules ?? []).map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.rule_name}</th>
                  <td><Mono>{r.custom_condition ?? "—"}</Mono></td>
                  <td>{r.z_object_id ? name.get(r.z_object_id) ?? "—" : "Any custom object"}</td>
                  <td>{labelOf(r.severity)}</td>
                  <td>{r.is_active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      <h3 style={{ marginTop: 16 }}>New Z rule</h3>
      <NewZRule />
      <h3 style={{ marginTop: 16 }}>Rule templates</h3>
      <ScrollFrame label="Table 7, scrollable">
        <table className="m2-tbl">
          <thead><tr><th scope="col">Template</th><th scope="col">What it checks</th><th scope="col">Default severity</th></tr></thead>
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
    <Feed q={q} empty="No custom object analysis yet.">
      {rows.length === 0 ? (
        <EmptyFrame>No mappings yet. They appear once custom objects are detected.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 8, scrollable">
          <table className="m2-tbl" data-testid="z-mapping">
            <thead><tr><th scope="col">Custom field</th><th scope="col">Module</th><th scope="col">Standard field</th><th scope="col" className="m2-r">Confidence</th><th scope="col">Source</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={`${m.module}/${m.object_name}`}>
                  <th scope="row"><Mono>{m.object_name}</Mono></th>
                  <td>{labelOf(m.module)}</td>
                  <td>{m.standard_equivalent ? <Mono>{m.standard_equivalent}</Mono> : "Not mapped"}</td>
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
      return { tone: "ok", title: "Detection started", detail: "It reruns custom object detection on the latest stored data of this system." };
    });
  const r = report.data;
  return (
    <>
      <p className="m2-note">Custom (Z) objects found across every connected system in this workspace, from the latest analysis.</p>
      {r ? (
        <Facts>
          <Fact label="Custom objects">{r.total_z_objects}</Fact>
          <Fact label="Active anomalies">{r.active_anomalies}</Fact>
          <Fact label="Ghost and dormant">{`${r.ghost_objects} ghost, ${r.dormant_objects} dormant`}</Fact>
          <Fact label="Mapped to standard">{`${r.mapped_to_standard} of ${r.total_z_objects}`}</Fact>
        </Facts>
      ) : null}
      <div className="m2-acts" style={{ marginTop: 12 }}>
        <button type="button" className="m2-btn" disabled={!can("analyse") || pending !== null} onClick={detect}>
          {pending === "detect" ? "Starting…" : "Detect now"}
        </button>
      </div>
      {!can("analyse") ? <Gate>Detecting custom objects needs the analyse permission.</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <nav className="m2-subtabs" aria-label="Custom object views">
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
