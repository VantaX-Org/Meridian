"use client";

import type { Landscape, LandscapeCell, LandscapeSystem } from "@/lib/api/v2/types";
import { DIMENSIONS } from "@/lib/api/v2/types";
import type { WorkGroup } from "@/lib/api/work";
import { useTimeline } from "@/lib/v2/runs-queries";
import { useWorkGroups, useWorkSummary } from "@/lib/v2/work-queries";
import { useMoney } from "@/lib/v2/step9-queries";
import { useRuleHistory } from "@/lib/v2/object-queries";
import { useObjectOwners } from "@/lib/v2/mdm-queries";
import { moneyCompactText, systemTypeText } from "@/lib/v2/labels";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { Sparkline } from "../charts";
import { SeverityMark, VerdictMark, type SeverityKey } from "../marks";
import { V2Link } from "../parts";

const DAY = 86_400_000;
const SEV_WORD: Record<string, string> = { get critical() { return t("Critical"); }, get high() { return t("High"); }, get medium() { return t("Medium"); }, get low() { return t("Low"); }, get info() { return t("Info"); } };

/** The heat band of a 0 to 100 score: 0 is at or above 95, 3 is below 70. Every heat cell also prints its number. */
export function band(v: number | null | undefined): 0 | 1 | 2 | 3 | null {
  if (v == null) return null;
  return v >= 95 ? 0 : v >= 85 ? 1 : v >= 70 ? 2 : 3;
}

/** A signed change with one decimal, a dash when either end is unknown. */
export function signed(d: number | null): string {
  if (d == null) return "—";
  const r = Math.round(d * 10) / 10;
  return r > 0 ? `+${f1(r)}` : r < 0 ? `−${f1(-r)}` : f1(0);
}

/** The change over the last 30 days: the latest value less the first value inside the window, null with fewer than two. */
export function delta30(points: readonly { at: string | null; v: number | null }[]): number | null {
  const known = points.filter((p): p is { at: string; v: number } => p.v != null && p.at != null);
  if (known.length < 2) return null;
  const last = known[known.length - 1];
  const from = Date.parse(last.at) - 30 * DAY;
  const first = known.find((p) => Date.parse(p.at) >= from) ?? known[0];
  return first === last ? null : last.v - first.v;
}

function Delta({ d }: { d: number | null }) {
  return (
    <span className="m2-ck-delta" data-dir={d == null || Math.abs(d) < 0.05 ? "flat" : d > 0 ? "up" : "down"}>
      {signed(d)}
    </span>
  );
}

/** Objects by system on the six dimensions: the score with its trend and 30-day change, each dimension as a heat cell, then volume, open work and value at risk. */
export function ReadinessMatrix({ landscape, run }: { landscape: Landscape; run: string | null }) {
  const money = useMoney("landscape", null).data;
  const value = new Map((money?.ranking.objects ?? []).map((o) => [o.id, o.value_unblocked_per_month]));
  const label = (m: string) => landscape.objects.find((o) => o.module === m)?.label ?? m;
  return (
    <section className="m2-ck-panel" aria-label={t("Readiness matrix")} data-testid="heat-map">
      <header className="m2-ck-head">
        <h2 className="m2-h2">{t("Readiness matrix")}</h2>
        <span className="m2-ck-key" aria-hidden="true">
          <span data-band="0">{t("95 and up")}</span>
          <span data-band="1">{t("85 to 95")}</span>
          <span data-band="2">{t("70 to 85")}</span>
          <span data-band="3">{t("below 70")}</span>
        </span>
      </header>
      <div className="m2-ck-scroll">
        <table className="m2-ck-matrix">
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              <th scope="col">{t("Verdict")}</th>
              <th scope="col" className="m2-num">{t("Score")}</th>
              <th scope="col">{t("Last runs")}</th>
              <th scope="col" className="m2-num">{t("30 days")}</th>
              {DIMENSIONS.map((d) => (
                <th key={d.key} scope="col" className="m2-ck-dimh">
                  {d.label}
                </th>
              ))}
              <th scope="col" className="m2-num">{t("Records")}</th>
              <th scope="col" className="m2-num">{t("To fix")}</th>
              <th scope="col" className="m2-num">{t("Value at risk a month")}</th>
            </tr>
          </thead>
          {landscape.systems.map((s) => (
            <SystemRows key={s.id} system={s} cells={landscape.cells.filter((c) => c.system_id === s.id)} label={label} value={value} currency={money?.currency ?? null} run={run} />
          ))}
        </table>
      </div>
    </section>
  );
}

