"use client";

import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkClassLabel, formatDate } from "@/lib/format";
import { useFixture } from "@/lib/api/v2/fixture";
import { getObjectRules, getReceipt } from "@/lib/api/v2/landscape";
import { handOffRule, suppressRule, type RuleRun, type RuleScope } from "@/lib/api/v2/object";
import type { Landscape, Receipt, RuleRow } from "@/lib/api/v2/types";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { v2Keys } from "@/lib/v2/queries";
import { useRuleHistory, useRuleScope, useStewards } from "@/lib/v2/object-queries";
import { int, moduleSlug, systemSlug } from "@/lib/v2/score";
import { Explain } from "../Explain";
import "../object.css";
import { SeverityMark, type SeverityKey } from "../marks";
import { Dash, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { CollabSections } from "./collab";
import { t as tr, lc, tx } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";

/**
 * Everything the rule inspector and the rule canvas say about one rule, read from GET /rules/{id}/scope, the receipts
 * of the objects it runs on, the object's rules (for value at risk) and /rules/{id}/history. The sections are small
 * components so the inspector (a column) and the canvas (tabs) show the same content.
 */

const SEV_WORD: Record<string, string> = { get critical() { return tr("Critical"); }, get high() { return tr("High"); }, get medium() { return tr("Medium"); }, get low() { return tr("Low"); }, get info() { return tr("Info"); } };
const AUTHORITY_WORD: Record<string, string> = {
  get sap_hard_constraint() { return tr("SAP hard constraint"); },
  get s4hana_migration() { return tr("S/4HANA migration"); },
  get best_practice() { return tr("Best practice"); },
  get customer_configured() { return tr("Customer configured"); },
};
const DIM_WORD = (d: string | null | undefined): string => (d ? d.charAt(0).toUpperCase() + d.slice(1) : "");

export interface RuleView {
  id: string;
  scope: RuleScope;
  /** Receipts of the objects the rule runs on, by module. */
  receipts: Record<string, Receipt>;
  /** The rule as the object's Rules tab ranks it: value at risk, business field name. */
  row: RuleRow | undefined;
  currency: string | null;
  severity: string | null;
  /** Null until a receipt says. */
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
  // The same key as the object's Rules tab, so the two share one read; it waits until the scope names the object.
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

const Level = createContext<"h2" | "h3">("h3");

/** Chooses h3 (inspector) or h2 (canvas) for every section heading below it. */
export function SectionLevel({ level, children }: { level: "h2" | "h3"; children: ReactNode }) {
  return <Level.Provider value={level}>{children}</Level.Provider>;
}

function Sec({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const level = useContext(Level);
  const heading = level === "h2" ? <h2 className="m2-h2 m2-sec">{title}</h2> : <h3>{title}</h3>;
  return (
    <section className="m2-rsec" aria-label={title}>
      {aside ? (
        <div className="m2-rsec-h">
          {heading}
          {aside}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="m2-facts">{children}</dl>;
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="m2-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Sev({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <Dash />;
  return (
    <span className="m2-sev">
      <SeverityMark severity={severity as SeverityKey} />
      {SEV_WORD[severity] ?? severity}
    </span>
  );
}

const pct2 = (n: number | null): string => (n == null ? "—" : `${(Math.round(n * 100) / 100).toFixed(2)}%`);

/** The one-line statistics of a rule, for the canvas header: no ruler, a sentence of facts. */
export function ruleStatLine(v: RuleView): string[] {
  const s = v.scope;
  const out: string[] = [];
  if (v.severity) out.push(SEV_WORD[v.severity] ?? v.severity);
  if (s.definition.dimension) out.push(DIM_WORD(s.definition.dimension));
  out.push(tr("{failing_records} failing across {objectsCount} {objectsCount, plural, one {object} other {objects}}", { failing_records: int(s.failing_records), objectsCount: s.objects.length }));
  if (v.failingPct != null) out.push(tr("{pct2} of records checked", { pct2: pct2(v.failingPct) }));
  if (v.row?.value_at_risk != null) out.push(tr("{formatMoneyCompact} at risk", { formatMoneyCompact: moneyCompactText(v.row.value_at_risk, v.currency) }));
  if (v.overTolerance != null) out.push(v.overTolerance ? tr("over tolerance") : tr("within tolerance"));
  if (s.features.length > 0) out.push(tr("blocks {featuresCount} S/4 {featuresCount, plural, one {feature} other {features}}", { featuresCount: s.features.length }));
  return out;
}

export function RuleFacts({ view }: { view: RuleView }) {
  const s = view.scope;
  const primary = s.module ?? s.objects[0]?.module ?? "";
  const oneObject = s.objects.length === 1 ? s.objects[0].label : null;
  const fieldWords = view.row?.field_description ?? null;
  return (
    <Sec title={tr("Facts")}>
      <Facts>
        <Fact label={tr("Severity")}>
          <Sev severity={view.severity} />
        </Fact>
        <Fact label={tr("Dimension")}>{s.definition.dimension ? DIM_WORD(s.definition.dimension) : <Dash />}</Fact>
        <Fact label={tr("Field")}>
          {fieldWords ? <>{fieldWords} </> : null}
          {s.definition.field ? <Mono>{s.definition.field}</Mono> : <Dash />}
        </Fact>
        <Fact label={<>{tr("Tolerance")}{" "}<Explain metric="tolerance" label={tr("Tolerance")} module={primary} /></>}>
          {view.severity === "critical" && view.tolerance ? tr("{rows} rows", { rows: int(view.tolerance.rows) }) : <Dash why={tr("Only critical rules carry a tolerance")} />}
        </Fact>
        <Fact label={<>{tr("Over tolerance")}{" "}<Explain metric="tolerance" label={tr("Over tolerance")} module={primary} /></>}>
          {view.overTolerance == null ? <Dash /> : view.overTolerance ? <b>{tr("Yes")}</b> : tr("No")}
        </Fact>
        <Fact label={tr("Failing records")}>{oneObject ? tr("{failing_records} in {oneObject}", { failing_records: int(s.failing_records), oneObject }) : tr("{failing_records} across {objectsCount} objects", { failing_records: int(s.failing_records), objectsCount: s.objects.length })}</Fact>
        {s.objects.length > 1 ? s.failing_by_object.map((o) => (
          <Fact key={o.module} label={o.label}>
            {int(o.failing)}
          </Fact>
        )) : null}
        <Fact label={<>{tr("Failing %")}{" "}<Explain metric="failing_pct" label={tr("Failing %")} module={primary} checkId={view.id} /></>}>
          {view.failingPct == null ? <Dash /> : tr("{pct2} of {checked} records checked", { pct2: pct2(view.failingPct), checked: int(view.checked) })}
        </Fact>
        <Fact label={<>{tr("Value at risk")}{" "}<Explain metric="value_at_risk" label={tr("Value at risk")} module={primary} /></>}>
          {view.row?.value_at_risk == null ? <Dash why={tr("Not priced in this run")} /> : <>{moneyCompactText(view.row.value_at_risk, view.currency)}{oneObject ? "" : s.objects.length > 1 ? tr(" in {label}", { label: s.objects[0].label }) : ""}</>}
        </Fact>
      </Facts>
    </Sec>
  );
}

export function RuleDefinition({ view }: { view: RuleView }) {
  const d = view.scope.definition;
  const params = Object.entries(d.params ?? {});
  return (
    <Sec title={tr("Definition")}>
      <Facts>
        <Fact label={tr("Check class")}>{d.check_class ? <span title={d.check_class}>{tx(checkClassLabel(d.check_class))}</span> : <Dash />}</Fact>
        <Fact label={tr("Field")}>{d.field ? <Mono>{d.field}</Mono> : <Dash />}</Fact>
        <Fact label={tr("Expression")}>{d.expression ? <Mono>{d.expression}</Mono> : <Dash why={tr("The rule has no stored expression")} />}</Fact>
        {params.map(([k, v]) => (
          <Fact key={k} label={<span title={k}>{labelText(k)}</span>}>
            <Mono>{typeof v === "string" ? v : JSON.stringify(v)}</Mono>
          </Fact>
        ))}
        <Fact label={tr("Source")}>{d.source === "tenant" ? tr("Written by your team") : d.source === "shipped" ? tr("Shipped with Meridian") : <Dash />}</Fact>
      </Facts>
      {d.message && d.message !== view.scope.name ? <p className="m2-rp">{d.message}</p> : null}
    </Sec>
  );
}

export function RuleAuthority({ view }: { view: RuleView }) {
  const a = view.scope.authority;
  return (
    <Sec title={tr("Authority")}>
      {a.rule_authority ? <p className="m2-rp"><b>{AUTHORITY_WORD[a.rule_authority] ?? a.rule_authority}</b></p> : <p className="m2-rp m2-meta">{tr("The rule does not state an authority.")}</p>}
      {a.why_it_matters ? <p className="m2-rp">{a.why_it_matters}</p> : null}
      {a.sap_impact && a.sap_impact !== a.why_it_matters ? <p className="m2-rp">{tr("In SAP: {sap_impact}", { sap_impact: a.sap_impact })}</p> : null}
    </Sec>
  );
}

export function RuleScopeSection({ view }: { view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const s = view.scope;
  return (
    <Sec title={tr("Scope: {objectsCount} {objectsCount, plural, one {object} other {objects}}, {systemsCount} {systemsCount, plural, one {system} other {systems}}", { objectsCount: s.objects.length, systemsCount: s.systems.length })}>
      {s.objects.length === 0 ? (
        <p className="m2-rp m2-meta">{tr("No run has measured this rule yet.")}</p>
      ) : (
        <ul className="m2-lk">
          {s.objects.map((o) => (
            <li key={`${o.system_id}:${o.module}`}>
              <V2Link href={`/o/${systemSlug(o.system_name ?? o.system_id)}/${moduleSlug(o.module)}`}>{o.label}</V2Link>
              <span className="m2-meta">{tr("{system_name}{value}, {failing} failing", { system_name: o.system_name ?? "", value: o.run_at ? tr(", run {run_at}", { run_at: formatDate(o.run_at, "date") }) : "", failing: int(o.failing) })}</span>
            </li>
          ))}
        </ul>
      )}
      {s.systems.length > 0 ? (
        <ul className="m2-lk">
          {s.systems.map((sys) => (
            <li key={sys.id}>
              <V2Link href={hrefFor({ kind: "system", id: sys.id })}>{sys.name ?? tr("System")}</V2Link>
              <span className="m2-meta">{tr("{failing} failing in {objects} {objects, plural, one {object} other {objects}}", { failing: int(sys.failing), objects: sys.objects })}</span>
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
    <Sec title={tr("Blocks: {fCount} S/4 {fCount, plural, one {feature} other {features}}", { fCount: f.length })}>
      {f.length === 0 ? (
        <p className="m2-rp m2-meta">{tr("No S/4 feature is mapped to this rule yet.")}</p>
      ) : (
        <ul className="m2-lk">
          {f.map((x) => (
            <li key={`${x.feature}:${x.status}`}>
              <V2Link href={hrefFor({ kind: "feature", id: x.feature })}>{x.feature}</V2Link>
              <span className="m2-meta">{x.status === "blocked" ? tr("Blocked") : tr("Degraded")}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

/** field → rule → features, drawn with 1 pixel lines. The features are links. */
export function Lineage({ view }: { view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const field = view.scope.definition.field ?? "";
  const feats = view.scope.features.slice(0, 4);
  const extra = view.scope.features.length - feats.length;
  const rows = Math.max(1, feats.length);
  const H = Math.max(80, rows * 34 + 10);
  const cy = H / 2;
  const trim = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  return (
    <svg className="m2-lineage" viewBox={`0 0 360 ${H}`} width="360" height={H} role="group" aria-label={tr("Lineage: {field} to {id} to {value}", { field: field || "field", id: view.id, value: feats.length === 0 ? tr("no features") : tr("blocked features") })} data-testid="lineage">
      <line x1="108" y1={cy} x2="136" y2={cy} />
      <rect x="1" y={cy - 15} width="107" height="30" />
      <text x="8" y={cy + 4} className="m2-lg-mono">{trim(field || tr("no field"), 14)}</text>
      <rect x="136" y={cy - 15} width="72" height="30" />
      <text x="144" y={cy + 4} className="m2-lg-mono">{view.id}</text>
      {feats.map((f, i) => {
        const y = (H - rows * 34) / 2 + 5 + i * 34;
        const my = y + 12;
        return (
          <g key={`${f.feature}:${f.status}`}>
            <line x1="208" y1={cy} x2="226" y2={my} />
            <V2Link href={hrefFor({ kind: "feature", id: f.feature })} aria-label={`${f.feature}, ${f.status}`} className="m2-lg">
              <rect x="226" y={y} width="133" height="24" />
              <text x="232" y={my + 4}>{trim(f.feature, 20)}</text>
            </V2Link>
          </g>
        );
      })}
      {extra > 0 ? <text x="232" y={H - 2} className="m2-lg-more">{tr("and {extra} more", { extra })}</text> : null}
    </svg>
  );
}

export function RuleLineage({ view }: { view: RuleView }) {
  return (
    <Sec title={tr("Lineage")}>
      <Lineage view={view} />
    </Sec>
  );
}

const STATE_WORD: Record<string, string> = { get draft() { return tr("Draft"); }, get in_review() { return tr("In review"); }, get active() { return tr("Active"); }, get retired() { return tr("Retired"); } };

export function RuleVersions({ view }: { view: RuleView }) {
  const s = view.scope;
  return (
    <Sec title={tr("Versions")}>
      {s.versions.length === 0 ? <p className="m2-rp m2-meta">{s.shipped ? tr("No tenant version yet; the shipped definition runs.") : tr("No version is stored for this rule.")}</p> : (
        <ul className="m2-hist">
          {s.versions.map((v) => (
            <li key={v.version}>
              <span className="m2-d">{v.created_at ? formatDate(v.created_at, "date") : ""}</span>
              <span>{tr("Version {version}, {STATE_WORD}{value}{value2}", { version: v.version, STATE_WORD: lc(STATE_WORD[v.state] ?? v.state), value: v.note ? `: ${v.note}` : "", value2: v.author ? tr(". By {author}.", { author: v.author }) : "" })}</span>
            </li>
          ))}
        </ul>
      )}
      {s.shipped ? <p className="m2-prov">{tr("Shipped definition {source}, content hash {hash}, Meridian {app_version}.", { source: s.shipped.source, hash: s.shipped.hash, app_version: s.shipped.app_version })}</p> : null}
    </Sec>
  );
}

export function RuleContract({ view }: { view: RuleView }) {
  const c = view.scope.contracts;
  return (
    <Sec title={tr("Contract")}>
      {c.length === 0 ? <p className="m2-rp m2-meta">{tr("No data contract names this rule or sets a threshold on its dimension.")}</p> : (
        <ul className="m2-lk">
          {c.map((x, i) => (
            <li key={`${x.id}:${i}`}>
              <span>{x.name}</span>
              <span className="m2-meta">{x.via === "names_rule" ? tr("{STATE_WORD}, names this rule", { STATE_WORD: STATE_WORD[x.status] ?? x.status }) : tr("{STATE_WORD}, minimum {threshold}{value}", { STATE_WORD: STATE_WORD[x.status] ?? x.status, threshold: x.threshold, value: view.scope.definition.dimension ? tr(" for {dimension}", { dimension: view.scope.definition.dimension }) : "" })}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

function historyItems(runs: RuleRun[], view: RuleView): { at: string; text: ReactNode; key: string }[] {
  const items: { at: string; text: ReactNode; key: string }[] = [];
  for (const r of runs) {
    items.push({ at: r.run_at, key: `r:${r.version_id}:${r.module}`, text: <RunLine run={r} view={view} /> });
  }
  for (const v of view.scope.versions) {
    if (!v.created_at) continue;
    items.push({ at: v.created_at, key: `v:${v.version}`, text: tr("Version {version}{value}", { version: v.version, value: v.note ? `: ${v.note}` : "" }) });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function RunLine({ run, view }: { run: RuleRun; view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const label = view.scope.objects.find((o) => o.module === run.module)?.label ?? run.module.replace(/_/g, " ");
  return (
    <>
      <V2Link href={hrefFor({ kind: "run", id: run.version_id })}>{tr("Run {run_at}", { run_at: formatDate(run.run_at, "date") })}</V2Link>
      {tr(": {affected_count} failing in {label}{value}", { affected_count: int(run.affected_count), label, value: run.suppressed ? tr(", suppressed") : "" })}
    </>
  );
}

export function RuleHistory({ view, limit = 8 }: { view: RuleView; limit?: number }) {
  const q = useRuleHistory(view.id);
  const items = useMemo(() => historyItems(q.data ?? [], view), [q.data, view]);
  return (
    <Sec title={tr("History")}>
      {q.isPending ? (
        <Skeleton width="70%" height={14} />
      ) : q.isError ? (
        <p className="m2-rp m2-meta">{tr("The run history could not be read for this rule.")}</p>
      ) : items.length === 0 ? (
        <p className="m2-rp m2-meta">{tr("No run has measured this rule yet.")}</p>
      ) : (
        <ul className="m2-hist">
          {items.slice(0, limit).map((h) => (
            <li key={h.key}>
              <span className="m2-d">{formatDate(h.at, "date")}</span>
              <span>{h.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

/* ---- actions by role ---- */

type Panel = "suppress" | "handoff" | null;

function SuppressForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const m = useMutation({
    mutationFn: () => suppressRule(view.id, reason.trim(), new Date(Date.now() + Number(days) * 86_400_000).toISOString()),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length >= 3) m.mutate();
  };
  return (
    <form className="m2-aform" onSubmit={submit} aria-label={tr("Suppress {id}", { id: view.id })}>
      <label>
        {tr("Reason")}
        <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={2000} />
      </label>
      <label>
        {tr("For")}
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">{tr("30 days")}</option>
          <option value="60">{tr("60 days")}</option>
          <option value="90">{tr("90 days")}</option>
        </select>
      </label>
      <p className="m2-prov">{tr("The rule stays out of the score until the date. It takes effect on the next run.")}</p>
      {m.isError ? <p role="alert" className="m2-prov">{tr("The suppression could not be saved.")}</p> : null}
      <button type="submit" className="m2-btn m2-sm" disabled={m.isPending || reason.trim().length < 3}>
        {tr("Suppress rule")}
      </button>
    </form>
  );
}

function HandoffForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const stewards = useStewards(true);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const mod = view.scope.module ?? view.scope.objects[0]?.module ?? "";
  const m = useMutation({
    mutationFn: () => handOffRule({ check_id: view.id, module: mod, assignee_id: who, note: note.trim(), due_date: due, version_id: view.scope.objects[0]?.run_id }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (who && note.trim()) m.mutate();
  };
  return (
    <form className="m2-aform" onSubmit={submit} aria-label={tr("Hand {id} to a steward", { id: view.id })}>
      <label>
        {tr("Steward")}
        <select value={who} onChange={(e) => setWho(e.target.value)} required>
          <option value="">{tr("Choose")}</option>
          {(stewards.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.email}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tr("Note")}
        <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} />
      </label>
      <label>
        {tr("Due")}
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      </label>
      {m.isError ? <p role="alert" className="m2-prov">{tr("The hand-off could not be created.")}</p> : null}
      <button type="submit" className="m2-btn m2-sm" disabled={m.isPending || !who || !note.trim()}>
        {tr("Hand over")}
      </button>
    </form>
  );
}

/** The verbs the viewer's role allows: suppress (approve), edit in authoring (manage_rules), hand to a steward. */
export function RuleActions({ view, canvas }: { view: RuleView; canvas?: boolean }) {
  const { can } = useV2Session();
  const [panel, setPanel] = useState<Panel>(null);
  const [done, setDone] = useState<string | null>(null);
  const qc = useQueryClient();
  const mod = view.scope.module ?? view.scope.objects[0]?.module ?? "";
  const canSuppress = can("approve");
  const canEdit = can("manage_rules");
  const canHandoff = can("handoff_rule") || can("assign");
  const finish = (msg: string) => {
    setDone(msg);
    setPanel(null);
    void qc.invalidateQueries({ queryKey: ["v2", "rule-scope"] });
  };
  return (
    <Sec title={tr("Actions")}>
      <div className="m2-acts">
        {canvas ? null : (
          <V2Link href={`/r/${encodeURIComponent(view.id)}`} className="m2-btn m2-strong">
            {tr("Open the rule")}
          </V2Link>
        )}
        <V2Link href={`/r/${encodeURIComponent(view.id)}?tab=failing`} className="m2-btn">
          {tr("Open failing records")}
        </V2Link>
        {canSuppress ? (
          <button type="button" className="m2-btn" aria-expanded={panel === "suppress"} onClick={() => setPanel(panel === "suppress" ? null : "suppress")}>
            {tr("Suppress")}
          </button>
        ) : null}
        {canEdit ? (
          <V2Link href={`/rules?view=drafts&module=${encodeURIComponent(mod)}`} className="m2-btn">
            {tr("Edit in authoring")}
          </V2Link>
        ) : null}
        {canHandoff ? (
          <button type="button" className="m2-btn" aria-expanded={panel === "handoff"} onClick={() => setPanel(panel === "handoff" ? null : "handoff")}>
            {tr("Hand to a steward")}
          </button>
        ) : null}
      </div>
      {panel === "suppress" ? <SuppressForm view={view} onDone={() => finish(tr("{id} is suppressed until the date you set.", { id: view.id }))} /> : null}
      {panel === "handoff" ? <HandoffForm view={view} onDone={() => finish(tr("{id} is handed over; the steward finds it in the inbox.", { id: view.id }))} /> : null}
      {done ? <p role="status" className="m2-prov">{done}</p> : null}
      {!canSuppress && !canEdit && !canHandoff ? <p className="m2-prov">{tr("Your role can read this rule. Suppressing, editing and hand-off need a steward, owner or lead role.")}</p> : null}
    </Sec>
  );
}

/* ---- the inspector body ---- */

function BodySkeleton() {
  return (
    <div aria-busy="true" data-testid="rule-loading">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} style={{ height: 28, display: "flex", alignItems: "center" }}>
          <Skeleton width={`${40 + ((i * 17) % 40)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

/** Shell slot body for `?open=rule:<check_id>`. The title and status line come from the inspector frame. */
export function RuleInspectorBody({ id, landscape }: { id: string; landscape?: Landscape | undefined }) {
  const s = useRule(id);
  if (s.status === "loading") return <BodySkeleton />;
  if (s.status === "error") {
    const capped = (landscape?.cells ?? []).filter((c) => c.breaches.includes(id)).length;
    return (
      <>
        <ErrorFrame onRetry={s.refetch}>{tr("This rule could not be read. It may not run on any object yet.")}</ErrorFrame>
        {capped > 0 ? <p className="m2-prov">{tr("It is a critical rule over tolerance in {capped} {capped, plural, one {object} other {objects}}.", { capped })}</p> : null}
        <div className="m2-acts" style={{ marginTop: "var(--m2-s4)" }}>
          <V2Link href={`/r/${encodeURIComponent(id)}`} className="m2-btn m2-strong">
            {tr("Open the rule")}
          </V2Link>
        </div>
      </>
    );
  }
  const v = s.view;
  return (
    <SectionLevel level="h3">
      <p className="m2-rname" data-testid="rule-name">{v.scope.name ?? v.scope.definition.message ?? tr("Rule")}</p>
      <RuleFacts view={v} />
      <RuleDefinition view={v} />
      <RuleAuthority view={v} />
      <RuleScopeSection view={v} />
      <RuleBlocks view={v} />
      <RuleLineage view={v} />
      <RuleVersions view={v} />
      <RuleContract view={v} />
      <RuleActions view={v} />
      <RuleHistory view={v} />
      <CollabSections kind="rule" id={v.id} label={tr("rule {id}", { id: v.id })} />
    </SectionLevel>
  );
}
