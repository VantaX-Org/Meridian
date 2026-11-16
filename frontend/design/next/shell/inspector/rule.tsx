"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkClassLabel, formatDate } from "@/lib/format";
import { useFixture } from "@/lib/api/v2/fixture";
import { getRuleReads } from "@/lib/api/v2/lineage";
import { getObjectRules, getReceipt } from "@/lib/api/v2/landscape";
import type { ExplainMetric, ExplainRow, RuleRun, RuleScope } from "@/lib/api/v2/object";
import type { Receipt, RuleRow } from "@/lib/api/v2/types";
import { errorSentence } from "@/lib/api/v2/client";
import { createRuleVersion, getRuleVersionDiff, transitionRuleVersion, type RuleVersionState } from "@/lib/api/v2/rulelib";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useLandscape, v2Keys } from "@/lib/v2/queries";
import { useExplain, useRuleHistory, useRuleScope } from "@/lib/v2/object-queries";
import { useRuleAccuracy } from "@/lib/v2/admin-queries";
import { int, moduleSlug, pct1, systemSlug } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { v2Locale } from "@/lib/v2/format";
import { t, lc, tx } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";
import { Mono, V2Link } from "@/design/v2/parts";
import { SeverityMark, type SeverityKey } from "@/design/v2/marks";
import { Button, Chip, Code, ErrorState, Skeleton, Sparkline, useToast } from "../../kit";
import { Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Note, Sec } from "./work-common";
import { CollabSections } from "./panels-kit";
import { RuleProve } from "./rule-prove";
import { RuleActions } from "./rule-actions";
import "./work.css";
import "./rule.css";

/**
 * The rule inspector, `?open=rule:<check_id>`: what GET /rules/{id}/scope, the receipts of the objects the rule runs on,
 * the object's rules (for value at risk) and /rules/{id}/history say about one rule. Native port of design/v2/inspector/rule.tsx.
 */

const SEV_WORD: Record<string, string> = { get critical() { return t("Critical"); }, get high() { return t("High"); }, get medium() { return t("Medium"); }, get low() { return t("Low"); }, get info() { return t("Info"); } };
const AUTHORITY_WORD: Record<string, string> = {
  get sap_hard_constraint() { return t("SAP hard constraint"); },
  get s4hana_migration() { return t("S/4HANA migration"); },
  get best_practice() { return t("Best practice"); },
  get customer_configured() { return t("Customer configured"); },
};
const DIM_WORD = (d: string | null | undefined): string => (d ? d.charAt(0).toUpperCase() + d.slice(1) : "");
const STATE_WORD: Record<string, string> = { get draft() { return t("Draft"); }, get in_review() { return t("In review"); }, get active() { return t("Active"); }, get retired() { return t("Retired"); } };

export interface RuleView {
  id: string;
  scope: RuleScope;
  receipts: Record<string, Receipt>;
  row: RuleRow | undefined;
  currency: string | null;
  severity: string | null;
  overTolerance: boolean | null;
  tolerance: { rows: number; pct: number } | null;
  checked: number;
  failingPct: number | null;
}

export type RuleState = { status: "loading" } | { status: "error"; refetch: () => void } | { status: "ready"; view: RuleView };

