"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate, labelOf } from "@/lib/format";
import { createZRule, feedbackZAnomaly, updateZEntry, type ZRegistryEntry } from "@/lib/api/v2/sys";
import type { ZRegistryStatus } from "@/lib/api/z-objects";
import { splitFieldId, type CatalogueField, type CatalogueTable } from "@/lib/api/v2/catalogue";
import type { FieldMapping } from "@/lib/api/field-mappings";
import * as adminApi from "@/lib/api/v2/admin";
import { draftTermWithAi, reviewTerm, updateTerm } from "@/lib/api/v2/mdm";
import { catalogueStatus, nodeTypeText, sourceText, typeText, useCatalogueTable } from "@/lib/v2/catalogue";
import { useOpenItem, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { refreshV2, useLandscape } from "@/lib/v2/queries";
import { useObjectOwners, useTerm } from "@/lib/v2/mdm-queries";
import { refreshAdmin, useMappings } from "@/lib/v2/admin-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { f1, int, moduleSlug, pct1 } from "@/lib/v2/score";
import { useRefreshV2, useZAnomalies, useZProfile, useZRegistry } from "@/lib/v2/sys-queries";
import { V2Link } from "@/design/v2/parts";
import { SeverityMark } from "@/design/v2/marks";
import { Button, Chip, Code, Confirm, EmptyState, ErrorState, Skeleton, useToast, type ChipTone } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Field, Gate, Note, OutcomeLine, Sec, useOutcome } from "./objects-shared";

/* ── Z object ── */

const Z_STATUSES: { value: ZRegistryStatus; label: () => string }[] = [
  { value: "active", label: () => t("Active") },
  { value: "dormant", label: () => t("Dormant") },
  { value: "deprecated", label: () => t("Deprecated") },
  { value: "under_review", label: () => t("Under review") },
];

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

function ZEditor({ entry }: { entry: ZRegistryEntry }) {
  const { can } = useV2Session();
  const allowed = can("manage_rules");
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [owner, setOwner] = useState(entry.owner ?? "");
  const [purpose, setPurpose] = useState(entry.description ?? "");
  const [standard, setStandard] = useState(entry.standard_equivalent ?? "");
  const [status, setStatus] = useState<string>(entry.status);
  const [notes, setNotes] = useState(entry.notes ?? "");
  return (
    <form
      className="nx-ob-form"
      aria-label={t("Registry entry")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!allowed) return;
        void run("save", async () => {
          await updateZEntry(entry.id, { owner, description: purpose, standard_equivalent: standard, status: status as ZRegistryStatus, notes });
          refresh();
          return { tone: "ok", title: t("{object_name} saved", { object_name: entry.object_name }) };
        });
      }}
    >
      <Field label={t("Owner")}>{(p) => <input {...p} disabled={!allowed} value={owner} onChange={(e) => setOwner(e.target.value)} />}</Field>
      <Field label={t("Purpose")}>{(p) => <input {...p} disabled={!allowed} value={purpose} onChange={(e) => setPurpose(e.target.value)} />}</Field>
      <Field label={t("Standard equivalent")} hint={t("The standard SAP field this one stands for, such as MARA-MATKL.")}>
        {(p) => <input {...p} disabled={!allowed} className="nx-ob-mono" value={standard} onChange={(e) => setStandard(e.target.value)} />}
      </Field>
      <Field label={t("Status")}>
        {(p) => (
          <select {...p} disabled={!allowed} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Z_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label()}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("Notes")}>{(p) => <textarea {...p} disabled={!allowed} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {allowed ? (
        <div className="nx-ib-acts">
          <Button type="submit" variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={pending !== null}>
            {t("Save changes")}
          </Button>
        </div>
      ) : (
        <Gate>{t("Editing the registry entry needs the manage rules permission.")}</Gate>
      )}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </form>
  );
}

