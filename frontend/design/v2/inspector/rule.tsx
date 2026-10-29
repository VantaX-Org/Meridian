"use client";

import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatMoneyCompact } from "@/lib/format";
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

/**
 * Everything the rule inspector and the rule canvas say about one rule, read from GET /rules/{id}/scope, the receipts
 * of the objects it runs on, the object's rules (for value at risk) and /rules/{id}/history. The sections are small
 * components so the inspector (a column) and the canvas (tabs) show the same content.
 */

const SEV_WORD: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
const AUTHORITY_WORD: Record<string, string> = {
  sap_hard_constraint: "SAP hard constraint",
  s4hana_migration: "S/4HANA migration",
  best_practice: "Best practice",
  customer_configured: "Customer configured",
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
  out.push(`${int(s.failing_records)} failing across ${s.objects.length} ${s.objects.length === 1 ? "object" : "objects"}`);
  if (v.failingPct != null) out.push(`${pct2(v.failingPct)} of records checked`);
  if (v.row?.value_at_risk != null) out.push(`${formatMoneyCompact(v.row.value_at_risk, v.currency)} at risk`);
  if (v.overTolerance != null) out.push(v.overTolerance ? "over tolerance" : "within tolerance");
  if (s.features.length > 0) out.push(`blocks ${s.features.length} S/4 ${s.features.length === 1 ? "feature" : "features"}`);
  return out;
}

export function RuleFacts({ view }: { view: RuleView }) {
  const s = view.scope;
  const primary = s.module ?? s.objects[0]?.module ?? "";
  const oneObject = s.objects.length === 1 ? s.objects[0].label : null;
  const fieldWords = view.row?.field_description ?? null;
  return (
    <Sec title="Facts">
      <Facts>
        <Fact label="Severity">
          <Sev severity={view.severity} />
        </Fact>
        <Fact label="Dimension">{s.definition.dimension ? DIM_WORD(s.definition.dimension) : <Dash />}</Fact>
        <Fact label="Field">
          {fieldWords ? <>{fieldWords} </> : null}
          {s.definition.field ? <Mono>{s.definition.field}</Mono> : <Dash />}
        </Fact>
        <Fact label={<>Tolerance <Explain metric="tolerance" label="Tolerance" module={primary} /></>}>
          {view.severity === "critical" && view.tolerance ? `${int(view.tolerance.rows)} rows` : <Dash why="Only critical rules carry a tolerance" />}
        </Fact>
        <Fact label={<>Over tolerance <Explain metric="tolerance" label="Over tolerance" module={primary} /></>}>
          {view.overTolerance == null ? <Dash /> : view.overTolerance ? <b>Yes</b> : "No"}
        </Fact>
        <Fact label="Failing records">{oneObject ? `${int(s.failing_records)} in ${oneObject}` : `${int(s.failing_records)} across ${s.objects.length} objects`}</Fact>
        {s.objects.length > 1 ? s.failing_by_object.map((o) => (
          <Fact key={o.module} label={o.label}>
            {int(o.failing)}
          </Fact>
        )) : null}
        <Fact label={<>Failing % <Explain metric="failing_pct" label="Failing %" module={primary} checkId={view.id} /></>}>
          {view.failingPct == null ? <Dash /> : `${pct2(view.failingPct)} of ${int(view.checked)} records checked`}
        </Fact>
        <Fact label={<>Value at risk <Explain metric="value_at_risk" label="Value at risk" module={primary} /></>}>
          {view.row?.value_at_risk == null ? <Dash why="Not priced in this run" /> : <>{formatMoneyCompact(view.row.value_at_risk, view.currency)}{oneObject ? "" : s.objects.length > 1 ? ` in ${s.objects[0].label}` : ""}</>}
        </Fact>
      </Facts>
    </Sec>
  );
}

export function RuleDefinition({ view }: { view: RuleView }) {
  const d = view.scope.definition;
  const params = Object.entries(d.params ?? {});
  return (
    <Sec title="Definition">
      <Facts>
        <Fact label="Check class">{d.check_class ? <Mono>{d.check_class}</Mono> : <Dash />}</Fact>
        <Fact label="Field">{d.field ? <Mono>{d.field}</Mono> : <Dash />}</Fact>
        <Fact label="Expression">{d.expression ? <Mono>{d.expression}</Mono> : <Dash why="The rule has no stored expression" />}</Fact>
        {params.map(([k, v]) => (
          <Fact key={k} label={<Mono>{k}</Mono>}>
            <Mono>{typeof v === "string" ? v : JSON.stringify(v)}</Mono>
          </Fact>
        ))}
        <Fact label="Source">{d.source === "tenant" ? "Written by your team" : d.source === "shipped" ? "Shipped with Meridian" : <Dash />}</Fact>
      </Facts>
      {d.message && d.message !== view.scope.name ? <p className="m2-rp">{d.message}</p> : null}
    </Sec>
  );
}