/** Loads one rule and what the facts need. The scope read carries the page; the rest fills in as it lands. */
export function useRule(id: string): RuleState {
  const fixture = useFixture();
  const scopeQ = useRuleScope(id);
  const scope = scopeQ.data;
  const modules = useMemo(() => Array.from(new Set((scope?.objects ?? []).map((o) => o.module))).slice(0, 6), [scope]);
  const receiptQs = useQueries({ queries: modules.map((m) => ({ queryKey: v2Keys.receipt(fixture, m, null), queryFn: () => getReceipt(m, null), staleTime: 30_000, retry: false })) });
  const primary = scope?.module ?? modules[0] ?? "";
  const rulesQ = useQuery({ queryKey: v2Keys.rules(fixture, primary, null, 0), queryFn: () => getObjectRules(primary, null), staleTime: 30_000, enabled: Boolean(primary) });
  return useMemo<RuleState>(() => {
    if (scopeQ.isError) return { status: "error", refetch: () => void scopeQ.refetch() };
    if (!scope) return { status: "loading" };
    const receipts: Record<string, Receipt> = {};
    modules.forEach((m, i) => {
      const d = receiptQs[i]?.data;
      if (d) receipts[m] = d;
    });
    const list = Object.values(receipts);
    const severity = scope.definition.severity ?? scope.objects[0]?.severity ?? null;
    const row = (rulesQ.data ?? []).find((r) => r.check_id === id);
    const overTolerance = list.length === 0 ? (severity === "critical" ? null : false) : severity === "critical" ? list.some((r) => r.breaches.some((b) => b.check_id === id)) : false;
    const tol = list[0]?.tolerance ?? null;
    const checked = scope.objects.reduce((s, o) => s + (o.checked ?? 0), 0);
    return {
      status: "ready",
      view: {
        id,
        scope,
        receipts,
        row,
        currency: list[0]?.currency ?? null,
        severity,
        overTolerance,
        tolerance: tol ? { rows: tol.rows, pct: tol.pct } : null,
        checked,
        failingPct: checked > 0 ? (scope.failing_records / checked) * 100 : null,
      },
    };
  }, [scope, scopeQ, modules, receiptQs, rulesQ.data, id]);
}

const pct2 = (n: number | null): string => (n == null ? "—" : `${(Math.round(n * 100) / 100).toFixed(2)}%`);

function explainValue(row: ExplainRow): string {
  if (row.value == null) return "—";
  const v = typeof row.value === "number" ? row.value.toLocaleString(v2Locale(), { maximumFractionDigits: 2 }) : row.value;
  return row.unit ? `${v} ${row.unit}` : String(v);
}