/** The form that creates a custom Z rule: a name, the condition, the severity and the object it applies to. */
export function NewZRule({ objectId }: { objectId?: string }) {
  const entries = useZRegistry().data?.entries ?? [];
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [target, setTarget] = useState(objectId ?? "any");
  const [shown, setShown] = useState(false);
  if (!can("manage_rules")) return <Gate>{t("Creating a Z rule needs the manage rules permission.")}</Gate>;
  const nameErr = shown && !name.trim() ? t("Enter a rule name") : undefined;
  const condErr = shown && !condition.trim() ? t("Enter the condition") : undefined;
  return (
    <form
      className="nx-ob-form"
      aria-label={t("New Z rule")}
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
          return { tone: "ok", title: t("Z rule created"), detail: t("It runs from the next analysis.") };
        });
      }}
    >
      <Field label={t("Rule name")} error={nameErr}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={t("Condition")} error={condErr} hint={t("For example ZZFIELD is not blank")}>
        {(p) => <input {...p} className="nx-ob-mono" value={condition} onChange={(e) => setCondition(e.target.value)} />}
      </Field>
      <div className="nx-ob-grid">
        <Field label={t("Severity")}>
          {(p) => (
            <select {...p} value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("Applies to")}>
          {(p) => (
            <select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="any">{t("Any custom object")}</option>
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.object_name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="nx-ib-acts">
        <Button type="submit" variant="primary" loading={pending === "create"} loadingLabel={t("Creating…")} disabled={pending !== null}>
          {t("Create Z rule")}
        </Button>
      </div>
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </form>
  );
}

function ZBody({ entry }: { entry: ZRegistryEntry }) {
  const profile = useZProfile(entry.id);
  const anomalies = useZAnomalies();
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const mine = (anomalies.data?.anomalies ?? []).filter((a) => a.object_name === entry.object_name);
  const decide = (id: string, verdict: "dismissed" | "confirmed") =>
    void run(`${verdict}:${id}`, async () => {
      await feedbackZAnomaly(id, verdict);
      refresh();
      return { tone: "ok", title: verdict === "dismissed" ? t("Marked as expected") : t("Marked to investigate") };
    });
  const p = profile.data;
  return (
    <>
      <Facts>
        <Fact label={t("Category")}>{labelOf(entry.category)}</Fact>
        <Fact label={t("Module")}>{labelOf(entry.module)}</Fact>
        <Fact label={t("Status")}>{labelOf(entry.status)}</Fact>
        <Fact label={t("Created")}>{entry.created_date ? formatDate(entry.created_date, "date") : <Dash />}</Fact>
        <Fact label={t("Last active")}>{entry.last_active_date ? formatDate(entry.last_active_date, "date") : <Dash />}</Fact>
        <Fact label={t("Transactions")}>{int(entry.transaction_count_total)}</Fact>
        <Fact label={t("Rules applied")}>{entry.rules_applied.length ? entry.rules_applied.join(", ") : t("None")}</Fact>
      </Facts>
      <Sec title={t("Profile")}>
        {profile.isLoading ? (
          <Skeleton lines={3} />
        ) : profile.isError ? (
          <Note>{t("No profile is recorded for this object.")}</Note>
        ) : p ? (
          <dl className="nx-ib-facts" data-testid="z-profile">
            <Fact label={t("Data type")}>{p.data_type}</Fact>
            <Fact label={t("Distinct values")}>{int(p.cardinality)}</Fact>
            <Fact label={t("Empty")}>{`${(p.null_rate * 100).toFixed(1)}%`}</Fact>
            <Fact label={t("Users")}>{p.user_count}</Fact>
            <Fact label={t("Trend")}>{p.trend_direction ? labelOf(p.trend_direction) : <Dash />}</Fact>
          </dl>
        ) : null}
      </Sec>
      <Sec title={t("Anomalies")}>
        {anomalies.isError ? (
          <ErrorState onRetry={() => void anomalies.refetch()} />
        ) : mine.length === 0 ? (
          <Note>{t("No anomaly on this object in the latest analysis.")}</Note>
        ) : (
          <ul className="nx-ob-hist" aria-label={t("Anomalies of this object")}>
            {mine.map((a) => (
              <li key={a.id ?? a.anomaly_type}>
                <span>{`${labelOf(a.anomaly_type)}: ${a.description}`}</span>
                <span className="nx-ib-meta">
                  {a.status === "active" && a.id && can("ai_feedback") ? (
                    <span className="nx-ib-acts">
                      <Button size={32} disabled={pending !== null} onClick={() => decide(a.id as string, "dismissed")}>
                        {t("Expected")}
                      </Button>
                      <Button size={32} disabled={pending !== null} onClick={() => decide(a.id as string, "confirmed")}>
                        {t("Investigate")}
                      </Button>
                    </span>
                  ) : a.status === "dismissed" ? (
                    t("Expected")
                  ) : a.status === "confirmed" ? (
                    t("To investigate")
                  ) : (
                    labelOf(a.status)
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {outcome ? <OutcomeLine outcome={outcome} /> : null}
      </Sec>
      <Sec title={t("Registry entry")}>
        <ZEditor key={entry.id} entry={entry} />
      </Sec>
      <Sec title={t("Add a Z rule for this object")}>
        <NewZRule objectId={entry.id} />
      </Sec>
    </>
  );
}

/** `?open=zobject:<registry id>`: one custom Z object, its profile, anomalies, registry entry and the rule form. */
export function ZObjectInspector({ id, onClose }: BodyProps) {
  const q = useZRegistry();
  const entry = q.data?.entries.find((e) => e.id === id);
  return (
    <InspectorFrame title={entry ? <Code code={entry.object_name} /> : t("Custom object")} status={entry ? `${labelOf(entry.category)}, ${labelOf(entry.module)}` : t("Custom object")} onClose={onClose}>
      {q.isLoading ? (
        <Skeleton lines={5} />
      ) : q.isError ? (
        <ErrorState sentence={t("The registry could not be read.")} onRetry={() => void q.refetch()} />
      ) : !entry ? (
        <EmptyState heading={t("This custom object is not in the registry. It may have been removed by a later detection.")} />
      ) : (
        <ZBody entry={entry} />
      )}
    </InspectorFrame>
  );
}

/* ── S/4HANA feature ── */

/** `?open=feature:<name>`: one S/4HANA feature, whether it is blocked or degraded, by which rules, and what that costs. */
export function FeatureInspector({ id, onClose }: BodyProps) {
  const { hrefFor } = useOpenItem();
  const run = useRunParam();
  const L = useLandscape(run);
  const runId = run ?? L.data?.run_id ?? L.data?.cells.find((c) => c.run_id)?.run_id ?? null;
  const q = useConfigImpact(runId);
  const res = q.data?.find((r) => r.feature === id);
  const blocked = res?.status === "blocked";
  const rules = res ? [...new Map(res.blocking_findings.map((f) => [f.check_id, f])).values()] : [];

  return (
    <InspectorFrame title={id} status={t("S/4HANA feature")} onClose={onClose}>
      {q.isError ? (
        <ErrorState sentence={t("The feature impact could not be read for this run.")} onRetry={() => void q.refetch()} />
      ) : L.isPending || (q.isPending && Boolean(runId)) ? (
        <Skeleton lines={5} />
      ) : !res || res.status === "ok" ? (
        <EmptyState heading={runId ? t("No failing rule blocks or degrades this feature in this run.") : t("No run has scored an object yet, so the impact model has nothing to say about this feature.")} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Status")}>
              <Chip tone={blocked ? "bad" : "warn"}>{blocked ? t("Blocked") : t("Degraded")}</Chip>
            </Fact>
            <Fact label={t("System")}>{res.system || <Dash />}</Fact>
            <Fact label={t("Blocking rules")}>{int(rules.length)}</Fact>
            <Fact label={t("Records affected")}>{res.total_affected_records == null ? <Dash why={t("The run did not store a count")} /> : int(res.total_affected_records)}</Fact>
            <Fact label={t("Transactions blocked")}>{res.blocked_transactions?.length ? res.blocked_transactions.join(", ") : <Dash why={t("No transaction is named for this feature")} />}</Fact>
          </Facts>
          <Sec title={t("Blocking rules: {rulesCount}", { rulesCount: rules.length })}>
            <ul className="nx-ob-hist" aria-label={t("Rules blocking this feature")}>
              {rules.map((f) => (
                <li key={f.check_id}>
                  <V2Link href={hrefFor({ kind: "rule", id: f.check_id })}>
                    <Code code={f.check_id} />
                  </V2Link>
                  <span className="nx-ib-meta">{[f.severity, f.affected_count != null ? t("{affected_count} failing", { affected_count: int(f.affected_count) }) : null].filter(Boolean).join(", ")}</span>
                </li>
              ))}
            </ul>
          </Sec>
          <Sec title={t("Opportunity cost")}>
            <p className="nx-ob-note">{res.opportunity_cost_summary || t("The impact model has no cost summary for this feature in this run.")}</p>
          </Sec>
          {rules[0] ? (
            <Actions>
              <V2Link className="nx-btn nx-btn-secondary" href={`/work?rule=${encodeURIComponent(rules[0].check_id)}`}>
                {t("Fix")} <Code code={rules[0].check_id} /> {t("in Work")}
              </V2Link>
            </Actions>
          ) : null}
        </>
      )}
    </InspectorFrame>
  );
}

/* ── SAP field ── */

const VALUES_SHOWN = 12;
const sev = (s: string): "critical" | "high" | "medium" | "low" | "info" => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "info");

/** `?open=field:TABLE.FIELD`: one SAP field from the data catalogue (GET /catalogue/tables/{table}), for the system the page names. */
export function FieldInspector({ id, onClose }: BodyProps) {
  const ref = splitFieldId(id);
  const system = useSearchParams().get("system") ?? "";
  const q = useCatalogueTable(ref?.table ?? "", system, Boolean(ref));
  const f = q.data?.fields.find((x) => x.field === ref?.field);
  return (
    <InspectorFrame title={f?.description || id} status={t("SAP field")} onClose={onClose}>
      {!ref ? (
        <EmptyState heading={t("This address does not name a field.")} />
      ) : q.isPending ? (
        <Skeleton lines={5} />
      ) : q.isError ? (
        catalogueStatus(q.error) === 404 ? (
          <EmptyState heading={t("This table is not in the catalogue.")} />
        ) : (
          <ErrorState sentence={t("This field could not be read.")} onRetry={() => void q.refetch()} />
        )
      ) : !f ? (
        <EmptyState heading={t("The table has no field of this name.")} />
      ) : (
        <FieldBody table={q.data} f={f} />
      )}
    </InspectorFrame>
  );
}

function FieldBody({ table, f }: { table: CatalogueTable; f: CatalogueField }) {
  const { hrefFor } = useOpenItem();
  const owners = table.owners.filter((o) => o.owner_name || o.steward_name);
  const p = f.profile;
  return (
    <>
      <Facts>
        <Fact label={t("SAP field")}>
          <Code code={`${table.table}.${f.field}`} text={f.description || undefined} />
        </Fact>
        <Fact label={t("Table")}>
          <Code code={table.table} text={table.description || undefined} />
        </Fact>
        <Fact label={t("Type")}>{f.type ? <span className="nx-ob-mono">{typeText(f)}</span> : <Dash why={t("The dictionary gives no type")} />}</Fact>
        <Fact label={t("Key")}>{f.key ? t("Yes") : t("No")}</Fact>
        {f.mandatory != null ? <Fact label={t("Mandatory")}>{f.mandatory ? t("Yes") : t("No")}</Fact> : null}
        {f.data_element ? (
          <Fact label={t("Data element")}>
            <Code code={f.data_element} />
          </Fact>
        ) : null}
        {f.domain ? (
          <Fact label={t("Domain")}>
            <Code code={f.domain} />
          </Fact>
        ) : null}
        {f.check_table ? (
          <Fact label={t("Check table")}>
            <Code code={f.check_field ? `${f.check_table}.${f.check_field}` : f.check_table} />
          </Fact>
        ) : null}
        {f.source ? (
          <Fact label={t("Read from")}>
            <Code code={f.source} />
          </Fact>
        ) : null}
        <Fact label={t("Defined by")}>{sourceText(f.provenance)}</Fact>
      </Facts>
      {f.help ? <Note>{f.help}</Note> : null}
      {f.fixed_values.length ? (
        <Sec title={t("Allowed values: {n}", { n: int(f.fixed_values.length) })}>
          <ul className="nx-ob-hist" aria-label={t("Allowed values")}>
            {f.fixed_values.slice(0, VALUES_SHOWN).map((v) => (
              <li key={`${v.low}-${v.high ?? ""}`}>
                <Code code={v.high ? `${v.low}-${v.high}` : v.low || " "} text={v.text || undefined} />
              </li>
            ))}
          </ul>
          {f.fixed_values.length > VALUES_SHOWN ? <Note>{t("And {n} more.", { n: int(f.fixed_values.length - VALUES_SHOWN) })}</Note> : null}
        </Sec>
      ) : null}
      <Sec title={t("Latest profile")}>
        {p ? (
          <>
            <dl className="nx-ib-facts">
              <Fact label={t("Records")}>{int(p.stats.rows)}</Fact>
              <Fact label={t("Blank")}>{t("{n}, {pct}", { n: int(p.stats.blank), pct: pct1(p.stats.blank_pct / 100) })}</Fact>
              <Fact label={t("Distinct values")}>{int(p.stats.distinct)}</Fact>
              {p.stats.min_length != null && p.stats.max_length != null ? (
                <Fact label={t("Length")}>{p.stats.min_length === p.stats.max_length ? int(p.stats.min_length) : t("{min} to {max}", { min: int(p.stats.min_length), max: int(p.stats.max_length) })}</Fact>
              ) : null}
              <Fact label={t("Object")}>{moduleText(p.module)}</Fact>
              <Fact label={t("Run")}>{p.run_at ? formatDate(p.run_at, "date") : <Dash />}</Fact>
            </dl>
            <V2Link href={`/o/_/${moduleSlug(p.module)}/profile?run=${encodeURIComponent(p.version_id)}`}>{t("Open the profile of this run")}</V2Link>
          </>
        ) : (
          <Note>{t("No analysed run has profiled this field yet.")}</Note>
        )}
      </Sec>
      <Sec title={t("Rules that check it: {n}", { n: int(f.rules.length) })}>
        {f.rules.length === 0 ? (
          <Note>{t("No rule reads this field.")}</Note>
        ) : (
          <ul className="nx-ob-hist" aria-label={t("Rules that check it")}>
            {f.rules.map((r) => (
              <li key={`${r.check_id}/${r.module}`}>
                <span>
                  <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
                    <Code code={r.check_id} text={r.message || undefined} />
                  </V2Link>
                </span>
                <span className="nx-ib-meta">
                  <SeverityMark severity={sev(r.severity)} /> {labelText(r.severity)}, {moduleText(r.module)}
                  {r.enabled ? null : <>, {t("off")}</>}
                  {r.last_pass_rate != null ? <>, {t("{p}% pass", { p: f1(r.last_pass_rate) })}</> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Sec>
      <Sec title={t("Business terms")}>
        {f.terms.length === 0 ? (
          <Note>{t("No business term names this field.")}</Note>
        ) : (
          <ul className="nx-ob-hist" aria-label={t("Business terms")}>
            {f.terms.map((x) => (
              <li key={x.id}>
                <V2Link href={hrefFor({ kind: "term", id: x.id })}>{x.business_name}</V2Link>
                <span className="nx-ib-meta">{x.steward_name ? t("Steward {name}", { name: x.steward_name }) : t("No steward")}</span>
              </li>
            ))}
          </ul>
        )}
      </Sec>
      <Sec title={t("Used by")}>
        <dl className="nx-ib-facts">
          <Fact label={t("Objects")}>{table.objects.length ? table.objects.map(moduleText).join(", ") : <Dash why={t("No object's rules read this table")} />}</Fact>
          <Fact label={t("Systems")}>{table.systems.length ? table.systems.map((s) => s.name).join(", ") : <Dash why={t("No connected system uses this table yet")} />}</Fact>
          {owners.map((o) => (
            <Fact key={`${o.kind}:${o.ref}`} label={o.kind === "object" ? moduleText(o.ref) : (table.systems.find((s) => s.id === o.ref)?.name ?? t("System"))}>
              {[o.owner_name ? t("Owner {name}", { name: o.owner_name }) : null, o.steward_name ? t("Steward {name}", { name: o.steward_name }) : null].filter(Boolean).join(", ")}
            </Fact>
          ))}
        </dl>
      </Sec>
      <Sec title={t("Where its values go")}>
        {f.downstream.length === 0 ? (
          <Note>{t("The lineage model draws nothing below this field.")}</Note>
        ) : (
          <>
            <ul className="nx-ob-hist" aria-label={t("Where its values go")}>
              {f.downstream.map((n) => (
                <li key={n.id}>
                  <span>{n.label}</span>
                  <span className="nx-ib-meta">{t("{type}, {hops, plural, one {# step} other {# steps}} away", { type: nodeTypeText(n.type), hops: n.hops })}</span>
                </li>
              ))}
            </ul>
            {table.objects[0] ? <V2Link href={`/o/_/${moduleSlug(table.objects[0])}/lineage`}>{t("Open the lineage of {object}", { object: moduleText(table.objects[0]) })}</V2Link> : null}
          </>
        )}
      </Sec>
    </>
  );
}

/* ── Business term ── */

const TERM_STATUS: Record<string, () => string> = { active: () => t("Active"), under_review: () => t("Under review"), deprecated: () => t("Deprecated") };
const termWord = (s: string): string => TERM_STATUS[s]?.() ?? s;
const termTone = (s: string): ChipTone => (s === "active" ? "good" : s === "under_review" ? "warn" : "neutral");

/** `?open=term:<id>`: one business term, the rules that cite it, the field it governs, and what the owner can do. */
export function TermInspector({ id, onClose }: BodyProps) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const q = useTerm(id);
  const owners = useObjectOwners();
  const { outcome, pending, run } = useOutcome();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const canManage = session.can("approve");
  const term = q.data;
  const owner = term ? owners.data?.find((o) => o.ref === term.domain) : undefined;

  const startEdit = () => {
    if (!term) return;
    setName(term.business_name);
    setDefinition(term.business_definition ?? "");
    setEditing(true);
  };
  const save = () =>
    void run("save", async () => {
      await updateTerm(id, { business_name: name.trim(), business_definition: definition.trim() });
      await refreshV2(qc);
      setEditing(false);
      return { tone: "ok", title: t("Term saved"), detail: t("The change is in the term's history.") };
    });
  const draft = () =>
    void run("draft", async () => {
      const d = await draftTermWithAi(id);
      if (d.business_definition) setDefinition(d.business_definition);
      return { tone: "ok", title: t("Draft ready to review"), detail: t("Aletheia proposed this wording. Nothing is saved until you press Save.") };
    });
  const approve = () =>
    void run("approve", async () => {
      if (term && term.status !== "active") await updateTerm(id, { status: "active" });
      await reviewTerm(id);
      await refreshV2(qc);
      return { tone: "ok", title: t("Term approved"), detail: t("It is active and marked as reviewed today.") };
    });

  return (
    <InspectorFrame title={term ? term.business_name : t("Business term")} status={term ? t("Business term, {STATUS_WORD}", { STATUS_WORD: termWord(term.status) }) : t("Business term")} onClose={onClose}>
      {q.isError && !term ? (
        <ErrorState sentence={t("This term could not be read.")} onRetry={() => void q.refetch()} />
      ) : !term ? (
        <Skeleton lines={5} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Status")}>
              <Chip tone={termTone(term.status)}>{termWord(term.status)}</Chip>
            </Fact>
            <Fact label={t("SAP field")}>
              <Code code={term.technical_name} text={describeField(`${term.sap_table}.${term.sap_field}`) ?? undefined} />
            </Fact>
            <Fact label={t("Owner")}>{owner?.owner_name ?? <Dash why={t("No owner is set for this object")} />}</Fact>
            <Fact label={t("Steward")}>{owner?.steward_name ?? <Dash why={t("No steward is set for this object")} />}</Fact>
            <Fact label={t("Mandatory for S/4HANA")}>{term.mandatory_for_s4hana ? t("Yes") : t("No")}</Fact>
            <Fact label={t("Last reviewed")}>{term.last_reviewed_at ? formatDate(term.last_reviewed_at, "date") : <Dash why={t("Never reviewed")} />}</Fact>
            <Fact label={t("Review cycle")}>{t("{review_cycle_days} days", { review_cycle_days: term.review_cycle_days })}</Fact>
          </Facts>
          <Sec title={t("Definition")}>
            {editing ? (
              <div className="nx-ob-form">
                <Field label={t("Term")}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
                <Field label={t("Definition")}>{(p) => <textarea {...p} value={definition} onChange={(e) => setDefinition(e.target.value)} rows={4} />}</Field>
                <div className="nx-ib-acts">
                  <Button variant="primary" disabled={name.trim() === "" || pending !== null} loading={pending === "save"} loadingLabel={t("Saving…")} onClick={save}>
                    {t("Save")}
                  </Button>
                  {session.can("trigger_ai") ? (
                    <Button disabled={pending !== null} loading={pending === "draft"} loadingLabel={t("Drafting…")} onClick={draft}>
                      {t("Draft definition with Aletheia")}
                    </Button>
                  ) : null}
                  <Button variant="quiet" onClick={() => setEditing(false)}>
                    {t("Cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="nx-ob-note">{term.business_definition ?? t("No definition is written yet.")}</p>
                {term.why_it_matters ? <Note>{term.why_it_matters}</Note> : null}
              </>
            )}
          </Sec>
          <Sec title={t("Rules that cite it: {linked_rulesCount}", { linked_rulesCount: term.linked_rules.length })}>
            {term.linked_rules.length === 0 ? (
              <Note>{t("No rule cites this term yet.")}</Note>
            ) : (
              <ul className="nx-ob-hist" aria-label={t("Rules that cite this term")}>
                {term.linked_rules.map((r) => (
                  <li key={r.rule_id}>
                    <V2Link href={hrefFor({ kind: "rule", id: r.rule_id })}>
                      <Code code={r.rule_id} />
                    </V2Link>
                    <span className="nx-ib-meta">
                      {[r.severity, r.affected_count != null ? t("{affected_count} failing", { affected_count: int(r.affected_count) }) : null, r.pass_rate != null ? t("{pass_rate}% pass", { pass_rate: f1(r.pass_rate) }) : null].filter(Boolean).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title={t("Fields")}>
            <ul className="nx-ob-hist" aria-label={t("Fields this term governs")}>
              <li>
                <Code code={`${term.sap_table}.${term.sap_field}`} text={describeField(`${term.sap_table}.${term.sap_field}`) ?? term.business_name} />
              </li>
            </ul>
          </Sec>
          <Actions>
            {canManage ? (
              <>
                {!editing ? <Button onClick={startEdit}>{t("Edit")}</Button> : null}
                <Button variant="primary" disabled={pending !== null} loading={pending === "approve"} loadingLabel={t("Approving…")} onClick={approve}>
                  {term.status === "active" ? t("Mark as reviewed") : t("Approve")}
                </Button>
              </>
            ) : (
              <Gate>{t("Editing and approving a term needs the approve permission. A data owner can do both.")}</Gate>
            )}
          </Actions>
          {outcome ? <OutcomeLine outcome={outcome} /> : null}
          <Sec title={t("History")}>
            {term.change_history.length === 0 ? (
              <Note>{t("No change is recorded for this term.")}</Note>
            ) : (
              <ul className="nx-ob-hist">
                {term.change_history.map((h) => (
                  <li key={h.id}>
                    <span className="nx-ib-meta">{formatDate(h.changed_at, "date")}</span>
                    <span>{`${h.changed_by}: ${h.field_changed.replace(/_/g, " ")}${h.change_reason ? `, ${h.change_reason}` : ""}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}

/* ── Field mapping ── */

/** The mapping's own value, or blank while it still holds the standard default. */
const isDefault = (m: FieldMapping, key: "customer_field" | "customer_label"): boolean => !m.is_mapped && m[key] === (key === "customer_field" ? m.standard_field : m.standard_label);
const shownValue = (m: FieldMapping, key: "customer_field" | "customer_label"): string => (isDefault(m, key) ? "" : (m[key] ?? ""));

function MappingBody({ m, selfService }: { m: FieldMapping; selfService: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useV2Session();
  const edit = can("manage_field_mappings") && selfService;
  const [col, setCol] = useState(shownValue(m, "customer_field"));
  const [label, setLabel] = useState(shownValue(m, "customer_label"));
  const [notes, setNotes] = useState(m.notes ?? "");
  const { outcome, pending, run } = useOutcome();
  const { close } = useOpenItem();
  const [deleting, setDeleting] = useState(false);
  const dirty = col.trim() !== shownValue(m, "customer_field") || label.trim() !== shownValue(m, "customer_label") || notes.trim() !== (m.notes ?? "");
  const write = (body: Parameters<typeof adminApi.updateFieldMapping>[1], title: string) =>
    void run("save", async () => {
      const prev = { customer_field: shownValue(m, "customer_field"), customer_label: shownValue(m, "customer_label"), notes: m.notes ?? "", is_mapped: m.is_mapped };
      await adminApi.updateFieldMapping(m.id, body);
      await refreshAdmin(qc, "mappings");
      toast({
        text: `${title}: ${m.standard_field}`,
        tone: "good",
        onUndo: () =>
          void (async () => {
            await adminApi.updateFieldMapping(m.id, prev);
            await refreshAdmin(qc, "mappings");
          })(),
      });
      return { tone: "ok", title };
    });
  return (
    <>
      <Facts>
        <Fact label={t("Object")}>{moduleText(m.module)}</Fact>
        <Fact label={t("Standard field")}>
          <Code code={m.standard_field} text={m.standard_label ?? undefined} />
        </Fact>
        <Fact label={t("Meaning")}>{m.standard_label ?? <Dash />}</Fact>
        <Fact label={t("Type")}>
          <Code code={m.data_type} />
        </Fact>
        <Fact label={t("State")}>{m.is_mapped ? t("Mapped") : t("Not mapped: the standard column is read")}</Fact>
        <Fact label={t("Changed")}>{formatDate(m.updated_at, "datetime")}</Fact>
      </Facts>
      <Sec title={t("Your column")}>
        <div className="nx-ob-form">
          <Field label={t("Column header in your file")}>
            {(p) => <input {...p} value={col} disabled={!edit} onChange={(e) => setCol(e.target.value)} placeholder={t("Default {standard_field}", { standard_field: m.standard_field })} />}
          </Field>
          <Field label={t("Label")}>{(p) => <input {...p} value={label} disabled={!edit} onChange={(e) => setLabel(e.target.value)} placeholder={m.standard_label ?? ""} />}</Field>
          <Field label={t("Notes")}>{(p) => <input {...p} value={notes} disabled={!edit} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
      </Sec>
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!edit || !dirty || pending !== null}
          loading={pending === "save"}
          loadingLabel={t("Saving…")}
          onClick={() => write({ customer_field: col.trim(), customer_label: label.trim(), notes: notes.trim(), is_mapped: col.trim() !== "" }, t("Mapping saved"))}
        >
          {t("Save the mapping")}
        </Button>
        <Button
          disabled={!edit || (!m.is_mapped && !m.customer_field && !m.notes) || pending !== null}
          onClick={() => {
            setCol("");
            setLabel("");
            setNotes("");
            write({ customer_field: "", customer_label: "", notes: "", is_mapped: false }, t("Mapping cleared"));
          }}
        >
          {t("Clear the mapping")}
        </Button>
        <Button variant="danger" disabled={!edit || pending !== null} onClick={() => setDeleting(true)}>
          {t("Delete the mapping")}
        </Button>
      </Actions>
      <Confirm
        open={deleting}
        title={t("Delete the mapping")}
        consequence={t("{standard_field} leaves the mapping list. Rules on this object read the standard column again.", { standard_field: m.standard_field })}
        confirmLabel={t("Delete the mapping")}
        danger
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          void run("delete", async () => {
            await adminApi.deleteFieldMapping(m.id);
            setDeleting(false);
            close();
            await refreshAdmin(qc, "mappings");
            return { tone: "ok", title: t("Mapping deleted") };
          })
        }
      />
      {!edit ? <Gate>{t("Editing mappings needs the manage field mappings permission and a licence with self-service mapping.")}</Gate> : null}
    </>
  );
}

/** `?open=mapping:<id>`: one field mapping, your column for the standard field, with save, clear and delete. */
export function MappingInspector({ id, onClose }: BodyProps) {
  const q = useMappings({});
  const m = q.data?.mappings.find((x) => x.id === id);
  return (
    <InspectorFrame title={m ? <Code code={m.standard_field} /> : t("Field mapping")} status={m ? moduleText(m.module) : undefined} onClose={onClose}>
      {m ? (
        <MappingBody key={`${m.id}|${m.updated_at}`} m={m} selfService={q.data?.self_service_enabled ?? true} />
      ) : q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The mapping could not be read.")} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This field is not in the mapping list.")} />
      )}
    </InspectorFrame>
  );
}