export function RuleAuthority({ view }: { view: RuleView }) {
  const a = view.scope.authority;
  return (
    <Sec title="Authority">
      {a.rule_authority ? <p className="m2-rp"><b>{AUTHORITY_WORD[a.rule_authority] ?? a.rule_authority}</b></p> : <p className="m2-rp m2-meta">The rule does not state an authority.</p>}
      {a.why_it_matters ? <p className="m2-rp">{a.why_it_matters}</p> : null}
      {a.sap_impact && a.sap_impact !== a.why_it_matters ? <p className="m2-rp">{`In SAP: ${a.sap_impact}`}</p> : null}
    </Sec>
  );
}

export function RuleScopeSection({ view }: { view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const s = view.scope;
  return (
    <Sec title={`Scope: ${s.objects.length} ${s.objects.length === 1 ? "object" : "objects"}, ${s.systems.length} ${s.systems.length === 1 ? "system" : "systems"}`}>
      {s.objects.length === 0 ? (
        <p className="m2-rp m2-meta">No run has measured this rule yet.</p>
      ) : (
        <ul className="m2-lk">
          {s.objects.map((o) => (
            <li key={`${o.system_id}:${o.module}`}>
              <V2Link href={`/v2/o/${systemSlug(o.system_name ?? o.system_id)}/${moduleSlug(o.module)}`}>{o.label}</V2Link>
              <span className="m2-meta">{`${o.system_name ?? ""}${o.run_at ? `, run ${formatDate(o.run_at, "date")}` : ""}, ${int(o.failing)} failing`}</span>
            </li>
          ))}
        </ul>
      )}
      {s.systems.length > 0 ? (
        <ul className="m2-lk">
          {s.systems.map((sys) => (
            <li key={sys.id}>
              <V2Link href={hrefFor({ kind: "system", id: sys.id })}>{sys.name ?? "System"}</V2Link>
              <span className="m2-meta">{`${int(sys.failing)} failing in ${sys.objects} ${sys.objects === 1 ? "object" : "objects"}`}</span>
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
    <Sec title={`Blocks: ${f.length} S/4 ${f.length === 1 ? "feature" : "features"}`}>
      {f.length === 0 ? (
        <p className="m2-rp m2-meta">No S/4 feature is mapped to this rule yet.</p>
      ) : (
        <ul className="m2-lk">
          {f.map((x) => (
            <li key={`${x.feature}:${x.status}`}>
              <V2Link href={hrefFor({ kind: "feature", id: x.feature })}>{x.feature}</V2Link>
              <span className="m2-meta">{x.status === "blocked" ? "Blocked" : "Degraded"}</span>
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
    <svg className="m2-lineage" viewBox={`0 0 360 ${H}`} width="360" height={H} role="group" aria-label={`Lineage: ${field || "field"} to ${view.id} to ${feats.length === 0 ? "no features" : "blocked features"}`} data-testid="lineage">
      <line x1="108" y1={cy} x2="136" y2={cy} />
      <rect x="1" y={cy - 15} width="107" height="30" />
      <text x="8" y={cy + 4} className="m2-lg-mono">{trim(field || "no field", 14)}</text>
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
      {extra > 0 ? <text x="232" y={H - 2} className="m2-lg-more">{`and ${extra} more`}</text> : null}
    </svg>
  );
}

export function RuleLineage({ view }: { view: RuleView }) {
  return (
    <Sec title="Lineage">
      <Lineage view={view} />
    </Sec>
  );
}

const STATE_WORD: Record<string, string> = { draft: "Draft", in_review: "In review", active: "Active", retired: "Retired" };

export function RuleVersions({ view }: { view: RuleView }) {
  const s = view.scope;
  return (
    <Sec title="Versions">
      {s.versions.length === 0 ? <p className="m2-rp m2-meta">{s.shipped ? "No tenant version yet; the shipped definition runs." : "No version is stored for this rule."}</p> : (
        <ul className="m2-hist">
          {s.versions.map((v) => (
            <li key={v.version}>
              <span className="m2-d">{v.created_at ? formatDate(v.created_at, "date") : ""}</span>
              <span>{`Version ${v.version}, ${(STATE_WORD[v.state] ?? v.state).toLowerCase()}${v.note ? `: ${v.note}` : ""}${v.author ? `. By ${v.author}.` : ""}`}</span>
            </li>
          ))}
        </ul>
      )}
      {s.shipped ? <p className="m2-prov">{`Shipped definition ${s.shipped.source}, content hash ${s.shipped.hash}, Meridian ${s.shipped.app_version}.`}</p> : null}
    </Sec>
  );
}

export function RuleContract({ view }: { view: RuleView }) {
  const c = view.scope.contracts;
  return (
    <Sec title="Contract">
      {c.length === 0 ? <p className="m2-rp m2-meta">No data contract names this rule or sets a threshold on its dimension.</p> : (
        <ul className="m2-lk">
          {c.map((x, i) => (
            <li key={`${x.id}:${i}`}>
              <span>{x.name}</span>
              <span className="m2-meta">{x.via === "names_rule" ? `${STATE_WORD[x.status] ?? x.status}, names this rule` : `${STATE_WORD[x.status] ?? x.status}, minimum ${x.threshold}${view.scope.definition.dimension ? ` for ${view.scope.definition.dimension}` : ""}`}</span>
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
    items.push({ at: v.created_at, key: `v:${v.version}`, text: `Version ${v.version}${v.note ? `: ${v.note}` : ""}` });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function RunLine({ run, view }: { run: RuleRun; view: RuleView }) {
  const { hrefFor } = useOpenItem();
  const label = view.scope.objects.find((o) => o.module === run.module)?.label ?? run.module.replace(/_/g, " ");
  return (
    <>
      <V2Link href={hrefFor({ kind: "run", id: run.version_id })}>{`Run ${formatDate(run.run_at, "date")}`}</V2Link>
      {`: ${int(run.affected_count)} failing in ${label}${run.suppressed ? ", suppressed" : ""}`}
    </>
  );
}

export function RuleHistory({ view, limit = 8 }: { view: RuleView; limit?: number }) {
  const q = useRuleHistory(view.id);
  const items = useMemo(() => historyItems(q.data ?? [], view), [q.data, view]);
  return (
    <Sec title="History">
      {q.isPending ? (
        <Skeleton width="70%" height={14} />
      ) : q.isError ? (
        <p className="m2-rp m2-meta">The run history could not be read for this rule.</p>
      ) : items.length === 0 ? (
        <p className="m2-rp m2-meta">No run has measured this rule yet.</p>
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
    <form className="m2-aform" onSubmit={submit} aria-label={`Suppress ${view.id}`}>
      <label>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={2000} />
      </label>
      <label>
        For
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
      </label>
      <p className="m2-prov">The rule stays out of the score until the date. It takes effect on the next run.</p>
      {m.isError ? <p role="alert" className="m2-prov">The suppression could not be saved.</p> : null}
      <button type="submit" className="m2-btn m2-sm" disabled={m.isPending || reason.trim().length < 3}>
        Suppress rule
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
    <form className="m2-aform" onSubmit={submit} aria-label={`Hand ${view.id} to a steward`}>
      <label>
        Steward
        <select value={who} onChange={(e) => setWho(e.target.value)} required>
          <option value="">Choose</option>
          {(stewards.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.email}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} />
      </label>
      <label>
        Due
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      </label>
      {m.isError ? <p role="alert" className="m2-prov">The hand-off could not be created.</p> : null}
      <button type="submit" className="m2-btn m2-sm" disabled={m.isPending || !who || !note.trim()}>
        Hand over
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
    <Sec title="Actions">
      <div className="m2-acts">
        {canvas ? null : (
          <V2Link href={`/v2/r/${encodeURIComponent(view.id)}`} className="m2-btn m2-strong">
            Open the rule
          </V2Link>
        )}
        <V2Link href={`/v2/r/${encodeURIComponent(view.id)}?tab=failing`} className="m2-btn">
          Open failing records
        </V2Link>
        {canSuppress ? (
          <button type="button" className="m2-btn" aria-expanded={panel === "suppress"} onClick={() => setPanel(panel === "suppress" ? null : "suppress")}>
            Suppress
          </button>
        ) : null}
        {canEdit ? (
          <V2Link href={`/v2/rules?view=drafts&module=${encodeURIComponent(mod)}`} className="m2-btn">
            Edit in authoring
          </V2Link>
        ) : null}
        {canHandoff ? (
          <button type="button" className="m2-btn" aria-expanded={panel === "handoff"} onClick={() => setPanel(panel === "handoff" ? null : "handoff")}>
            Hand to a steward
          </button>
        ) : null}
      </div>
      {panel === "suppress" ? <SuppressForm view={view} onDone={() => finish(`${view.id} is suppressed until the date you set.`)} /> : null}
      {panel === "handoff" ? <HandoffForm view={view} onDone={() => finish(`${view.id} is handed over; the steward finds it in the inbox.`)} /> : null}
      {done ? <p role="status" className="m2-prov">{done}</p> : null}
      {!canSuppress && !canEdit && !canHandoff ? <p className="m2-prov">Your role can read this rule. Suppressing, editing and hand-off need a steward, owner or lead role.</p> : null}
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
        <ErrorFrame onRetry={s.refetch}>This rule could not be read. It may not run on any object yet.</ErrorFrame>
        {capped > 0 ? <p className="m2-prov">{`It is a critical rule over tolerance in ${capped} ${capped === 1 ? "object" : "objects"}.`}</p> : null}
        <div className="m2-acts" style={{ marginTop: 16 }}>
          <V2Link href={`/v2/r/${encodeURIComponent(id)}`} className="m2-btn m2-strong">
            Open the rule
          </V2Link>
        </div>
      </>
    );
  }
  const v = s.view;
  return (
    <SectionLevel level="h3">
      <p className="m2-rname" data-testid="rule-name">{v.scope.name ?? v.scope.definition.message ?? "Rule"}</p>
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
      <CollabSections kind="rule" id={v.id} label={`rule ${v.id}`} />
    </SectionLevel>
  );
}