function SystemRows({ system, cells, label, value, currency, run }: { system: LandscapeSystem; cells: LandscapeCell[]; label: (m: string) => string; value: Map<string, number | null>; currency: string | null; run: string | null }) {
  const runs = useTimeline(system.id, 12).data?.runs ?? [];
  if (!cells.length) return null;
  const sorted = [...cells].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return (
    <tbody>
      <tr className="m2-ck-sys">
        <th scope="rowgroup" colSpan={8 + DIMENSIONS.length}>
          {system.name}
          <span>
            {systemTypeText(system.system_type)}
            {system.client ? t(", client {client}", { client: system.client }) : ""}
          </span>
        </th>
      </tr>
      {sorted.map((c) => {
        const name = label(c.module);
        const pts = runs.map((r) => ({ at: r.run_at, v: r.objects[c.module]?.raw_score ?? r.objects[c.module]?.score ?? null }));
        const d = delta30(pts);
        const v = value.get(c.module);
        return (
          <tr key={c.module}>
            <th scope="row">
              <V2Link href={`/o/${systemSlug(system.name)}/${moduleSlug(c.module)}${run ? `?run=${run}` : ""}`}>{name}</V2Link>
            </th>
            <td>
              <span className="m2-ck-vd">
                <VerdictMark verdict={c.verdict} /> {VERDICT_LABEL[c.verdict]}
              </span>
            </td>
            <td className="m2-num m2-ck-score" data-band={band(c.score) ?? undefined}>
              {f1(c.score)}
            </td>
            <td>{pts.some((p) => p.v != null) ? <Sparkline values={pts.map((p) => p.v)} width={72} height={18} label={t("{name} score over the last {n} runs", { name, n: pts.length })} /> : "—"}</td>
            <td className="m2-num">
              <Delta d={d} />
            </td>
            {DIMENSIONS.map((dim) => {
              const x = c.dimensions?.[dim.key] ?? null;
              return (
                <td key={dim.key} className="m2-num m2-ck-heat" data-band={band(x) ?? undefined} title={`${name}, ${dim.label}: ${x == null ? t("not measured") : f1(x)}`}>
                  {x == null ? "—" : f1(x)}
                </td>
              );
            })}
            <td className="m2-num">{int(c.records_checked)}</td>
            <td className="m2-num">{c.open_work ? int(c.open_work) : "—"}</td>
            <td className="m2-num">{v == null ? "—" : moneyCompactText(v, currency)}</td>
          </tr>
        );
      })}
    </tbody>
  );
}

const STAGES = ["to_fix", "proposed", "approved", "awaiting_load", "sent", "fixed"] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  get to_fix() { return t("To fix"); },
  get proposed() { return t("Waiting for approval"); },
  get approved() { return t("Approved"); },
  get awaiting_load() { return t("Waiting for the SAP load"); },
  get sent() { return t("Sent to SAP"); },
  get fixed() { return t("Fixed"); },
};