/** The "i" that explains a number, as a native disclosure: GET /explain/{metric} is read only once it opens. */
function Explain({ metric, label, module, checkId }: { metric: ExplainMetric; label: string; module?: string; checkId?: string }) {
  const [open, setOpen] = useState(false);
  const q = useExplain(metric, { module, checkId }, open);
  return (
    <details className="nx-rl-explain" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary aria-label={t("About {label}", { label })}>
        <span aria-hidden="true">i</span>
      </summary>
      {open ? (
        <div data-testid="explain">
          {q.isPending ? (
            <Skeleton lines={2} />
          ) : q.isError ? (
            <p role="alert" className="nx-ib-meta">{t("The explanation could not be read for this run.")}</p>
          ) : (
            <>
              <p><b>{q.data.title}</b></p>
              <p>{q.data.text}</p>
              {q.data.computation.length > 0 ? (
                <dl className="nx-ib-facts">
                  {q.data.computation.map((row, i) => (
                    <div key={`${row.label}-${i}`} className="nx-ib-fact">
                      <dt>{row.label}</dt>
                      <dd>{explainValue(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </details>
  );
}

function Sev({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <Dash />;
  return (
    <span className="nx-rl-inline">
      <SeverityMark severity={severity as SeverityKey} />
      {SEV_WORD[severity] ?? severity}
    </span>
  );
}

/** A field code with its SAP text beside it; a field with no known text shows the code alone. */
function FieldCode({ field }: { field: string }) {
  const text = describeField(field);
  return <Code code={field} text={text ?? undefined} />;
}

export function RuleFacts({ view }: { view: RuleView }) {
  const s = view.scope;
  const primary = s.module ?? s.objects[0]?.module ?? "";
  const oneObject = s.objects.length === 1 ? s.objects[0].label : null;
  const fieldWords = view.row?.field_description ?? null;
  return (
    <Facts>
      <Fact label={t("Severity")}>
        <Sev severity={view.severity} />
      </Fact>
      <Fact label={t("Dimension")}>{s.definition.dimension ? DIM_WORD(s.definition.dimension) : <Dash />}</Fact>
      <Fact label={t("Field")}>
        {fieldWords ? <>{fieldWords} </> : null}
        {s.definition.field ? <FieldCode field={s.definition.field} /> : <Dash />}
      </Fact>
      <Fact label={t("Tolerance")}>
        {view.severity === "critical" && view.tolerance ? t("{rows} rows", { rows: int(view.tolerance.rows) }) : <Dash why={t("Only critical rules carry a tolerance")} />}{" "}
        <Explain metric="tolerance" label={t("Tolerance")} module={primary} />
      </Fact>
      <Fact label={t("Over tolerance")}>
        {view.overTolerance == null ? <Dash /> : view.overTolerance ? <b>{t("Yes")}</b> : t("No")}{" "}
        <Explain metric="tolerance" label={t("Over tolerance")} module={primary} />
      </Fact>
      <Fact label={t("Failing records")}>{oneObject ? t("{failing_records} in {oneObject}", { failing_records: int(s.failing_records), oneObject }) : t("{failing_records} across {objectsCount} objects", { failing_records: int(s.failing_records), objectsCount: s.objects.length })}</Fact>
      {s.objects.length > 1 ? s.failing_by_object.map((o) => (
        <Fact key={o.module} label={o.label}>
          {int(o.failing)}
        </Fact>
      )) : null}
      <Fact label={t("Failing %")}>
        {view.failingPct == null ? <Dash /> : t("{pct2} of {checked} records checked", { pct2: pct2(view.failingPct), checked: int(view.checked) })}{" "}
        <Explain metric="failing_pct" label={t("Failing %")} module={primary} checkId={view.id} />
      </Fact>
      <Fact label={t("Value at risk")}>
        {view.row?.value_at_risk == null ? <Dash why={t("Not priced in this run")} /> : <>{moneyCompactText(view.row.value_at_risk, view.currency)}{oneObject ? "" : s.objects.length > 1 ? t(" in {label}", { label: s.objects[0].label }) : ""}</>}{" "}
        <Explain metric="value_at_risk" label={t("Value at risk")} module={primary} />
      </Fact>
    </Facts>
  );
}

export function RuleDefinition({ view }: { view: RuleView }) {
  const d = view.scope.definition;
  const params = Object.entries(d.params ?? {});
  const proof = useRuleAccuracy().data?.rules.find((r) => r.rule_id === view.id);
  return (
    <Sec title={t("Definition")}>
      <dl className="nx-ib-facts">
        {proof ? (
          <Fact label={t("Test-proven")}>
            <span title={t("Synthetic records with {injected} injected defects: {tp} caught, {fp} false alarms, {fn} missed.", { injected: int(proof.injected), tp: int(proof.true_positives), fp: int(proof.false_positives), fn: int(proof.false_negatives) })}>
              <Chip tone={proof.precision === 1 && proof.recall === 1 ? "good" : "warn"}>
                {t("Precision {precision}, recall {recall}", { precision: pct1(proof.precision), recall: pct1(proof.recall) })}
              </Chip>
            </span>
          </Fact>
        ) : null}
        <Fact label={t("Check class")}>{d.check_class ? <span title={d.check_class}>{tx(checkClassLabel(d.check_class))}</span> : <Dash />}</Fact>
        <Fact label={t("Field")}>{d.field ? <FieldCode field={d.field} /> : <Dash />}</Fact>
        <Fact label={t("Expression")}>{d.expression ? <Mono>{d.expression}</Mono> : <Dash why={t("The rule has no stored expression")} />}</Fact>
        {params.map(([k, v]) => (
          <Fact key={k} label={labelText(k)}>
            <Mono>{typeof v === "string" ? v : JSON.stringify(v)}</Mono>
          </Fact>
        ))}
        <Fact label={t("Source")}>{d.source === "tenant" ? t("Written by your team") : d.source === "shipped" ? t("Shipped with Meridian") : <Dash />}</Fact>
      </dl>
      {d.message && d.message !== view.scope.name ? <p>{d.message}</p> : null}
    </Sec>
  );
}

export function RuleAuthority({ view }: { view: RuleView }) {
  const a = view.scope.authority;
  return (
    <Sec title={t("Authority")}>
      {a.rule_authority ? <p><b>{AUTHORITY_WORD[a.rule_authority] ?? a.rule_authority}</b></p> : <p className="nx-ib-meta">{t("The rule does not state an authority.")}</p>}
      {a.why_it_matters ? <p>{a.why_it_matters}</p> : null}
      {a.sap_impact && a.sap_impact !== a.why_it_matters ? <p>{t("In SAP: {sap_impact}", { sap_impact: a.sap_impact })}</p> : null}
    </Sec>
  );
}

export function RuleScopeSection({ view }: { view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const s = view.scope;
  return (
    <Sec title={t("Scope: {objectsCount} {objectsCount, plural, one {object} other {objects}}, {systemsCount} {systemsCount, plural, one {system} other {systems}}", { objectsCount: s.objects.length, systemsCount: s.systems.length })}>
      {s.objects.length === 0 ? (
        <p className="nx-ib-meta">{t("No run has measured this rule yet.")}</p>
      ) : (
        <ul className="nx-ib-list">
          {s.objects.map((o) => (
            <li key={`${o.system_id}:${o.module}`} className="nx-ib-row">
              <V2Link href={`/o/${systemSlug(o.system_name ?? o.system_id)}/${moduleSlug(o.module)}`}>{o.label}</V2Link>
              <span className="nx-ib-meta">{t("{system_name}{value}, {failing} failing", { system_name: o.system_name ?? "", value: o.run_at ? t(", run {run_at}", { run_at: formatDate(o.run_at, "date") }) : "", failing: int(o.failing) })}</span>
            </li>
          ))}
        </ul>
      )}
      {s.systems.length > 0 ? (
        <ul className="nx-ib-list">
          {s.systems.map((sys) => (
            <li key={sys.id} className="nx-ib-row">
              <V2Link href={hrefFor({ kind: "system", id: sys.id })}>{sys.name ?? t("System")}</V2Link>
              <span className="nx-ib-meta">{t("{failing} failing in {objects} {objects, plural, one {object} other {objects}}", { failing: int(sys.failing), objects: sys.objects })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Sec>
  );
}

export function RuleBlocks({ view }: { view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const f = view.scope.features;
  return (
    <Sec title={t("Blocks: {fCount} S/4 {fCount, plural, one {feature} other {features}}", { fCount: f.length })}>
      {f.length === 0 ? (
        <p className="nx-ib-meta">{t("No S/4 feature is mapped to this rule yet.")}</p>
      ) : (
        <ul className="nx-ib-list">
          {f.map((x) => (
            <li key={`${x.feature}:${x.status}`} className="nx-ib-row">
              <V2Link href={hrefFor({ kind: "feature", id: x.feature })}>{x.feature}</V2Link>
              <span className="nx-ib-meta">{x.status === "blocked" ? t("Blocked") : t("Degraded")}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

/** field, then rule, then the features it blocks, as an ordered list. The features are links. */
function Lineage({ view }: { view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const field = view.scope.definition.field ?? "";
  const feats = view.scope.features.slice(0, 4);
  const extra = view.scope.features.length - feats.length;
  return (
    <ol className="nx-rl-lineage" aria-label={t("Lineage: {field} to {id} to {value}", { field: field || "field", id: view.id, value: feats.length === 0 ? t("no features") : t("blocked features") })} data-testid="lineage">
      <li>{field ? <FieldCode field={field} /> : <span className="nx-ib-meta">{t("no field")}</span>}</li>
      <li><Mono>{view.id}</Mono></li>
      {feats.length === 0 ? (
        <li className="nx-ib-meta">{t("no features")}</li>
      ) : (
        <li>
          <ul className="nx-ib-list">
            {feats.map((f) => (
              <li key={`${f.feature}:${f.status}`}>
                <V2Link href={hrefFor({ kind: "feature", id: f.feature })}>{f.feature}</V2Link>
              </li>
            ))}
            {extra > 0 ? <li className="nx-ib-meta">{t("and {extra} more", { extra })}</li> : null}
          </ul>
        </li>
      )}
    </ol>
  );
}

/** GET /lineage/rule/{id}: the columns the rule reads, the tables behind them, the joins and the glossary terms it backs. */
function RuleReads({ id }: { id: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "rule-reads", fx, id], queryFn: () => getRuleReads(id), retry: false });
  if (!q.data) return null;
  const r = q.data;
  return (
    <div data-testid="rule-reads">
      <p className="nx-ib-meta">{t("Reads")}: {r.fields.map((f) => <Mono key={f}>{f} </Mono>)}</p>
      {r.targets.length > 0 ? <p className="nx-ib-meta">{t("Looks up")}: {r.targets.map((f) => <Mono key={f}>{f} </Mono>)}</p> : null}
      {r.joins.length > 0 ? (
        <ul className="nx-ib-list">
          {r.joins.map((j) => (
            <li key={`${j.parent}>${j.child}`}>
              <Mono>{j.parent}</Mono> {t("to")} <Mono>{j.child}</Mono> <span className="nx-ib-meta">{j.cardinality}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {r.glossary_terms.length > 0 ? <p className="nx-ib-meta">{t("Glossary terms")}: {r.glossary_terms.map((g) => g.business_name).join(", ")}</p> : null}
    </div>
  );
}

export function RuleLineage({ view }: { view: RuleView }) {
  return (
    <Sec title={t("Lineage")}>
      <Lineage view={view} />
      <RuleReads id={view.id} />
    </Sec>
  );
}

export function RuleVersions({ view }: { view: RuleView }) {
  const s = view.scope;
  const session = useV2Session();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<number | "new" | null>(null);
  const canAuthor = session.can("manage_rules");
  const canReview = session.can("approve") || session.can("review_ai_rules");
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: ["v2", "rule-scope"] });
    toast({ text: msg });
    setOpen(null);
  };
  const move = useMutation({
    mutationFn: ({ v, to }: { v: number; to: RuleVersionState }) => transitionRuleVersion(view.id, v, to),
    onSuccess: (_d, { to }) => done(to === "active" ? t("Version approved. It applies from the next analysis run.") : to === "in_review" ? t("Version sent for review") : to === "retired" ? t("Version retired") : t("Version sent back to draft")),
    onError: (err) => toast({ text: errorSentence(err, t("The version could not be moved.")), tone: "bad" }),
  });
  const act = (v: number, to: RuleVersionState) => (session.fixture ? toast({ text: t("Fixture mode: nothing is saved") }) : move.mutate({ v, to }));
  return (
    <Sec title={t("Versions")}>
      {s.versions.length === 0 ? <p className="nx-ib-meta">{s.shipped ? t("No tenant version yet; the shipped definition runs.") : t("No version is stored for this rule.")}</p> : (
        <ul className="nx-ib-list">
          {s.versions.map((v) => (
            <li key={v.version}>
              <span className="nx-ib-meta">{v.created_at ? formatDate(v.created_at, "date") : ""}</span>{" "}
              <span>{t("Version {version}, {STATE_WORD}{value}{value2}", { version: v.version, STATE_WORD: lc(STATE_WORD[v.state] ?? v.state), value: v.note ? `: ${v.note}` : "", value2: v.author ? t(". By {author}.", { author: v.author }) : "" })}</span>
              {v.approved_by ? <span className="nx-ib-meta"> {t("Approved by {who}.", { who: v.approved_by })}</span> : null}
              <div className="nx-ib-acts">
                <Button size={32} variant="quiet" aria-expanded={open === v.version} onClick={() => setOpen(open === v.version ? null : v.version)}>{t("Show changes")}</Button>
                {v.state === "draft" && canAuthor ? <Button size={32} variant="secondary" disabled={move.isPending} onClick={() => act(v.version, "in_review")}>{t("Send for review")}</Button> : null}
                {v.state === "in_review" && canReview ? (
                  <>
                    <Button size={32} variant="primary" disabled={move.isPending} onClick={() => act(v.version, "active")}>{t("Approve")}</Button>
                    <Button size={32} variant="secondary" disabled={move.isPending} onClick={() => act(v.version, "draft")}>{t("Send back")}</Button>
                  </>
                ) : null}
                {v.state === "active" && canAuthor ? <Button size={32} variant="secondary" disabled={move.isPending} onClick={() => act(v.version, "retired")}>{t("Retire")}</Button> : null}
              </div>
              {open === v.version ? <VersionDiff id={view.id} version={v.version} /> : null}
            </li>
          ))}
        </ul>
      )}
      {s.shipped ? <Note>{t("Shipped definition {source}, content hash {hash}, Meridian {app_version}.", { source: s.shipped.source, hash: s.shipped.hash, app_version: s.shipped.app_version })}</Note> : null}
      {canAuthor && s.shipped ? (
        open === "new" ? <NewVersionForm view={view} onDone={() => done(t("Draft saved. Send it for review to apply it."))} /> : (
          <div className="nx-ib-acts">
            <Button size={32} variant="secondary" onClick={() => setOpen("new")}>{t("New version")}</Button>
            <Note>{t("A new version is a draft. A reviewer other than the author approves it; it applies from the next analysis run.")}</Note>
          </div>
        )
      ) : null}
    </Sec>
  );
}

function VersionDiff({ id, version }: { id: string; version: number }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["v2", "rule-version-diff", fixture, id, version], queryFn: () => getRuleVersionDiff(id, version), enabled: !fixture, retry: false });
  if (fixture) return <Note>{t("Fixture mode: the change is not stored.")}</Note>;
  if (q.isError) return <ErrorState sentence={t("The change could not be read.")} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={2} />;
  return (
    <>
      <Note>{t("{from} to {to}", { from: q.data.from, to: q.data.to })}</Note>
      <pre className="nx-wk-pre" tabIndex={0} aria-label={t("Changes in version {version}", { version })}>{q.data.diff || t("No change to the effective rule.")}</pre>
    </>
  );
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** Draft a tenant override of a shipped rule: severity, message and the rule's own parameters. */
function NewVersionForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const d = view.scope.definition;
  const session = useV2Session();
  const toast = useToast();
  const [severity, setSeverity] = useState(d.severity ?? "");
  const [message, setMessage] = useState(d.message ?? "");
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])));
  const [note, setNote] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => createRuleVersion(view.id, body, note.trim()),
    onSuccess: onDone,
    onError: (err) => toast({ text: errorSentence(err, t("The draft could not be saved.")), tone: "bad" }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (severity && severity !== d.severity) body.severity = severity;
    if (message.trim() && message.trim() !== (d.message ?? "")) body.message = message.trim();
    for (const [k, text] of Object.entries(params)) {
      const was = d.params[k];
      let v: unknown = text;
      if (typeof was !== "string") {
        try {
          v = JSON.parse(text);
        } catch {
          return setBad(t("{key} is not a valid value.", { key: k }));
        }
      }
      if (JSON.stringify(v) !== JSON.stringify(was)) body[k] = v;
    }
    if (!Object.keys(body).length) return setBad(t("Nothing differs from the running definition."));
    setBad(null);
    if (session.fixture) return toast({ text: t("Fixture mode: nothing is saved") });
    m.mutate(body);
  };
  return (
    <form className="nx-wk-form" onSubmit={submit} aria-label={t("New version of {id}", { id: view.id })}>
      <label>
        {t("Severity")}
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {SEVERITIES.map((x) => <option key={x} value={x}>{labelText(x)}</option>)}
        </select>
      </label>
      <label>
        {t("Message")}
        <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
      </label>
      {Object.keys(params).map((k) => (
        <label key={k}>
          <Mono>{k}</Mono>
          <input type="text" value={params[k]} onChange={(e) => setParams({ ...params, [k]: e.target.value })} />
        </label>
      ))}
      <label>
        {t("Why the change")}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </label>
      {bad ? <p role="alert" className="nx-wk-alert">{bad}</p> : null}
      <div className="nx-ib-acts">
        <Button type="submit" size={32} variant="primary" loading={m.isPending}>{t("Save draft")}</Button>
      </div>
    </form>
  );
}

export function RuleContract({ view }: { view: RuleView }) {
  const c = view.scope.contracts;
  return (
    <Sec title={t("Contract")}>
      {c.length === 0 ? <p className="nx-ib-meta">{t("No data contract names this rule or sets a threshold on its dimension.")}</p> : (
        <ul className="nx-ib-list">
          {c.map((x, i) => (
            <li key={`${x.id}:${i}`} className="nx-ib-row">
              <span>{x.name}</span>
              <span className="nx-ib-meta">{x.via === "names_rule" ? t("{STATE_WORD}, names this rule", { STATE_WORD: STATE_WORD[x.status] ?? x.status }) : t("{STATE_WORD}, minimum {threshold}{value}", { STATE_WORD: STATE_WORD[x.status] ?? x.status, threshold: x.threshold, value: view.scope.definition.dimension ? t(" for {dimension}", { dimension: view.scope.definition.dimension }) : "" })}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

function RunLine({ run, view }: { run: RuleRun; view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const label = view.scope.objects.find((o) => o.module === run.module)?.label ?? run.module.replace(/_/g, " ");
  return (
    <>
      <V2Link href={hrefFor({ kind: "run", id: run.version_id })}>{t("Run {run_at}", { run_at: formatDate(run.run_at, "date") })}</V2Link>
      {t(": {affected_count} failing in {label}{value}", { affected_count: int(run.affected_count), label, value: run.suppressed ? t(", suppressed") : "" })}
    </>
  );
}

function historyItems(runs: RuleRun[], view: RuleView): { at: string; text: ReactNode; key: string }[] {
  const items: { at: string; text: ReactNode; key: string }[] = [];
  for (const r of runs) items.push({ at: r.run_at, key: `r:${r.version_id}:${r.module}`, text: <RunLine run={r} view={view} /> });
  for (const v of view.scope.versions) {
    if (!v.created_at) continue;
    items.push({ at: v.created_at, key: `v:${v.version}`, text: t("Version {version}{value}", { version: v.version, value: v.note ? `: ${v.note}` : "" }) });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1));
}

const LIMIT = 8;

export function RuleHistory({ view }: { view: RuleView }) {
  const q = useRuleHistory(view.id);
  const items = useMemo(() => historyItems(q.data ?? [], view), [q.data, view]);
  const trend = useMemo(() => {
    const byRun = new Map<string, { at: string; n: number }>();
    for (const r of q.data ?? []) byRun.set(r.version_id, { at: r.run_at, n: (byRun.get(r.version_id)?.n ?? 0) + r.affected_count });
    return [...byRun.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-LIMIT);
  }, [q.data]);
  return (
    <Sec title={t("History")}>
      {trend.length > 1 ? (
        <div className="nx-rl-inline" data-testid="rule-trend">
          <Sparkline points={trend.map((x) => x.n)} label={t("Failing records over the last {count} runs: {first} to {last}", { count: trend.length, first: int(trend[0].n), last: int(trend[trend.length - 1].n) })} />
          <span className="nx-ib-meta">{t("Failing records, last {count} runs", { count: trend.length })}</span>
        </div>
      ) : null}
      {q.isPending ? (
        <Skeleton lines={2} />
      ) : q.isError ? (
        <ErrorState sentence={t("The run history could not be read for this rule.")} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="nx-ib-meta">{t("No run has measured this rule yet.")}</p>
      ) : (
        <ul className="nx-ib-list">
          {items.slice(0, LIMIT).map((h) => (
            <li key={h.key}>
              <span className="nx-ib-meta">{formatDate(h.at, "date")}</span> <span>{h.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

/** The inspector body for `?open=rule:<check_id>`. */
export function RuleInspectorNative({ id, onClose }: BodyProps) {
  const s = useRule(id);
  const landscape = useLandscape(null);
  let body: ReactNode;
  if (s.status === "loading") {
    body = (
      <div data-testid="rule-loading">
        <Skeleton lines={7} />
      </div>
    );
  } else if (s.status === "error") {
    const capped = (landscape.data?.cells ?? []).filter((c) => c.breaches.includes(id)).length;
    body = (
      <>
        <ErrorState sentence={t("This rule could not be read. It may not run on any object yet.")} onRetry={s.refetch} />
        {capped > 0 ? <Note>{t("It fails on too many records in {capped} {capped, plural, one {object} other {objects}}, so it holds their score down.", { capped })}</Note> : null}
        <div className="nx-ib-acts">
          <V2Link href={`/r/${encodeURIComponent(id)}`} className="nx-btn nx-btn-primary">
            {t("Open the rule")}
          </V2Link>
        </div>
      </>
    );
  } else {
    const v = s.view;
    body = (
      <>
        <p className="nx-rl-name" data-testid="rule-name">{v.scope.name ?? v.scope.definition.message ?? t("Rule")}</p>
        <RuleFacts view={v} />
        <RuleProve view={v} />
        <RuleDefinition view={v} />
        <RuleAuthority view={v} />
        <RuleScopeSection view={v} />
        <RuleBlocks view={v} />
        <RuleLineage view={v} />
        <RuleVersions view={v} />
        <RuleContract view={v} />
        <RuleActions view={v} />
        <RuleHistory view={v} />
        <CollabSections kind="rule" id={v.id} label={t("rule {id}", { id: v.id })} />
      </>
    );
  }
  return (
    <InspectorFrame title={<Mono>{id}</Mono>} status={t("Rule")} onClose={onClose}>
      {body}
    </InspectorFrame>
  );
}

export const RULE_BODIES: Record<string, React.ComponentType<BodyProps>> = { rule: RuleInspectorNative };