/** Where the work stands: records at each step from found to fixed in SAP, then the same split per object. */
export function FixPipeline({ label, module }: { label: (m: string) => string; module?: string | null }) {
  const s = useWorkSummary().data;
  const objects = (s?.objects ?? []).filter((o) => !module || o.module === module);
  const total = (k: (typeof STAGES)[number]) => objects.reduce((a, o) => a + (o.statuses?.[k] ?? 0), 0);
  const counts = STAGES.map((k) => ({ k, n: total(k) }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const rows = [...objects].sort((a, b) => b.open - a.open).slice(0, 8);
  return (
    <section className="m2-ck-panel" aria-label={t("Fix pipeline")} data-testid="ck-pipeline">
      <header className="m2-ck-head">
        <h2 className="m2-h2">{t("Fix pipeline")}</h2>
        <V2Link href="/work">{t("Open Work")}</V2Link>
      </header>
      {s ? (
        <>
          <ol className="m2-ck-stages">
            {counts.map((c) => (
              <li key={c.k} data-stage={c.k}>
                <span className="m2-ck-stn">{int(c.n)}</span>
                <span className="m2-ck-stbar" aria-hidden="true">
                  <span style={{ height: `${Math.max(c.n ? 4 : 0, (c.n / max) * 100)}%` }} />
                </span>
                <span className="m2-ck-stl">{STAGE_LABEL[c.k]}</span>
              </li>
            ))}
          </ol>
          <table className="m2-ck-mini">
            <caption className="m2-sr">{t("Records at each step, by object")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Split")}</th>
                <th scope="col" className="m2-num">{t("Open")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const parts = STAGES.map((k) => ({ k, n: o.statuses?.[k] ?? 0 }));
                const sum = parts.reduce((a, p) => a + p.n, 0);
                return (
                  <tr key={o.module}>
                    <th scope="row">{label(o.module)}</th>
                    <td>
                      <span className="m2-ck-split" role="img" aria-label={parts.filter((p) => p.n).map((p) => `${STAGE_LABEL[p.k]} ${int(p.n)}`).join(", ") || t("nothing open")}>
                        {sum ? parts.map((p) => (p.n ? <span key={p.k} data-stage={p.k} style={{ width: `${(p.n / sum) * 100}%` }} /> : null)) : null}
                      </span>
                    </td>
                    <td className="m2-num">{int(o.open)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="m2-cc-empty">{t("Reading the work")}</p>
      )}
    </section>
  );
}

/** What the blocked SAP features cost a month, feature by feature, stepping up to the total. */
export function RiskWaterfall() {
  const q = useMoney("landscape", null);
  const m = q.data;
  const fs = [...(m?.features ?? [])].filter((f) => (f.opportunity_cost_per_month ?? 0) > 0).sort((a, b) => (b.opportunity_cost_per_month ?? 0) - (a.opportunity_cost_per_month ?? 0));
  const top = fs.slice(0, 7);
  const rest = fs.slice(7);
  const steps = [
    ...top.map((f) => ({ key: `${f.system_id}:${f.feature}`, label: f.feature, sub: f.status === "blocked" ? t("blocked") : t("degraded"), v: f.opportunity_cost_per_month ?? 0 })),
    ...(rest.length ? [{ key: "rest", label: t("{n} more features", { n: rest.length }), sub: "", v: rest.reduce((a, f) => a + (f.opportunity_cost_per_month ?? 0), 0) }] : []),
  ];
  const total = steps.reduce((a, s) => a + s.v, 0);
  let run = 0;
  return (
    <section className="m2-ck-panel" aria-label={t("Value at risk")} data-testid="ck-waterfall">
      <header className="m2-ck-head">
        <h2 className="m2-h2">{t("Value at risk")}</h2>
        <span className="m2-meta">{m?.as_of ? t("as of {date}", { date: formatDate(m.as_of, "date") }) : null}</span>
      </header>
      {!m ? (
        <p className="m2-cc-empty">{q.isError ? t("No cost model is set up.") : t("Reading the cost model")}</p>
      ) : !steps.length ? (
        <p className="m2-cc-empty">{t("No SAP feature is blocked or degraded.")}</p>
      ) : (
        <ul className="m2-ck-fall" aria-label={t("Monthly cost by blocked feature")}>
          {steps.map((s) => {
            const left = (run / total) * 100;
            run += s.v;
            return (
              <li key={s.key}>
                <span className="m2-ck-fl">
                  {s.label}
                  {s.sub ? <small>{s.sub}</small> : null}
                </span>
                <span className="m2-ck-ft" aria-hidden="true">
                  <span style={{ left: `${left}%`, width: `${Math.max(0.5, (s.v / total) * 100)}%` }} />
                </span>
                <span className="m2-num">{moneyCompactText(s.v, m.currency)}</span>
              </li>
            );
          })}
          <li className="m2-ck-ftotal">
            <span className="m2-ck-fl">{t("Total a month")}</span>
            <span className="m2-ck-ft" aria-hidden="true">
              <span style={{ left: 0, width: "100%" }} />
            </span>
            <span className="m2-num">{moneyCompactText(total, m.currency)}</span>
          </li>
        </ul>
      )}
    </section>
  );
}

/** The rules failing the most records: what each checks, where, how many fail, the trend, the fixes on offer and who owns the object. */
export function RuleBoard({ label, module, limit = 12 }: { label: (m: string) => string; module?: string | null; limit?: number }) {
  const q = useWorkGroups(module ? { module } : {});
  const owners = useObjectOwners().data ?? [];
  const owner = (m: string) => owners.find((o) => o.ref === m)?.owner_name ?? null;
  const rows = [...(q.data?.groups ?? [])].sort((a, b) => b.records - a.records).slice(0, limit);
  const top = Math.max(1e-9, ...rows.map((g) => (g.population ? g.records / g.population : 0)));
  return (
    <section className="m2-ck-panel" aria-label={t("Rules failing the most records")} data-testid="ck-rules">
      <header className="m2-ck-head">
        <h2 className="m2-h2">{t("Rules failing the most records")}</h2>
        <V2Link href="/rules">{t("Open the rule library")}</V2Link>
      </header>
      {rows.length ? (
        <div className="m2-ck-scroll">
          <table className="m2-ck-rules">
            <thead>
              <tr>
                <th scope="col">{t("Rule")}</th>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Severity")}</th>
                <th scope="col" className="m2-num">{t("Failing")}</th>
                <th scope="col">{t("Share failing")}</th>
                <th scope="col">{t("Trend")}</th>
                <th scope="col" className="m2-num">{t("Suggested")}</th>
                <th scope="col">{t("Owner")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <RuleRow key={`${g.module}:${g.check_id}`} g={g} object={label(g.module)} owner={owner(g.module)} top={top} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m2-cc-empty">{q.isPending ? t("Reading the rules") : t("No rule is failing.")}</p>
      )}
    </section>
  );
}

/** The share bars scale to the worst rule on the board, so a 2% and a 6% rule read apart. */
function RuleRow({ g, object, owner, top }: { g: WorkGroup; object: string; owner: string | null; top: number }) {
  const h = useRuleHistory(g.check_id).data ?? [];
  const failing = [...h].reverse().map((r) => r.affected_count);
  const share = g.population ? g.records / g.population : null;
  return (
    <tr>
      <th scope="row">
        <V2Link href={`/work?rule=${encodeURIComponent(g.check_id)}`} className="m2-ck-rule">
          <span className="m2-mono">{g.check_id}</span>
          <span>{g.message ?? "—"}</span>
          {g.field ? <small className="m2-mono">{g.field}</small> : null}
        </V2Link>
      </th>
      <td>{object}</td>
      <td>
        <span className="m2-ck-vd">
          <SeverityMark severity={g.severity as SeverityKey} /> {SEV_WORD[g.severity] ?? g.severity}
        </span>
      </td>
      <td className="m2-num">{int(g.records)}</td>
      <td>
        {share == null ? (
          "—"
        ) : (
          <span className="m2-ck-share">
            <span className="m2-ck-sbar" aria-hidden="true">
              <span data-sev={g.severity} style={{ width: `${Math.max(2, (share / top) * 100)}%` }} />
            </span>
            <span className="m2-num">{f1(share * 100)}%</span>
          </span>
        )}
      </td>
      <td>{failing.length > 1 ? <Sparkline values={failing} width={64} height={18} domain={[0, Math.max(1, ...failing)]} label={t("{rule} failing records over the last {n} runs", { rule: g.check_id, n: failing.length })} /> : "—"}</td>
      <td className="m2-num">{g.proposed ? int(g.proposed) : "—"}</td>
      <td className="m2-ck-own">{owner ?? "—"}</td>
    </tr>
  );
}
